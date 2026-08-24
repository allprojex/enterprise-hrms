/**
 * Leave Approval Workflow (Phase 2B W35, reworked by the Leave Approval
 * Workflow Reconciliation to a mandatory two-stage flow): Employee submits
 * → Department Head approves/rejects → HR gives final approval/rejection →
 * Approved Leave. Lives in its own file rather than leaveRequests.ts or
 * leaveBalances.ts — it depends on both (LeaveRequestNotFoundError,
 * getAvailableBalance, postApprovedUsageEntry), and either of those files
 * importing back from here would create a circular module dependency.
 *
 * Department Head authority is resolved from the ONE general
 * department_heads primitive (lib/departmentHeads.ts, introduced during the
 * Office Inventory epic but deliberately module-agnostic) — re-derived live
 * on every approve/reject call, never cached, never assumed from holding a
 * leave-specific permission (leave_request.approve is granted to every
 * employee; it gates "may attempt to act," not "is the authoritative
 * Department Head"). HR's final-stage authority is still the pre-existing
 * leave_request.manage permission — unchanged.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, leaveRequestsTable, leavePoliciesTable, employeesTable, type LeaveRequest } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { LeaveRequestNotFoundError } from "./leaveRequests";
import { getAvailableBalance, postApprovedUsageEntry } from "./leaveBalances";
import { resolveDepartmentHeadIdentity } from "./departmentHeads";

export class LeaveRequestNotPendingError extends Error {
  constructor() {
    super("Leave request is not awaiting a decision at this stage — it may already have been decided or withdrawn");
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

export type LeaveApprovalStage = "department_head" | "hr";

/** Thrown when the caller lacks the specific authority the request's CURRENT stage requires (holding leave_request.approve alone is never sufficient). */
export class NotAuthorizedForStageError extends Error {
  stage: LeaveApprovalStage;
  constructor(stage: LeaveApprovalStage) {
    super(
      stage === "department_head"
        ? "Only the employee's current Department Head can act on this request"
        : "Only HR can give final approval on this request",
    );
    this.name = "NotAuthorizedForStageError";
    this.stage = stage;
  }
}

export class RejectionReasonRequiredError extends Error {
  constructor() {
    super("A reason is required to reject a leave request");
    this.name = "RejectionReasonRequiredError";
  }
}

/**
 * Requests the caller is authorized to act on right now. HR
 * (leave_request.manage) sees every non-terminal request org-wide from the
 * moment it is submitted — both "pending" (awaiting Department Head) and
 * "pending_hr" (awaiting HR) — so HR is never blind to a request during the
 * Department Head stage, even though HR cannot yet act on a "pending" one.
 * A Department Head (no leave_request.manage) sees only "pending" requests
 * from the department(s) they currently, actually head — never derived from
 * reportingManagerId, never from holding leave_request.approve alone.
 */
export async function listPendingApprovals(
  organizationId: number,
  params: { isOrgWideHr: boolean; headedDepartmentIds: number[] },
): Promise<LeaveRequest[]> {
  if (params.isOrgWideHr) {
    return db
      .select()
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.organizationId, organizationId),
          inArray(leaveRequestsTable.status, ["pending", "pending_hr"]),
        ),
      )
      .orderBy(desc(leaveRequestsTable.createdAt));
  }

  if (params.headedDepartmentIds.length === 0) return [];

  const managed = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.departmentId, params.headedDepartmentIds)),
    );
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

interface StageActionParams {
  organizationId: number;
  employeeId: number;
  leaveRequestId: number;
  callerEmployeeId: number | null;
  actorMembershipId: number;
  actorApplicationUserId: number;
  isHr: boolean;
}

/**
 * Approves whichever stage the request currently sits at: "pending" moves
 * it to "pending_hr" under Department Head authority (re-resolved live);
 * "pending_hr" moves it to "approved" under HR authority and only THEN
 * checks balance/posts the usage ledger entry — a request is never balance-
 * deducted until it is truly, finally approved. Both stage transitions use
 * a conditional `WHERE status = <expected>` update as the atomic guard
 * against a concurrent second caller (or an attempt to act on the wrong
 * stage), exactly as the original single-stage W35 design did.
 */
export async function approveLeaveRequest(params: StageActionParams): Promise<LeaveRequest> {
  const before = await findOwnLeaveRequest(params.organizationId, params.employeeId, params.leaveRequestId);
  if (!before) throw new LeaveRequestNotFoundError();
  if (params.callerEmployeeId != null && params.callerEmployeeId === before.employeeId) {
    throw new SelfApprovalNotAllowedError();
  }

  if (before.status === "pending") {
    const [employee] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, before.employeeId)).limit(1);
    const head = await resolveDepartmentHeadIdentity(params.organizationId, employee?.departmentId ?? null);
    const isDeptHead = head != null && head.headMembershipId === params.actorMembershipId;
    if (!isDeptHead) throw new NotAuthorizedForStageError("department_head");

    const [row] = await db
      .update(leaveRequestsTable)
      .set({
        status: "pending_hr",
        departmentHeadApprovedBy: params.actorApplicationUserId,
        departmentHeadApprovedAt: new Date(),
      })
      .where(
        and(
          eq(leaveRequestsTable.id, params.leaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw new LeaveRequestNotPendingError();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "leave_request.department_head_approved",
      targetType: "leave_request",
      targetId: String(row.id),
      beforeState: { status: before.status },
      afterState: { status: row.status },
    });
    return row;
  }

  if (before.status === "pending_hr") {
    if (!params.isHr) throw new NotAuthorizedForStageError("hr");

    const [policy] = await db.select().from(leavePoliciesTable).where(eq(leavePoliciesTable.id, before.leavePolicyId)).limit(1);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(leaveRequestsTable)
        .set({ status: "approved", approvedBy: params.actorApplicationUserId, approvedAt: new Date() })
        .where(
          and(
            eq(leaveRequestsTable.id, params.leaveRequestId),
            eq(leaveRequestsTable.organizationId, params.organizationId),
            eq(leaveRequestsTable.status, "pending_hr"),
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

  throw new LeaveRequestNotPendingError();
}

/**
 * Rejects whichever stage the request currently sits at. `reason` is
 * required and non-empty at this layer too (defense in depth — the route's
 * zod schema already enforces it before this is ever called). A rejection
 * is always terminal (no further stage), and never posts a ledger entry.
 * Rejecting at "pending_hr" never overwrites the Department Head's earlier
 * approval columns — they stay on the row exactly as recorded.
 */
export async function rejectLeaveRequest(
  params: StageActionParams & { reason: string },
): Promise<LeaveRequest> {
  if (!params.reason || !params.reason.trim()) throw new RejectionReasonRequiredError();

  const before = await findOwnLeaveRequest(params.organizationId, params.employeeId, params.leaveRequestId);
  if (!before) throw new LeaveRequestNotFoundError();
  if (params.callerEmployeeId != null && params.callerEmployeeId === before.employeeId) {
    throw new SelfApprovalNotAllowedError();
  }

  if (before.status === "pending") {
    const [employee] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, before.employeeId)).limit(1);
    const head = await resolveDepartmentHeadIdentity(params.organizationId, employee?.departmentId ?? null);
    const isDeptHead = head != null && head.headMembershipId === params.actorMembershipId;
    if (!isDeptHead) throw new NotAuthorizedForStageError("department_head");

    const [row] = await db
      .update(leaveRequestsTable)
      .set({
        status: "rejected",
        departmentHeadRejectedBy: params.actorApplicationUserId,
        departmentHeadRejectedAt: new Date(),
        departmentHeadRejectionReason: params.reason,
      })
      .where(
        and(
          eq(leaveRequestsTable.id, params.leaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw new LeaveRequestNotPendingError();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "leave_request.department_head_rejected",
      targetType: "leave_request",
      targetId: String(row.id),
      beforeState: { status: before.status },
      afterState: { status: row.status, departmentHeadRejectionReason: row.departmentHeadRejectionReason },
    });
    return row;
  }

  if (before.status === "pending_hr") {
    if (!params.isHr) throw new NotAuthorizedForStageError("hr");

    const [row] = await db
      .update(leaveRequestsTable)
      .set({
        status: "rejected",
        rejectedBy: params.actorApplicationUserId,
        rejectedAt: new Date(),
        rejectionReason: params.reason,
      })
      .where(
        and(
          eq(leaveRequestsTable.id, params.leaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.status, "pending_hr"),
        ),
      )
      .returning();
    if (!row) throw new LeaveRequestNotPendingError();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "leave_request.rejected",
      targetType: "leave_request",
      targetId: String(row.id),
      beforeState: { status: before.status },
      afterState: { status: row.status, rejectionReason: row.rejectionReason },
    });
    return row;
  }

  throw new LeaveRequestNotPendingError();
}
