/**
 * Leave Policies (Phase 2B, W32): eligibility + entitlement rules attached
 * to a Leave Type. Deliberately independent of Leave Types (leaveTypes.ts)
 * — this file only ever touches `leave_policies`; it reads a leave type
 * only to confirm the parent reference is valid. Reuses
 * assertBelongsToOrganization (ADR-012) for every cross-org reference
 * (leave type, branch, department, position) rather than trusting a
 * client-supplied ID.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  leavePoliciesTable,
  leaveTypesTable,
  branchesTable,
  departmentsTable,
  positionsTable,
  type LeavePolicy,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization } from "./orgScopedRefs";

export class LeavePolicyNotFoundError extends Error {
  constructor() {
    super("Leave policy not found");
    this.name = "LeavePolicyNotFoundError";
  }
}

export class InvalidLeavePolicyError extends Error {}

type LeavePolicyEmploymentType = "full_time" | "part_time" | "contract" | "intern" | "temporary";
type LeavePolicyGender = "male" | "female" | "other" | "prefer_not_to_say";

export interface LeavePolicyFields {
  name: string;
  employmentType?: LeavePolicyEmploymentType | null;
  branchId?: number | null;
  departmentId?: number | null;
  positionId?: number | null;
  gender?: LeavePolicyGender | null;
  minimumServiceMonths?: number | null;
  probationRestricted?: boolean;
  annualEntitlementDays: string;
  isPaid?: boolean;
  accrualMethod?: "annual" | "monthly" | "per_pay_period" | "none";
  accrualRate?: string | null;
  entitlementPeriod?: "calendar_year" | "anniversary_year";
  carryForwardAllowed?: boolean;
  maxCarryForwardDays?: string | null;
  carryForwardExpiryMonths?: number | null;
  minRequestDurationDays?: string | null;
  maxRequestDurationDays?: string | null;
  noticePeriodDays?: number | null;
  // Phase 3H, W117 (frozen plan Decision 11) — nullable, defaulting to
  // unset/calendar-days behavior. See leaveRequests.ts's
  // resolveEarliestAllowedStartDate for the actual working-day calculation.
  noticePeriodCountsWorkingDaysOnly?: boolean | null;
  attachmentRequired?: boolean;
  countWeekends?: boolean;
  countPublicHolidays?: boolean;
  allowNegativeBalance?: boolean;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

function num(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Cross-field validation the DB's column types can't express on their own. */
function assertValidPolicyFields(fields: Partial<LeavePolicyFields>): void {
  if (fields.effectiveFrom !== undefined && fields.effectiveTo != null && fields.effectiveTo < fields.effectiveFrom) {
    throw new InvalidLeavePolicyError("effectiveTo cannot be before effectiveFrom");
  }
  const entitlement = num(fields.annualEntitlementDays);
  if (fields.annualEntitlementDays !== undefined && (entitlement == null || entitlement < 0)) {
    throw new InvalidLeavePolicyError("annualEntitlementDays must be a non-negative number");
  }
  const accrualRate = num(fields.accrualRate);
  if (fields.accrualRate !== undefined && fields.accrualRate !== null && (accrualRate == null || accrualRate < 0)) {
    throw new InvalidLeavePolicyError("accrualRate must be a non-negative number");
  }
  if (fields.carryForwardAllowed) {
    const maxCarryForward = num(fields.maxCarryForwardDays);
    if (fields.maxCarryForwardDays === undefined || maxCarryForward == null || maxCarryForward < 0) {
      throw new InvalidLeavePolicyError("maxCarryForwardDays is required and must be non-negative when carryForwardAllowed is true");
    }
  }
  const min = num(fields.minRequestDurationDays);
  const max = num(fields.maxRequestDurationDays);
  if (min != null && max != null && min > max) {
    throw new InvalidLeavePolicyError("minRequestDurationDays cannot exceed maxRequestDurationDays");
  }
}

async function assertLeaveTypeExists(organizationId: number, leaveTypeId: number): Promise<void> {
  const [row] = await db
    .select({ id: leaveTypesTable.id })
    .from(leaveTypesTable)
    .where(and(eq(leaveTypesTable.id, leaveTypeId), eq(leaveTypesTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new InvalidLeavePolicyError("Leave type not found in this organization");
}

export async function listLeavePolicies(organizationId: number, leaveTypeId: number): Promise<LeavePolicy[]> {
  return db
    .select()
    .from(leavePoliciesTable)
    .where(and(eq(leavePoliciesTable.organizationId, organizationId), eq(leavePoliciesTable.leaveTypeId, leaveTypeId)));
}

async function findOwnLeavePolicy(organizationId: number, leaveTypeId: number, leavePolicyId: number) {
  const [row] = await db
    .select()
    .from(leavePoliciesTable)
    .where(
      and(
        eq(leavePoliciesTable.id, leavePolicyId),
        eq(leavePoliciesTable.organizationId, organizationId),
        eq(leavePoliciesTable.leaveTypeId, leaveTypeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createLeavePolicy(params: {
  organizationId: number;
  leaveTypeId: number;
  fields: LeavePolicyFields;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeavePolicy> {
  await assertLeaveTypeExists(params.organizationId, params.leaveTypeId);
  await assertBelongsToOrganization(branchesTable, params.fields.branchId, params.organizationId, "Branch");
  await assertBelongsToOrganization(departmentsTable, params.fields.departmentId, params.organizationId, "Department");
  await assertBelongsToOrganization(positionsTable, params.fields.positionId, params.organizationId, "Position");
  assertValidPolicyFields(params.fields);

  const [policy] = await db
    .insert(leavePoliciesTable)
    .values({
      organizationId: params.organizationId,
      leaveTypeId: params.leaveTypeId,
      ...params.fields,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_policy.created",
    targetType: "leave_policy",
    targetId: String(policy.id),
    afterState: { leaveTypeId: policy.leaveTypeId, name: policy.name },
  });

  return policy;
}

export async function updateLeavePolicy(params: {
  organizationId: number;
  leaveTypeId: number;
  leavePolicyId: number;
  fields: Partial<LeavePolicyFields>;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeavePolicy> {
  const before = await findOwnLeavePolicy(params.organizationId, params.leaveTypeId, params.leavePolicyId);
  if (!before) throw new LeavePolicyNotFoundError();

  await assertBelongsToOrganization(branchesTable, params.fields.branchId, params.organizationId, "Branch");
  await assertBelongsToOrganization(departmentsTable, params.fields.departmentId, params.organizationId, "Department");
  await assertBelongsToOrganization(positionsTable, params.fields.positionId, params.organizationId, "Position");
  assertValidPolicyFields({
    annualEntitlementDays: before.annualEntitlementDays,
    effectiveFrom: before.effectiveFrom,
    effectiveTo: before.effectiveTo,
    carryForwardAllowed: before.carryForwardAllowed,
    maxCarryForwardDays: before.maxCarryForwardDays,
    ...params.fields,
  });

  const [updated] = await db
    .update(leavePoliciesTable)
    .set(params.fields)
    .where(eq(leavePoliciesTable.id, params.leavePolicyId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_policy.updated",
    targetType: "leave_policy",
    targetId: String(params.leavePolicyId),
    beforeState: { name: before.name },
    afterState: { name: updated.name },
  });

  return updated;
}

async function setLeavePolicyStatus(params: {
  organizationId: number;
  leaveTypeId: number;
  leavePolicyId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeavePolicy> {
  const before = await findOwnLeavePolicy(params.organizationId, params.leaveTypeId, params.leavePolicyId);
  if (!before) throw new LeavePolicyNotFoundError();

  const [updated] = await db
    .update(leavePoliciesTable)
    .set({ status: params.status })
    .where(eq(leavePoliciesTable.id, params.leavePolicyId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "leave_policy",
    targetId: String(params.leavePolicyId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const archiveLeavePolicy = (params: {
  organizationId: number;
  leaveTypeId: number;
  leavePolicyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setLeavePolicyStatus({ ...params, status: "inactive", eventType: "leave_policy.archived" });

export const reactivateLeavePolicy = (params: {
  organizationId: number;
  leaveTypeId: number;
  leavePolicyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setLeavePolicyStatus({ ...params, status: "active", eventType: "leave_policy.reactivated" });
