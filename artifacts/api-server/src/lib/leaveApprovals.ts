/**
 * Leave Approval Workflow (Phase 2B, W35): single-level approve/reject of a
 * pending leave request. Lives in its own file rather than leaveRequests.ts
 * or leaveBalances.ts — it depends on both (LeaveRequestNotFoundError,
 * getAvailableBalance, postApprovedUsageEntry), and either of those files
 * importing back from here would create a circular module dependency.
 * Reuses W33's leave_requests row/status and W34's ledger; invents no
 * second manager model — manager-scoped authorization is derived from
 * employees.reportingManagerId exactly as W33's GET route already does.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, leaveRequestsTable, leavePoliciesTable, employeesTable, type LeaveRequest } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { LeaveRequestNotFoundError } from "./leaveRequests";
import { getAvailableBalance, postApprovedUsageEntry } from "./leaveBalances";

export class LeaveRequestNotPendingError extends Error {
  constructor() {
    super("Leave request is not pending — it may already have been decided or withdrawn");
    this.name = "LeaveRequestNotPendingError";
  }
}

export class SelfApprovalNotAllowedError extends Error {
  constructor() {
    super("You cannot approve or reject your own leave request");
    this.name = "SelfApprovalNotAllowedError";
  }
}

export class InsufficientLeaveBalanceError extends Error {
  constructor() {
    super("Approving this request would take the employee's balance negative, which this policy does not allow");
    this.name = "InsufficientLeaveBalanceError";
  }
}

/** Requests with status "pending" the caller is authorized to act on — org-wide for HR, direct-reports-only otherwise. No new manager model: reuses employees.reportingManagerId exactly as W33's GET route does. */
export async function listPendingApprovals(
  organizationId: number,
  approverEmployeeId: number | null,
  isOrgWide: boolean,
): Promise<LeaveRequest[]> {
  if (isOrgWide) {
    return db
      .select()
      .from(leaveRequestsTable)
      .where(and(eq(leaveRequestsTable.organizationId, organizationId), eq(leaveRequestsTable.status, "pending")))
      .orderBy(desc(leaveRequestsTable.createdAt));
  }

  if (approverEmployeeId == null) return [];

  const managed = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, approverEmployeeId)));
  const managedIds = managed.map((e) => e.id);
  if (managedIds.length === 0) return [];

  return db
    .select()
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.organizationId, organizationId),
        eq(leaveRequestsTable.status, "pending"),
        inArray(leaveRequestsTable.employeeId, managedIds),
      ),
    )
    .orderBy(desc(leaveRequestsTable.createdAt));
}

async function findOwnLeaveRequest(organizationId: number, employeeId: number, leaveRequestId: number) {
  const [row] = await db
    .select()
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.id, leaveRequestId),
        eq(leaveRequestsTable.organizationId, organizationId),
        eq(leaveRequestsTable.employeeId, employeeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Approves a pending request atomically: a conditional `WHERE status =
 * 'pending'` update takes the row lock and fails as LeaveRequestNotPendingError
 * for a concurrent second caller (zero rows affected) rather than double-
 * posting; the balance-sufficiency check and the immutable `usage` ledger
 * entry are posted inside the same transaction, so an insufficient-balance
 * throw rolls back the status change too — no approved request can exist
 * without its ledger entry, and no ledger entry can exist without a
 * successful approval.
 */
export async function approveLeaveRequest(params: {
  organizationId: number;
  employeeId: number;
  leaveRequestId: number;
  approverEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveRequest> {
  const before = await findOwnLeaveRequest(params.organizationId, params.employeeId, params.leaveRequestId);
  if (!before) throw new LeaveRequestNotFoundError();
  if (params.approverEmployeeId != null && params.approverEmployeeId === before.employeeId) {
    throw new SelfApprovalNotAllowedError();
  }

  const [policy] = await db.select().from(leavePoliciesTable).where(eq(leavePoliciesTable.id, before.leavePolicyId)).limit(1);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(leaveRequestsTable)
      .set({ status: "approved", approvedBy: params.actorApplicationUserId, approvedAt: new Date() })
      .where(
        and(
          eq(leaveRequestsTable.id, params.leaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw new LeaveRequestNotPendingError();

    if (policy && !policy.allowNegativeBalance) {
      const available = await getAvailableBalance(params.organizationId, row.employeeId, row.leaveTypeId, tx);
      if (available - Number(row.daysRequested) < 0) {
        throw new InsufficientLeaveBalanceError();
      }
    }

    await postApprovedUsageEntry(tx, {
      organizationId: params.organizationId,
      employeeId: row.employeeId,
      leaveTypeId: row.leaveTypeId,
      leavePolicyId: row.leavePolicyId,
      daysRequested: Number(row.daysRequested),
      effectiveDate: row.startDate,
      relatedLeaveRequestId: row.id,
      approvedBy: params.actorApplicationUserId,
    });

    return row;
  });

  // Notification extension point (Architecture Principle 8): "approved" —
  // not implemented, same documented-not-built precedent as W33/W34.
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_request.approved",
    targetType: "leave_request",
    targetId: String(updated.id),
    beforeState: { status: before.status },
    afterState: { status: updated.status, approvedBy: updated.approvedBy, daysRequested: updated.daysRequested },
  });

  return updated;
}

/** Rejects a pending request atomically. Never posts a ledger entry — rejection deducts nothing. */
export async function rejectLeaveRequest(params: {
  organizationId: number;
  employeeId: number;
  leaveRequestId: number;
  approverEmployeeId: number | null;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveRequest> {
  const before = await findOwnLeaveRequest(params.organizationId, params.employeeId, params.leaveRequestId);
  if (!before) throw new LeaveRequestNotFoundError();
  if (params.approverEmployeeId != null && params.approverEmployeeId === before.employeeId) {
    throw new SelfApprovalNotAllowedError();
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(leaveRequestsTable)
      .set({ status: "rejected", rejectionReason: params.reason ?? null })
      .where(
        and(
          eq(leaveRequestsTable.id, params.leaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw new LeaveRequestNotPendingError();
    return row;
  });

  // Notification extension point (Architecture Principle 8): "rejected" —
  // not implemented, same documented-not-built precedent as W33/W34.
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_request.rejected",
    targetType: "leave_request",
    targetId: String(updated.id),
    beforeState: { status: before.status },
    afterState: { status: updated.status, rejectionReason: updated.rejectionReason },
  });

  return updated;
}
