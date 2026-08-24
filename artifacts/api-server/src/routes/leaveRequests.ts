import { Router } from "express";
import { CreateLeaveRequestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { getEmployeeById } from "../lib/employees";
import {
  listLeaveRequests,
  createLeaveRequest,
  cancelLeaveRequest,
  resolveOwnEmployeeId,
  toIsoDate,
  withWorkflowStage,
  InvalidLeaveRequestError,
  LeaveRequestNotFoundError,
  LeaveRequestNotCancellableError,
} from "../lib/leaveRequests";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/employees/:employeeId/leave-requests
// Route-level gate is leave_request.read.own (every role has it, including
// plain "employee") — the real "own vs manager vs org-wide" authorization is
// refined below, mirroring the employee.notes.read precedent (coarse route
// gate + fine-grained check) rather than a single blanket permission.
router.get(
  "/organizations/:organizationId/employees/:employeeId/leave-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const target = await getEmployeeById(organizationId, employeeId);
    if (!target) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const isOwn = ownEmployeeId != null && ownEmployeeId === employeeId;
    const isManager = ownEmployeeId != null && target.reportingManagerId === ownEmployeeId;
    const isOrgWide = !isOwn && !isManager && (await hasPermission(req.membership!.id, "leave_request.manage"));
    if (!isOwn && !isManager && !isOrgWide) {
      res.status(403).json({ error: "Not authorized to view this employee's leave requests" });
      return;
    }

    const requests = await listLeaveRequests(organizationId, employeeId);
    res.json(requests.map(withWorkflowStage));
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests
// Own resource only — an employee submits for themselves, never on behalf
// of anyone else, even with leave_request.manage.
router.post(
  "/organizations/:organizationId/employees/:employeeId/leave-requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (ownEmployeeId == null || ownEmployeeId !== employeeId) {
      res.status(403).json({ error: "You can only submit a leave request for yourself" });
      return;
    }

    const parsed = CreateLeaveRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const request = await createLeaveRequest({
        organizationId,
        employeeId,
        leaveTypeId: parsed.data.leaveTypeId,
        startDate: toIsoDate(parsed.data.startDate),
        endDate: toIsoDate(parsed.data.endDate),
        reason: parsed.data.reason,
        attachmentDocumentId: parsed.data.attachmentDocumentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(withWorkflowStage(request));
    } catch (err) {
      if (err instanceof InvalidLeaveRequestError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-requests/:id/cancel
router.post(
  "/organizations/:organizationId/employees/:employeeId/leave-requests/:id/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const leaveRequestId = parseId(req.params.id);
    if (isNaN(employeeId) || isNaN(leaveRequestId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (ownEmployeeId == null || ownEmployeeId !== employeeId) {
      res.status(403).json({ error: "You can only withdraw your own leave request" });
      return;
    }

    try {
      const request = await cancelLeaveRequest({
        organizationId,
        employeeId,
        leaveRequestId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(withWorkflowStage(request));
    } catch (err) {
      if (err instanceof LeaveRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof LeaveRequestNotCancellableError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
