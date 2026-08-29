import { and, asc, eq } from "drizzle-orm";
import {
  db,
  requestApprovalStagesTable,
  employeesTable,
  organizationMembershipsTable,
  type RequestApprovalStage,
} from "@workspace/db";
import { getCurrentDepartmentHead } from "../departmentHeads";
import { getEffectivePermissions } from "../permissions";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-13 — approval-stage configuration and bounded authority resolution
 * (§29.8, §29.9, §29.18).
 *
 * WS-13's OWN, NOT A SHARED PRIMITIVE. This mirrors WS-9's proven design and
 * deliberately does not consume, extend or refactor it. §29.9 is explicit that
 * WS-13 must not claim OD #14: there is no cross-product approval engine here,
 * and nothing in Recruitment was touched or made to depend on this file.
 *
 * AUTHORITY IS NEVER INFERRED FROM A ROLE NAME. A stage names one of three
 * server-defined resolvers and supplies data; it cannot supply code. Adding a
 * resolver is a deliberate change a reviewer can see — the §25.2 ruling,
 * extended.
 */

export class InvalidStageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStageConfigError";
  }
}

export type ApprovalPurpose = RequestApprovalStage["purpose"];

export async function listStages(organizationId: number, purpose: ApprovalPurpose): Promise<RequestApprovalStage[]> {
  return db
    .select()
    .from(requestApprovalStagesTable)
    .where(
      and(
        eq(requestApprovalStagesTable.organizationId, organizationId),
        eq(requestApprovalStagesTable.purpose, purpose),
      ),
    )
    .orderBy(asc(requestApprovalStagesTable.stageOrder));
}

export async function getStage(
  organizationId: number,
  purpose: ApprovalPurpose,
  stageOrder: number,
): Promise<RequestApprovalStage | undefined> {
  const [row] = await db
    .select()
    .from(requestApprovalStagesTable)
    .where(
      and(
        eq(requestApprovalStagesTable.organizationId, organizationId),
        eq(requestApprovalStagesTable.purpose, purpose),
        eq(requestApprovalStagesTable.stageOrder, stageOrder),
      ),
    )
    .limit(1);
  return row;
}

/** Validates resolver input per resolver type before a stage is ever stored. */
function validateResolverConfig(
  resolverType: RequestApprovalStage["resolverType"],
  resolverConfig: unknown,
): Record<string, unknown> {
  const config = (resolverConfig ?? {}) as Record<string, unknown>;
  if (resolverType === "permission_holder") {
    const key = config["permissionKey"];
    if (typeof key !== "string" || !key.trim()) {
      throw new InvalidStageConfigError("A permission_holder stage requires a permissionKey.");
    }
    return { permissionKey: key.trim() };
  }
  if (resolverType === "specific_membership") {
    const membershipId = config["membershipId"];
    if (typeof membershipId !== "number" || !Number.isInteger(membershipId) || membershipId <= 0) {
      throw new InvalidStageConfigError("A specific_membership stage requires a numeric membershipId.");
    }
    return { membershipId };
  }
  // department_head takes no configuration — the subject supplies the department.
  return {};
}

export async function createStage(params: {
  organizationId: number;
  purpose: ApprovalPurpose;
  stageOrder: number;
  name: string;
  resolverType: RequestApprovalStage["resolverType"];
  resolverConfig?: unknown;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RequestApprovalStage> {
  if (!params.name.trim()) throw new InvalidStageConfigError("A stage name is required.");
  if (!Number.isInteger(params.stageOrder) || params.stageOrder < 1) {
    throw new InvalidStageConfigError("Stage order must be a positive integer.");
  }
  const resolverConfig = validateResolverConfig(params.resolverType, params.resolverConfig);

  // A specific_membership stage must name a membership in THIS organization —
  // otherwise a cross-tenant id would silently become an approver.
  if (params.resolverType === "specific_membership") {
    const [membership] = await db
      .select({ id: organizationMembershipsTable.id })
      .from(organizationMembershipsTable)
      .where(
        and(
          eq(organizationMembershipsTable.id, resolverConfig["membershipId"] as number),
          eq(organizationMembershipsTable.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!membership) throw new InvalidStageConfigError("That membership does not belong to this organization.");
  }

  const [created] = await db
    .insert(requestApprovalStagesTable)
    .values({
      organizationId: params.organizationId,
      purpose: params.purpose,
      stageOrder: params.stageOrder,
      name: params.name.trim(),
      resolverType: params.resolverType,
      resolverConfig,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "request_approval_stage.created",
    targetType: "request_approval_stage",
    targetId: String(created!.id),
    afterState: {
      purpose: created!.purpose,
      stageOrder: created!.stageOrder,
      name: created!.name,
      resolverType: created!.resolverType,
    },
  });

  return created!;
}

export async function deleteStage(params: {
  organizationId: number;
  stageId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(requestApprovalStagesTable)
    .where(
      and(
        eq(requestApprovalStagesTable.id, params.stageId),
        eq(requestApprovalStagesTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new InvalidStageConfigError("Stage not found in this organization.");

  await db.delete(requestApprovalStagesTable).where(eq(requestApprovalStagesTable.id, params.stageId));

  // Deleting a stage does NOT touch in-flight requests: each froze its own
  // stage count when it was raised (§29.8), so a request already running
  // continues against the chain it started with.
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "request_approval_stage.deleted",
    targetType: "request_approval_stage",
    targetId: String(params.stageId),
    beforeState: { purpose: existing.purpose, stageOrder: existing.stageOrder, name: existing.name },
  });
}

/**
 * Whether a membership holds the authority a given stage names.
 *
 * Every resolver re-checks LIVE state at the moment of the decision. A stage
 * naming a Department Head resolves through the authoritative
 * `department_heads` relationship for the subject's own department, so a
 * replacement Head takes over pending work automatically and a former Head
 * stops being able to decide — the same live-recheck principle Office
 * Inventory's delegation established.
 */
export async function membershipSatisfiesStage(params: {
  organizationId: number;
  stage: RequestApprovalStage;
  membershipId: number;
  subjectEmployeeId: number;
}): Promise<boolean> {
  const config = (params.stage.resolverConfig ?? {}) as Record<string, unknown>;

  if (params.stage.resolverType === "specific_membership") {
    return config["membershipId"] === params.membershipId;
  }

  if (params.stage.resolverType === "permission_holder") {
    const permissionKey = config["permissionKey"];
    if (typeof permissionKey !== "string") return false;
    const permissions = await getEffectivePermissions(params.membershipId);
    return permissions.has(permissionKey);
  }

  // department_head — the subject employee's own department decides who this is.
  const [employee] = await db
    .select({ departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.id, params.subjectEmployeeId), eq(employeesTable.organizationId, params.organizationId)),
    )
    .limit(1);
  if (!employee?.departmentId) return false;

  const head = await getCurrentDepartmentHead(params.organizationId, employee.departmentId);
  return head?.headMembershipId === params.membershipId;
}
