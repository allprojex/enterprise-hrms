/**
 * WS-9 — Recruitment approval stage configuration and authority resolution
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.2).
 *
 * This is deliberately NOT a workflow engine. OD #14 forbids replacing working
 * domain workflows with a generic one, so there is no rule language, no
 * expression evaluator and no state-machine DSL here — an organization orders
 * a list of stages, each naming one of three server-defined resolvers, and the
 * service walks that list.
 *
 * The rule that matters most: **a role name never confers approval authority.**
 * Holding `hr_manager`, `department_head` or `org_admin` does not make anyone
 * an approver. Authority is re-resolved from live relationships, permissions
 * and configuration at the moment of every decision, and is never taken from
 * the client.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  recruitmentApprovalStagesTable,
  organizationMembershipsTable,
  usersTable,
  type RecruitmentApprovalStage,
  type RecruitmentApprovalPurpose,
} from "@workspace/db";
import { hasPermission } from "./permissions";
import { resolveDepartmentHeadAsOf } from "./departmentHeads";
import { isUniqueViolation } from "./dbErrors";

export class RecruitmentApprovalConfigError extends Error {}

export class NotAuthorizedForStageError extends Error {
  constructor(stageName: string) {
    super(`You are not authorized to decide the "${stageName}" stage`);
    this.name = "NotAuthorizedForStageError";
  }
}

/** What the resolver proved, recorded verbatim on the decision so history stays interpretable. */
export interface AuthorityGrant {
  authorityBasis: string;
}

export interface StageConfigInput {
  purpose: RecruitmentApprovalPurpose;
  stageOrder: number;
  name: string;
  resolverType: RecruitmentApprovalStage["resolverType"];
  resolverConfig?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates a stage's resolver configuration for its declared type. A stage is
 * stored only if its configuration is coherent, so every later resolution is
 * total rather than defensive.
 */
export function assertValidStageConfig(input: StageConfigInput): Record<string, unknown> | null {
  if (!Number.isInteger(input.stageOrder) || input.stageOrder < 1) {
    throw new RecruitmentApprovalConfigError("Stage order must be a whole number of 1 or more");
  }
  if (!input.name?.trim()) throw new RecruitmentApprovalConfigError("Stage name is required");

  const raw = input.resolverConfig;
  switch (input.resolverType) {
    case "department_head":
      // The subject supplies the department; nothing to configure.
      return null;
    case "permission_holder": {
      if (!isPlainObject(raw)) throw new RecruitmentApprovalConfigError("This stage needs a permission key");
      const permissionKey = typeof raw.permissionKey === "string" ? raw.permissionKey.trim() : "";
      if (!permissionKey) throw new RecruitmentApprovalConfigError("This stage needs a permission key");
      return { permissionKey };
    }
    case "specific_membership": {
      if (!isPlainObject(raw)) throw new RecruitmentApprovalConfigError("This stage needs a named approver");
      const membershipId = Number(raw.membershipId);
      if (!Number.isInteger(membershipId) || membershipId <= 0) {
        throw new RecruitmentApprovalConfigError("This stage needs a named approver");
      }
      return { membershipId };
    }
  }
}

export async function listApprovalStages(
  organizationId: number,
  purpose: RecruitmentApprovalPurpose,
): Promise<RecruitmentApprovalStage[]> {
  return db
    .select()
    .from(recruitmentApprovalStagesTable)
    .where(
      and(eq(recruitmentApprovalStagesTable.organizationId, organizationId), eq(recruitmentApprovalStagesTable.purpose, purpose)),
    )
    .orderBy(asc(recruitmentApprovalStagesTable.stageOrder));
}

export async function createApprovalStage(params: {
  organizationId: number;
  input: StageConfigInput;
  actorMembershipId: number | null;
}): Promise<RecruitmentApprovalStage> {
  const resolverConfig = assertValidStageConfig(params.input);

  if (params.input.resolverType === "specific_membership") {
    // A named approver must be a real, active member of THIS organization —
    // otherwise a stage could name someone from another tenant.
    const membershipId = Number((resolverConfig as { membershipId: number }).membershipId);
    const [member] = await db
      .select({ id: organizationMembershipsTable.id })
      .from(organizationMembershipsTable)
      .where(
        and(
          eq(organizationMembershipsTable.id, membershipId),
          eq(organizationMembershipsTable.organizationId, params.organizationId),
          eq(organizationMembershipsTable.status, "active"),
        ),
      )
      .limit(1);
    if (!member) throw new RecruitmentApprovalConfigError("The named approver is not an active member of this organization");
  }

  try {
    const [stage] = await db
      .insert(recruitmentApprovalStagesTable)
      .values({
        organizationId: params.organizationId,
        purpose: params.input.purpose,
        stageOrder: params.input.stageOrder,
        name: params.input.name.trim(),
        resolverType: params.input.resolverType,
        resolverConfig,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    return stage;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new RecruitmentApprovalConfigError(`Stage ${params.input.stageOrder} is already configured for this purpose`);
    }
    throw err;
  }
}

export async function deleteApprovalStage(organizationId: number, stageId: number): Promise<void> {
  // Deleting configuration never touches decisions already recorded — those
  // carry their own snapshots precisely so configuration can change freely.
  await db
    .delete(recruitmentApprovalStagesTable)
    .where(and(eq(recruitmentApprovalStagesTable.id, stageId), eq(recruitmentApprovalStagesTable.organizationId, organizationId)));
}

/**
 * Decides whether `actorMembershipId` may act on `stage` right now, and
 * returns the basis on which they qualified.
 *
 * `departmentId` is the subject's own department (a requisition's department,
 * or the department of the position being hired into) — supplied by the
 * caller, never by the client.
 *
 * Returns null when the actor does not qualify. Callers convert that into
 * `NotAuthorizedForStageError`; this function does not throw so it can also be
 * used to answer "can I act?" for UI without exception control flow.
 */
export async function resolveStageAuthority(params: {
  organizationId: number;
  stage: RecruitmentApprovalStage;
  actorMembershipId: number;
  departmentId: number | null;
}): Promise<AuthorityGrant | null> {
  const { stage } = params;
  const config = (stage.resolverConfig ?? {}) as Record<string, unknown>;

  switch (stage.resolverType) {
    case "department_head": {
      if (params.departmentId == null) return null;
      // Resolves through the authoritative, temporal department_heads
      // relationship — never a role name (§25.2). `resolveDepartmentHeadAsOf`
      // already honours validFrom/validTo, so a head who has since been
      // replaced cannot approve today, and today's head is used rather than
      // whoever held it when the request was raised.
      const head = await resolveDepartmentHeadAsOf(params.organizationId, params.departmentId);
      if (!head || head.headMembershipId !== params.actorMembershipId) return null;
      return { authorityBasis: `Department head of department ${params.departmentId}` };
    }
    case "permission_holder": {
      const permissionKey = String(config.permissionKey ?? "");
      if (!permissionKey) return null;
      if (!(await hasPermission(params.actorMembershipId, permissionKey))) return null;
      return { authorityBasis: `Holder of permission "${permissionKey}"` };
    }
    case "specific_membership": {
      const membershipId = Number(config.membershipId);
      if (!Number.isInteger(membershipId) || membershipId !== params.actorMembershipId) return null;
      return { authorityBasis: `Named approver for stage "${stage.name}"` };
    }
  }
}

/** The actor's display name at decision time, snapshotted so history survives renames. */
export async function resolveActorNameSnapshot(membershipId: number): Promise<string | null> {
  const [row] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
    .from(organizationMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, organizationMembershipsTable.applicationUserId))
    .where(eq(organizationMembershipsTable.id, membershipId))
    .limit(1);
  if (!row) return null;
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return name || row.email || null;
}
