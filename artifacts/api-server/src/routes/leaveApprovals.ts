import { Router } from "express";
import { RejectLeaveRequestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId, withWorkflowStage, LeaveRequestNotFoundError } from "../lib/leaveRequests";
import { listDepartmentsHeadedByMembership } from "../lib/departmentHeads";
import {
  listPendingApprovals,
  approveLeaveRequest,
  rejectLeaveRequest,
  LeaveRequestNotPendingError,
  SelfApprovalNotAllowedError,
  InsufficientLeaveBalanceError,
  NotAuthorizedForStageError,
  RejectionReasonRequiredError,
} from "../lib/leaveApprovals";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleApprovalError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof LeaveRequestNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof SelfApprovalNotAllowedError || err instanceof NotAuthorizedForStageError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof LeaveRequestNotPendingError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof InsufficientLeaveBalanceError || err instanceof RejectionReasonRequiredError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/leave-requests/pending-approvals
// HR (leave_request.manage) sees every non-terminal request org-wide from
// submission — both "awaiting Department Head" and "awaiting HR". A caller
// without that permission sees only "awaiting Department Head" requests
// from the department(s) they are the CURRENT, actual Department Head of
// (lib/departmentHeads.ts's own primitive) — never derived from
// reportingManagerId, never from holding leave_request.approve alone (every
// employee holds that permission; it gates "may attempt," not "may act").
router.get(
  "/organizations/:organizationId/leave-requests/pending-approvals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const isOrgWideHr = await hasPermission(req.membership!.id, "leave_request.manage");
    const headedDepartmentIds = isOrgWideHr ? [] : await listDepartmentsHeadedByMembership(organizationId, req.membership!.id);
    const requests = await listPendingApprovals(organizationId, { isOrgWideHr, headedDepartmentIds });
    res.json(requests.map(withWorkflowStage));
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests/:id/approve
// Stage-aware: a "pending" request requires the caller to BE the employee's
// current Department Head (re-resolved live inside approveLeaveRequest); a
// "pending_hr" request requires leave_request.manage. Either mismatch (or
// acting on a request not currently awaiting the caller's own stage) is a
// 403, not a silent no-op.
router.post(
  "/organizations/:organizationId/employees/:employeeId/leave-requests/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const leaveRequestId = parseId(req.params.id);
    if (isNaN(employeeId) || isNaN(leaveRequestId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const isHr = await hasPermission(req.membership!.id, "leave_request.manage");

    try {
      const request = await approveLeaveRequest({
        organizationId,
        employeeId,
        leaveRequestId,
        callerEmployeeId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        isHr,
      });
      res.json(withWorkflowStage(request));
    } catch (err) {
      if (handleApprovalError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests/:id/reject
// Same stage-aware authority as approve. A non-empty reason is mandatory at
// both stages (RejectLeaveRequestBody.reason, zod-enforced below, and again
// defensively inside rejectLeaveRequest) and is preserved on the row in the
// stage-specific columns — a Department Head rejection reason is never
// overwritten by a later HR action, and HR never even gets the chance to
// act on a request the Department Head already rejected.
router.post(
  "/organizations/:organizationId/employees/:employeeId/leave-requests/:id/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const leaveRequestId = parseId(req.params.id);
    if (isNaN(employeeId) || isNaN(leaveRequestId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const parsed = RejectLeaveRequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const isHr = await hasPermission(req.membership!.id, "leave_request.manage");

    try {
      const request = await rejectLeaveRequest({
        organizationId,
        employeeId,
        leaveRequestId,
        callerEmployeeId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        isHr,
        reason: parsed.data.reason,
      });
      res.json(withWorkflowStage(request));
    } catch (err) {
      if (handleApprovalError(err, res)) return;
      throw err;
    }
  },
);

export default router;
