import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  readinessLevelsTable,
  successionPlansTable,
  successionCandidatesTable,
  successionCandidateEventsTable,
  developmentActionsTable,
  employeesTable,
  positionsTable,
  skillsTable,
  employeeDocumentsTable,
  learningCoursesTable,
  learningEnrollmentsTable,
  type ReadinessLevel,
  type SuccessionPlan,
  type SuccessionCandidate,
  type SuccessionCandidateEvent,
  type DevelopmentAction,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-14 — succession (§30.11–30.18, OD #7).
 *
 * READ THE EXCLUSIONS BEFORE ADDING ANYTHING HERE.
 *
 * NO NUMERIC RANKING (§30.12). Candidates are an unranked pool. There is no
 * rank, order, score or priority anywhere in this module, and readiness must
 * never be turned into one. `listCandidates` orders by readiness ordinal purely
 * so a UI can GROUP by readiness band — that is presentation, not precedence,
 * and the ordinal is never returned as a candidate's position in a queue.
 *
 * NO POTENTIAL, NO 9-BOX (§30.13). Performance ships with an overall score, so
 * the grid is buildable; its absence is a decision, not an oversight.
 *
 * READINESS IS HUMAN-OWNED (§30.13). Nothing in this file computes readiness
 * from a performance score, a capability gap, tenure, learning completion or
 * anything else. `setReadiness` takes a level a person chose, and there is no
 * other writer.
 *
 * SUCCESSION NEVER TOUCHES EMPLOYMENT STATE (§30.16). No lifecycle service is
 * imported here — not `separateEmployee`, not `promoteEmployee`, not
 * `transferEmployee`, not the assignment services — and marking somebody
 * "ready now" appoints nobody. WS-11 remains authoritative.
 */

export class ReadinessLevelNotFoundError extends Error {
  constructor() {
    super("Readiness level not found");
    this.name = "ReadinessLevelNotFoundError";
  }
}

export class SuccessionPlanNotFoundError extends Error {
  constructor() {
    super("Succession plan not found");
    this.name = "SuccessionPlanNotFoundError";
  }
}

export class SuccessionCandidateNotFoundError extends Error {
  constructor() {
    super("Succession candidate not found");
    this.name = "SuccessionCandidateNotFoundError";
  }
}

export class InvalidSuccessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSuccessionError";
  }
}

export class DevelopmentActionNotFoundError extends Error {
  constructor() {
    super("Development action not found");
    this.name = "DevelopmentActionNotFoundError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Readiness levels (§30.13)
// ---------------------------------------------------------------------------

export async function listReadinessLevels(organizationId: number): Promise<ReadinessLevel[]> {
  return db
    .select()
    .from(readinessLevelsTable)
    .where(eq(readinessLevelsTable.organizationId, organizationId))
    .orderBy(asc(readinessLevelsTable.ordinal));
}

export async function getReadinessLevel(
  organizationId: number,
  levelId: number,
): Promise<ReadinessLevel | undefined> {
  const [row] = await db
    .select()
    .from(readinessLevelsTable)
    .where(and(eq(readinessLevelsTable.id, levelId), eq(readinessLevelsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function createReadinessLevel(params: {
  organizationId: number;
  ordinal: number;
  label: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ReadinessLevel> {
  if (!params.label.trim()) throw new InvalidSuccessionError("A readiness level needs a label.");
  if (!Number.isInteger(params.ordinal) || params.ordinal < 1) {
    throw new InvalidSuccessionError("Readiness ordinal must be a positive integer.");
  }
  try {
    const [created] = await db
      .insert(readinessLevelsTable)
      .values({
        organizationId: params.organizationId,
        ordinal: params.ordinal,
        label: params.label.trim(),
        description: params.description ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "readiness_level.created",
      targetType: "readiness_level",
      targetId: String(created!.id),
      afterState: { ordinal: created!.ordinal, label: created!.label },
    });
    return created!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvalidSuccessionError(`A readiness level with ordinal ${params.ordinal} already exists.`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Succession plans / critical positions (§30.11)
// ---------------------------------------------------------------------------

export async function listPlans(
  organizationId: number,
  filters: { status?: SuccessionPlan["status"] } = {},
): Promise<SuccessionPlan[]> {
  const predicates = [eq(successionPlansTable.organizationId, organizationId)];
  if (filters.status) predicates.push(eq(successionPlansTable.status, filters.status));
  return db
    .select()
    .from(successionPlansTable)
    .where(and(...predicates))
    .orderBy(desc(successionPlansTable.createdAt));
}

export async function getPlan(organizationId: number, planId: number): Promise<SuccessionPlan | undefined> {
  const [row] = await db
    .select()
    .from(successionPlansTable)
    .where(and(eq(successionPlansTable.id, planId), eq(successionPlansTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

/**
 * Marks a position as succession-managed by opening a plan for it.
 *
 * `positions` IS NOT MODIFIED (§30.11). Criticality lives here, so a position's
 * own semantics are unchanged for every other module that reads it.
 */
export async function createPlan(params: {
  organizationId: number;
  positionId: number;
  criticalityNotes?: string | null;
  reviewDueAt?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<SuccessionPlan> {
  await assertBelongsToOrganization(positionsTable, params.positionId, params.organizationId, "Position");

  try {
    const [created] = await db
      .insert(successionPlansTable)
      .values({
        organizationId: params.organizationId,
        positionId: params.positionId,
        status: "active",
        criticalityNotes: params.criticalityNotes ?? null,
        reviewDueAt: params.reviewDueAt ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "succession_plan.created",
      targetType: "succession_plan",
      targetId: String(created!.id),
      // Criticality notes are confidential and are NOT copied into audit (§30.23).
      afterState: { positionId: created!.positionId, status: created!.status },
    });
    return created!;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvalidSuccessionError("An open succession plan already exists for this position.");
    }
    throw err;
  }
}

export async function updatePlan(params: {
  organizationId: number;
  planId: number;
  status?: SuccessionPlan["status"];
  criticalityNotes?: string | null;
  reviewDueAt?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<SuccessionPlan> {
  const before = await getPlan(params.organizationId, params.planId);
  if (!before) throw new SuccessionPlanNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.criticalityNotes !== undefined) patch.criticalityNotes = params.criticalityNotes;
  if (params.reviewDueAt !== undefined) patch.reviewDueAt = params.reviewDueAt;
  if (params.status !== undefined) {
    patch.status = params.status;
    if (params.status === "closed") {
      patch.closedAt = new Date();
      patch.closedBy = params.actorApplicationUserId;
    }
  }

  const [updated] = await db
    .update(successionPlansTable)
    .set(patch)
    .where(
      and(eq(successionPlansTable.id, params.planId), eq(successionPlansTable.organizationId, params.organizationId)),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.status === "closed" ? "succession_plan.closed" : "succession_plan.updated",
    targetType: "succession_plan",
    targetId: String(params.planId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status },
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// Candidates (§30.11, §30.12)
// ---------------------------------------------------------------------------

/**
 * Candidates for a plan.
 *
 * Ordered by readiness ordinal so a UI can group by band. That ordering is
 * PRESENTATION, not precedence — no candidate carries a rank, and §30.12
 * forbids reconstructing one.
 */
export async function listCandidates(
  organizationId: number,
  planId: number,
  filters: { includeRemoved?: boolean } = {},
): Promise<Array<SuccessionCandidate & { readinessLabel: string | null; readinessOrdinal: number | null }>> {
  const predicates = [
    eq(successionCandidatesTable.organizationId, organizationId),
    eq(successionCandidatesTable.planId, planId),
  ];
  if (!filters.includeRemoved) predicates.push(eq(successionCandidatesTable.status, "active"));

  const rows = await db
    .select({
      candidate: successionCandidatesTable,
      readinessLabel: readinessLevelsTable.label,
      readinessOrdinal: readinessLevelsTable.ordinal,
    })
    .from(successionCandidatesTable)
    .leftJoin(readinessLevelsTable, eq(readinessLevelsTable.id, successionCandidatesTable.readinessLevelId))
    .where(and(...predicates))
    .orderBy(asc(readinessLevelsTable.ordinal), asc(successionCandidatesTable.id));

  return rows.map((r) => ({
    ...r.candidate,
    readinessLabel: r.readinessLabel ?? null,
    readinessOrdinal: r.readinessOrdinal ?? null,
  }));
}

export async function getCandidate(
  organizationId: number,
  candidateId: number,
): Promise<SuccessionCandidate | undefined> {
  const [row] = await db
    .select()
    .from(successionCandidatesTable)
    .where(
      and(
        eq(successionCandidatesTable.id, candidateId),
        eq(successionCandidatesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row;
}

export async function listCandidateEvents(
  organizationId: number,
  candidateId: number,
): Promise<SuccessionCandidateEvent[]> {
  return db
    .select()
    .from(successionCandidateEventsTable)
    .where(
      and(
        eq(successionCandidateEventsTable.organizationId, organizationId),
        eq(successionCandidateEventsTable.candidateId, candidateId),
      ),
    )
    .orderBy(asc(successionCandidateEventsTable.occurredAt), asc(successionCandidateEventsTable.id));
}

async function appendCandidateEvent(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    organizationId: number;
    candidateId: number;
    eventType: SuccessionCandidateEvent["eventType"];
    previousReadinessLevelId?: number | null;
    newReadinessLevelId?: number | null;
    notes?: string | null;
    actorUserId: number;
    actorMembershipId: number | null;
  },
): Promise<void> {
  await tx.insert(successionCandidateEventsTable).values({
    organizationId: params.organizationId,
    candidateId: params.candidateId,
    eventType: params.eventType,
    previousReadinessLevelId: params.previousReadinessLevelId ?? null,
    newReadinessLevelId: params.newReadinessLevelId ?? null,
    notes: params.notes ?? null,
    actorUserId: params.actorUserId,
    actorMembershipId: params.actorMembershipId,
    occurredAt: new Date(),
  });
}

/**
 * Nominates a candidate.
 *
 * A separated employee cannot be nominated: an active candidacy for somebody
 * who has left is not a succession plan, it is a stale one. Existing candidacies
 * are left alone — history is never rewritten because circumstances changed.
 */
export async function nominateCandidate(params: {
  organizationId: number;
  planId: number;
  employeeId: number;
  readinessLevelId?: number | null;
  rationale?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<SuccessionCandidate> {
  const plan = await getPlan(params.organizationId, params.planId);
  if (!plan) throw new SuccessionPlanNotFoundError();
  if (plan.status === "closed") throw new InvalidSuccessionError("This succession plan is closed.");

  const [employee] = await db
    .select({ id: employeesTable.id, employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new InvalidSuccessionError("Employee not found in this organization.");
  if (employee.employmentStatus === "terminated") {
    throw new InvalidSuccessionError("A separated employee cannot be nominated as a successor.");
  }

  if (params.readinessLevelId != null) {
    const level = await getReadinessLevel(params.organizationId, params.readinessLevelId);
    if (!level) throw new ReadinessLevelNotFoundError();
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(successionCandidatesTable)
        .values({
          organizationId: params.organizationId,
          planId: params.planId,
          employeeId: params.employeeId,
          status: "active",
          readinessLevelId: params.readinessLevelId ?? null,
          rationale: params.rationale ?? null,
          nominatedByUserId: params.actorApplicationUserId,
          nominatedAt: new Date(),
        })
        .returning();
      await appendCandidateEvent(tx, {
        organizationId: params.organizationId,
        candidateId: row!.id,
        eventType: "nominated",
        newReadinessLevelId: params.readinessLevelId ?? null,
        actorUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
      });
      return row!;
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "succession_candidate.nominated",
      targetType: "succession_candidate",
      targetId: String(created.id),
      // The rationale is confidential and stays out of audit (§30.23).
      afterState: { planId: created.planId, employeeId: created.employeeId, status: created.status },
    });
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvalidSuccessionError("This employee is already an active candidate on this plan.");
    }
    throw err;
  }
}

/**
 * Sets readiness — a HUMAN decision, recorded with its history (§30.13).
 *
 * Nothing computes the value. The caller supplies a level a person chose, and
 * the previous value is preserved in the candidate's event history rather than
 * being overwritten out of existence.
 */
export async function setReadiness(params: {
  organizationId: number;
  candidateId: number;
  readinessLevelId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<SuccessionCandidate> {
  const candidate = await getCandidate(params.organizationId, params.candidateId);
  if (!candidate) throw new SuccessionCandidateNotFoundError();
  if (candidate.status !== "active") throw new InvalidSuccessionError("This candidate is not active.");

  const level = await getReadinessLevel(params.organizationId, params.readinessLevelId);
  if (!level) throw new ReadinessLevelNotFoundError();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(successionCandidatesTable)
      .set({ readinessLevelId: params.readinessLevelId })
      .where(eq(successionCandidatesTable.id, params.candidateId))
      .returning();
    await appendCandidateEvent(tx, {
      organizationId: params.organizationId,
      candidateId: params.candidateId,
      eventType: "readiness_changed",
      previousReadinessLevelId: candidate.readinessLevelId,
      newReadinessLevelId: params.readinessLevelId,
      notes: params.notes ?? null,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "succession_candidate.readiness_changed",
    targetType: "succession_candidate",
    targetId: String(params.candidateId),
    beforeState: { readinessLevelId: candidate.readinessLevelId },
    afterState: { readinessLevelId: updated.readinessLevelId },
  });

  return updated;
}

/** Removes a candidate. The row and its history survive; only the status changes. */
export async function removeCandidate(params: {
  organizationId: number;
  candidateId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<SuccessionCandidate> {
  const candidate = await getCandidate(params.organizationId, params.candidateId);
  if (!candidate) throw new SuccessionCandidateNotFoundError();
  if (candidate.status !== "active") throw new InvalidSuccessionError("This candidate is not active.");
  if (!params.reason.trim()) throw new InvalidSuccessionError("A reason is required to remove a candidate.");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(successionCandidatesTable)
      .set({ status: "removed", removedAt: new Date(), removedBy: params.actorApplicationUserId })
      .where(eq(successionCandidatesTable.id, params.candidateId))
      .returning();
    await appendCandidateEvent(tx, {
      organizationId: params.organizationId,
      candidateId: params.candidateId,
      eventType: "removed",
      notes: params.reason.trim(),
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "succession_candidate.removed",
    targetType: "succession_candidate",
    targetId: String(params.candidateId),
    beforeState: { status: candidate.status },
    afterState: { status: updated.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Development actions (§30.14)
// ---------------------------------------------------------------------------

export async function listDevelopmentActions(
  organizationId: number,
  filters: { employeeId?: number; status?: DevelopmentAction["status"] } = {},
): Promise<DevelopmentAction[]> {
  const predicates = [eq(developmentActionsTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(developmentActionsTable.employeeId, filters.employeeId));
  if (filters.status) predicates.push(eq(developmentActionsTable.status, filters.status));
  return db
    .select()
    .from(developmentActionsTable)
    .where(and(...predicates))
    .orderBy(desc(developmentActionsTable.createdAt));
}

/**
 * Creates a development action.
 *
 * Learning references are VALIDATED FOR ORGANIZATION OWNERSHIP AND THEN LEFT
 * ALONE (§30.14). This function creates no course, enrols nobody, issues no
 * certificate and changes no enrolment state — and nothing enrols automatically
 * because a gap exists. The Learning module remains authoritative.
 */
export async function createDevelopmentAction(params: {
  organizationId: number;
  employeeId: number;
  action: string;
  skillId?: number | null;
  successionCandidateId?: number | null;
  targetDate?: Date | null;
  learningCourseId?: number | null;
  learningEnrollmentId?: number | null;
  evidenceDocumentId?: number | null;
  responsibleMembershipId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DevelopmentAction> {
  if (!params.action.trim()) throw new InvalidSuccessionError("An action description is required.");
  await assertBelongsToOrganization(employeesTable, params.employeeId, params.organizationId, "Employee");
  if (params.skillId != null) {
    await assertBelongsToOrganization(skillsTable, params.skillId, params.organizationId, "Skill");
  }
  if (params.learningCourseId != null) {
    await assertBelongsToOrganization(
      learningCoursesTable,
      params.learningCourseId,
      params.organizationId,
      "Learning course",
    );
  }
  if (params.learningEnrollmentId != null) {
    await assertBelongsToOrganization(
      learningEnrollmentsTable,
      params.learningEnrollmentId,
      params.organizationId,
      "Learning enrolment",
    );
  }
  if (params.evidenceDocumentId != null) {
    await assertBelongsToOrganization(
      employeeDocumentsTable,
      params.evidenceDocumentId,
      params.organizationId,
      "Evidence document",
    );
  }
  if (params.successionCandidateId != null) {
    const candidate = await getCandidate(params.organizationId, params.successionCandidateId);
    if (!candidate) throw new SuccessionCandidateNotFoundError();
  }

  const [created] = await db
    .insert(developmentActionsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      skillId: params.skillId ?? null,
      successionCandidateId: params.successionCandidateId ?? null,
      action: params.action.trim(),
      status: "open",
      targetDate: params.targetDate ?? null,
      learningCourseId: params.learningCourseId ?? null,
      learningEnrollmentId: params.learningEnrollmentId ?? null,
      evidenceDocumentId: params.evidenceDocumentId ?? null,
      responsibleMembershipId: params.responsibleMembershipId ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "development_action.created",
    targetType: "development_action",
    targetId: String(created!.id),
    afterState: { employeeId: created!.employeeId, skillId: created!.skillId, status: created!.status },
  });

  return created!;
}

export async function updateDevelopmentAction(params: {
  organizationId: number;
  actionId: number;
  action?: string;
  status?: DevelopmentAction["status"];
  targetDate?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DevelopmentAction> {
  const [before] = await db
    .select()
    .from(developmentActionsTable)
    .where(
      and(
        eq(developmentActionsTable.id, params.actionId),
        eq(developmentActionsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!before) throw new DevelopmentActionNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.action !== undefined) {
    if (!params.action.trim()) throw new InvalidSuccessionError("An action description is required.");
    patch.action = params.action.trim();
  }
  if (params.status !== undefined) patch.status = params.status;
  if (params.targetDate !== undefined) patch.targetDate = params.targetDate;

  const [updated] = await db
    .update(developmentActionsTable)
    .set(patch)
    .where(eq(developmentActionsTable.id, params.actionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "development_action.updated",
    targetType: "development_action",
    targetId: String(params.actionId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status },
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// Read models (§30.25)
// ---------------------------------------------------------------------------

export interface SuccessionCoverageRow {
  planId: number;
  positionId: number;
  positionTitle: string;
  status: string;
  candidateCount: number;
  /** Candidates at the nearest-term readiness band. Never a rank. */
  nearestTermReadyCount: number;
  hasNoCandidates: boolean;
}

/**
 * Succession coverage: how many candidates each critical position has.
 *
 * Counts only. No candidate identity, no rationale, no note — a coverage report
 * must never become the route by which confidential succession content reaches
 * a caller who could not read the plan itself (§30.25).
 */
export async function successionCoverage(organizationId: number): Promise<SuccessionCoverageRow[]> {
  const plans = await db
    .select({ plan: successionPlansTable, positionTitle: positionsTable.title })
    .from(successionPlansTable)
    .innerJoin(positionsTable, eq(positionsTable.id, successionPlansTable.positionId))
    .where(
      and(
        eq(successionPlansTable.organizationId, organizationId),
        inArray(successionPlansTable.status, ["active", "under_review"]),
      ),
    );
  if (plans.length === 0) return [];

  const candidates = await db
    .select({
      planId: successionCandidatesTable.planId,
      readinessOrdinal: readinessLevelsTable.ordinal,
    })
    .from(successionCandidatesTable)
    .leftJoin(readinessLevelsTable, eq(readinessLevelsTable.id, successionCandidatesTable.readinessLevelId))
    .where(
      and(
        eq(successionCandidatesTable.organizationId, organizationId),
        eq(successionCandidatesTable.status, "active"),
        inArray(
          successionCandidatesTable.planId,
          plans.map((p) => p.plan.id),
        ),
      ),
    );

  // The nearest-term band is ordinal 1 by the scale's own definition. This is a
  // grouping, not a ranking of people.
  const byPlan = new Map<number, { total: number; nearest: number }>();
  for (const c of candidates) {
    const entry = byPlan.get(c.planId) ?? { total: 0, nearest: 0 };
    entry.total += 1;
    if (c.readinessOrdinal === 1) entry.nearest += 1;
    byPlan.set(c.planId, entry);
  }

  return plans.map(({ plan, positionTitle }) => {
    const entry = byPlan.get(plan.id) ?? { total: 0, nearest: 0 };
    return {
      planId: plan.id,
      positionId: plan.positionId,
      positionTitle,
      status: plan.status,
      candidateCount: entry.total,
      nearestTermReadyCount: entry.nearest,
      hasNoCandidates: entry.total === 0,
    };
  });
}
