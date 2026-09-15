/**
 * WS-9 — Approval to hire (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.3).
 *
 * The reconciliation found that "this candidate is selected" and "the
 * organization authorizes employing this candidate" were the same gate: an
 * application whose stage happened to be `hired`-category could be converted,
 * with no separate organizational decision and no record of who authorized it.
 *
 * This module supplies the missing decision. It is deliberately separate from
 * requisition approval, which answers a different question ("may we recruit
 * for this role at all?").
 *
 * Nothing here replaces the working requisition architecture, and no decision
 * is ever updated: `hire_authorization_decisions` is append-only, with the
 * stage, resolver and actor snapshotted, so replacing a department head or
 * reconfiguring the chain later cannot rewrite what was decided.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  hireAuthorizationsTable,
  hireAuthorizationDecisionsTable,
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  type HireAuthorization,
  type HireAuthorizationDecision,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import {
  listApprovalStages,
  resolveActorNameSnapshot,
  resolveStageAuthority,
  NotAuthorizedForStageError,
} from "./recruitmentApprovalStages";

export class HireAuthorizationNotFoundError extends Error {
  constructor() {
    super("Hire authorization not found");
    this.name = "HireAuthorizationNotFoundError";
  }
}

export class HireAuthorizationStateError extends Error {}

export class NoHireApprovalStagesConfiguredError extends Error {
  constructor() {
    super("This organization has not configured any hire-approval stages");
    this.name = "NoHireApprovalStagesConfiguredError";
  }
}

/**
 * The department a hire decision belongs to, resolved server-side through
 * application → vacancy → requisition. Used by the `department_head` resolver;
 * never supplied by the client.
 */
async function resolveApplicationDepartment(organizationId: number, applicationId: number): Promise<number | null> {
  const [row] = await db
    .select({ departmentId: jobRequisitionsTable.departmentId })
    .from(applicationsTable)
    .innerJoin(vacanciesTable, eq(vacanciesTable.id, applicationsTable.vacancyId))
    .innerJoin(jobRequisitionsTable, eq(jobRequisitionsTable.id, vacanciesTable.requisitionId))
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  return row?.departmentId ?? null;
}

export async function getHireAuthorizationByApplication(
  organizationId: number,
  applicationId: number,
): Promise<HireAuthorization | null> {
  const [row] = await db
    .select()
    .from(hireAuthorizationsTable)
    .where(
      and(eq(hireAuthorizationsTable.organizationId, organizationId), eq(hireAuthorizationsTable.applicationId, applicationId)),
    )
    .limit(1);
  return row ?? null;
}

export async function listDecisions(organizationId: number, hireAuthorizationId: number): Promise<HireAuthorizationDecision[]> {
  return db
    .select()
    .from(hireAuthorizationDecisionsTable)
    .where(
      and(
        eq(hireAuthorizationDecisionsTable.organizationId, organizationId),
        eq(hireAuthorizationDecisionsTable.hireAuthorizationId, hireAuthorizationId),
      ),
    )
    .orderBy(asc(hireAuthorizationDecisionsTable.stageOrder));
}

/**
 * Raises the authorization for an application. `totalStages` is frozen here so
 * that reconfiguring the chain mid-flight cannot retroactively change whether
 * an in-progress authorization counts as complete.
 */
export async function requestHireAuthorization(params: {
  organizationId: number;
  applicationId: number;
  actorMembershipId: number | null;
}): Promise<HireAuthorization> {
  const [application] = await db
    .select({ id: applicationsTable.id })
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, params.applicationId), eq(applicationsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!application) throw new HireAuthorizationNotFoundError();

  const stages = await listApprovalStages(params.organizationId, "hire");
  if (stages.length === 0) throw new NoHireApprovalStagesConfiguredError();

  try {
    const [created] = await db
      .insert(hireAuthorizationsTable)
      .values({
        organizationId: params.organizationId,
        applicationId: params.applicationId,
        status: "pending",
        totalStages: stages.length,
        currentStageOrder: stages[0].stageOrder,
        requestedByMembershipId: params.actorMembershipId,
      })
      .returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HireAuthorizationStateError("This application already has a hire authorization");
    }
    throw err;
  }
}

/**
 * Records one stage decision. Authority is re-resolved live against the
 * configured stage — never trusted from the caller — and the basis on which
 * the actor qualified is snapshotted alongside the decision.
 *
 * A rejection at any stage settles the whole authorization: the organization
 * declined to authorize this hire, and later stages are moot.
 */
export async function decideHireAuthorizationStage(params: {
  organizationId: number;
  hireAuthorizationId: number;
  actorMembershipId: number;
  actorUserId: number;
  decision: "approved" | "rejected";
  reason?: string | null;
}): Promise<HireAuthorization> {
  const [authorization] = await db
    .select()
    .from(hireAuthorizationsTable)
    .where(
      and(
        eq(hireAuthorizationsTable.id, params.hireAuthorizationId),
        eq(hireAuthorizationsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!authorization) throw new HireAuthorizationNotFoundError();
  if (authorization.status !== "pending") {
    throw new HireAuthorizationStateError(`This authorization is already ${authorization.status}`);
  }
  if (authorization.currentStageOrder == null) throw new HireAuthorizationStateError("This authorization has no pending stage");

  const stages = await listApprovalStages(params.organizationId, "hire");
  const stage = stages.find((s) => s.stageOrder === authorization.currentStageOrder);
  if (!stage) {
    // The configured stage was removed while this authorization was in flight.
    // Refusing is safer than silently skipping an approval the organization
    // said it wanted.
    throw new HireAuthorizationStateError(
      `Stage ${authorization.currentStageOrder} is no longer configured — re-raise this authorization after reviewing the chain`,
    );
  }

  const departmentId = await resolveApplicationDepartment(params.organizationId, authorization.applicationId);
  const grant = await resolveStageAuthority({
    organizationId: params.organizationId,
    stage,
    actorMembershipId: params.actorMembershipId,
    departmentId,
  });
  if (!grant) throw new NotAuthorizedForStageError(stage.name);

  const nameSnapshot = await resolveActorNameSnapshot(params.actorMembershipId);
  const remaining = stages.filter((s) => s.stageOrder > stage.stageOrder).sort((a, b) => a.stageOrder - b.stageOrder);
  const nextStage = params.decision === "approved" ? (remaining[0] ?? null) : null;

  return db.transaction(async (tx) => {
    try {
      await tx.insert(hireAuthorizationDecisionsTable).values({
        organizationId: params.organizationId,
        hireAuthorizationId: authorization.id,
        stageOrder: stage.stageOrder,
        stageName: stage.name,
        resolverType: stage.resolverType,
        authorityBasis: grant.authorityBasis,
        decision: params.decision,
        reason: params.reason?.trim() || null,
        decidedByMembershipId: params.actorMembershipId,
        decidedByUserId: params.actorUserId,
        decidedByNameSnapshot: nameSnapshot,
      });
    } catch (err) {
      // The (authorization, stage) unique index is the concurrency guard: two
      // approvers deciding the same stage simultaneously cannot both land.
      if (isUniqueViolation(err)) throw new HireAuthorizationStateError("This stage has already been decided");
      throw err;
    }

    const settled = params.decision === "rejected" || nextStage == null;
    const [updated] = await tx
      .update(hireAuthorizationsTable)
      .set({
        status: params.decision === "rejected" ? "rejected" : settled ? "approved" : "pending",
        currentStageOrder: settled ? null : nextStage!.stageOrder,
        completedAt: settled ? new Date() : null,
      })
      .where(eq(hireAuthorizationsTable.id, authorization.id))
      .returning();
    return updated;
  });
}

/**
 * True only when the organization has positively authorized employing this
 * candidate. Used by the conversion gate (§25.4).
 */
export async function isHireAuthorized(organizationId: number, applicationId: number): Promise<boolean> {
  const authorization = await getHireAuthorizationByApplication(organizationId, applicationId);
  return authorization?.status === "approved";
}

/**
 * True when `actorMembershipId` is a configured approver for any hire stage of
 * this application's raised authorization — the one reach a caller outside the
 * application's own visibility tier legitimately needs, so a department head or
 * named approver can see what they are being asked to decide.
 *
 * Authority is resolved exactly as `decideHireAuthorizationStage` resolves it
 * (live, through `resolveStageAuthority`), and only once an authorization has
 * been raised: before that there is nothing to decide, so nothing to see.
 */
export async function isHireAuthorizationStageApprover(params: {
  organizationId: number;
  applicationId: number;
  actorMembershipId: number;
}): Promise<boolean> {
  const authorization = await getHireAuthorizationByApplication(params.organizationId, params.applicationId);
  if (!authorization) return false;

  const stages = await listApprovalStages(params.organizationId, "hire");
  if (stages.length === 0) return false;
  const departmentId = await resolveApplicationDepartment(params.organizationId, params.applicationId);
  for (const stage of stages) {
    const grant = await resolveStageAuthority({
      organizationId: params.organizationId,
      stage,
      actorMembershipId: params.actorMembershipId,
      departmentId,
    });
    if (grant) return true;
  }
  return false;
}

/** Everything the UI needs to explain where an authorization stands, in one call. */
export async function getHireAuthorizationDetail(
  organizationId: number,
  applicationId: number,
): Promise<{
  authorization: HireAuthorization | null;
  decisions: HireAuthorizationDecision[];
  stages: Awaited<ReturnType<typeof listApprovalStages>>;
} > {
  const authorization = await getHireAuthorizationByApplication(organizationId, applicationId);
  const stages = await listApprovalStages(organizationId, "hire");
  const decisions = authorization ? await listDecisions(organizationId, authorization.id) : [];
  return { authorization, decisions, stages };
}
