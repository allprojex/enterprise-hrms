import { Router } from "express";
import { RejectLeaveRequestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { getEmployeeById } from "../lib/employees";
import { resolveOwnEmployeeId, LeaveRequestNotFoundError } from "../lib/leaveRequests";
import {
  listPendingApprovals,
  approveLeaveRequest,
  rejectLeaveRequest,
  LeaveRequestNotPendingError,
  SelfApprovalNotAllowedError,
  InsufficientLeaveBalanceError,
} from "../lib/leaveApprovals";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

/**
 * Approval authority (Architecture Principle 5): the union of manager-scoped
 * and HR organization-wide, re-checked at the moment of the decision, never
 * cached. Holding leave_request.approve alone is not sufficient — nor is
 * holding leave_request.manage (view access) alone, matching the frozen
 * plan's explicit "HR access to view requests does not automatically grant
 * approval permission" rule: manage grants org-wide *approval* authority
 * here specifically because W35's frozen scope defines the org-wide
 * approver tier as leave_request.manage holders, not a separate permission.
 */
async function resolveApprovalAuthority(
  req: MembershipRequest,
  targetEmployeeId: number,
): Promise<{ approverEmployeeId: number | null; isManager: boolean; isOrgWide: boolean; authorized: boolean }> {
  const organizationId = req.membership!.organizationId;
  const approverEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
  const target = await getEmployeeById(organizationId, targetEmployeeId);
  const isManager = !!target && approverEmployeeId != null && target.reportingManagerId === approverEmployeeId;
  const isOrgWide = await hasPermission(req.membership!.id, "leave_request.manage");
  return { approverEmployeeId, isManager, isOrgWide, authorized: isManager || isOrgWide };
}

// GET /organizations/:organizationId/leave-requests/pending-approvals
router.get(
  "/organizations/:organizationId/leave-requests/pending-approvals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const isOrgWide = await hasPermission(req.membership!.id, "leave_request.manage");
    const approverEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const requests = await listPendingApprovals(organizationId, approverEmployeeId, isOrgWide);
    res.json(requests);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests/:id/approve
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

    const { approverEmployeeId, authorized } = await resolveApprovalAuthority(req, employeeId);
    if (!authorized) {
      res.status(403).json({ error: "Not authorized to approve this employee's leave requests" });
      return;
    }

    try {
      const request = await approveLeaveRequest({
        organizationId: req.membership!.organizationId,
        employeeId,
        leaveRequestId,
        approverEmployeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(request);
    } catch (err) {
      if (err instanceof LeaveRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof SelfApprovalNotAllowedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof LeaveRequestNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientLeaveBalanceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests/:id/reject
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

    const { approverEmployeeId, authorized } = await resolveApprovalAuthority(req, employeeId);
    if (!authorized) {
      res.status(403).json({ error: "Not authorized to reject this employee's leave requests" });
      return;
    }

    const parsed = RejectLeaveRequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const request = await rejectLeaveRequest({
        organizationId: req.membership!.organizationId,
        employeeId,
        leaveRequestId,
        approverEmployeeId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(request);
    } catch (err) {
      if (err instanceof LeaveRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof SelfApprovalNotAllowedError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof LeaveRequestNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
