/**
 * Leave Types (Phase 2B, W32): the named leave category an organization
 * defines. Deliberately independent of Leave Policies (leavePolicies.ts) —
 * this file only ever touches `leave_types`. Mirrors
 * organizationStructureService.ts's updateBranch/archiveBranch/
 * reactivateBranch shape (ADR-012 precedent applied to a new entity).
 */
import { and, eq } from "drizzle-orm";
import { db, leaveTypesTable, type LeaveType } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class LeaveTypeNotFoundError extends Error {
  constructor() {
    super("Leave type not found");
    this.name = "LeaveTypeNotFoundError";
  }
}

export async function listLeaveTypes(organizationId: number): Promise<LeaveType[]> {
  return db.select().from(leaveTypesTable).where(eq(leaveTypesTable.organizationId, organizationId));
}

async function findOwnLeaveType(organizationId: number, leaveTypeId: number) {
  const [row] = await db
    .select()
    .from(leaveTypesTable)
    .where(and(eq(leaveTypesTable.id, leaveTypeId), eq(leaveTypesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getLeaveTypeById(organizationId: number, leaveTypeId: number): Promise<LeaveType | null> {
  return findOwnLeaveType(organizationId, leaveTypeId);
}

export async function createLeaveType(params: {
  organizationId: number;
  name: string;
  code: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveType> {
  const [leaveType] = await db
    .insert(leaveTypesTable)
    .values({ organizationId: params.organizationId, name: params.name, code: params.code })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_type.created",
    targetType: "leave_type",
    targetId: String(leaveType.id),
    afterState: { name: leaveType.name, code: leaveType.code },
  });

  return leaveType;
}

export async function updateLeaveType(params: {
  organizationId: number;
  leaveTypeId: number;
  name?: string;
  code?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveType> {
  const before = await findOwnLeaveType(params.organizationId, params.leaveTypeId);
  if (!before) throw new LeaveTypeNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.code !== undefined) patch.code = params.code;

  const [updated] = await db
    .update(leaveTypesTable)
    .set(patch)
    .where(eq(leaveTypesTable.id, params.leaveTypeId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_type.updated",
    targetType: "leave_type",
    targetId: String(params.leaveTypeId),
    beforeState: { name: before.name, code: before.code },
    afterState: { name: updated.name, code: updated.code },
  });

  return updated;
}

async function setLeaveTypeStatus(params: {
  organizationId: number;
  leaveTypeId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveType> {
  const before = await findOwnLeaveType(params.organizationId, params.leaveTypeId);
  if (!before) throw new LeaveTypeNotFoundError();

  const [updated] = await db
    .update(leaveTypesTable)
    .set({ status: params.status })
    .where(eq(leaveTypesTable.id, params.leaveTypeId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "leave_type",
    targetId: String(params.leaveTypeId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const archiveLeaveType = (params: {
  organizationId: number;
  leaveTypeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setLeaveTypeStatus({ ...params, status: "inactive", eventType: "leave_type.archived" });

export const reactivateLeaveType = (params: {
  organizationId: number;
  leaveTypeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setLeaveTypeStatus({ ...params, status: "active", eventType: "leave_type.reactivated" });
