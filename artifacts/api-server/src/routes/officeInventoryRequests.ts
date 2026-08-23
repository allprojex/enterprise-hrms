/**
 * Office Inventory, Workstream 3 — Requests & Department Approval routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §10, §11, §14, §15, §20,
 * §21, §22). Every route composes `requireModuleEnabled("office_inventory")`
 * then the frozen permission (`office_inventory.request` or
 * `office_inventory.approve` — no new permission key). Permission alone is
 * never sufficient for approval-side routes: `resolveApprovalAuthority`
 * (Head-or-currently-valid-delegate) is re-checked server-side on every
 * approve/reject/queue/context call, never assumed from the permission
 * grant, per §21's explicit instruction. Self-scoping for employee
 * requests uses `resolveOwnEmployeeId` exclusively — no client-supplied
 * employeeId ever establishes "my request" authority.
 */
import { Router } from "express";
import { CreateOfficeInventoryRequestBody, ApproveOfficeInventoryRequestLineBody, RejectOfficeInventoryRequestLineBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import {
  createEmployeeRequest,
  createDepartmentRequest,
  getRequestWithLines,
  listMyRequests,
  listRequestsForDepartment,
  cancelRequest,
  approveRequestLine,
  rejectRequestLine,
  OfficeInventoryEmployeeHasNoDepartmentError,
  OfficeInventoryDepartmentNotFoundError,
  OfficeInventoryRequesterNotInDepartmentError,
  OfficeInventoryRequestNoLinesError,
  OfficeInventoryRequestInvalidQuantityError,
  OfficeInventoryRequestItemsNotFoundError,
  OfficeInventoryRequestNotFoundError,
  OfficeInventoryRequestNotCancellableError,
  OfficeInventoryNotRequesterError,
  OfficeInventoryRequestLineNotFoundError,
  OfficeInventoryRequestLineAlreadyDecidedError,
  OfficeInventoryNoApprovalAuthorityError,
  OfficeInventoryInvalidApprovedQuantityError,
  OfficeInventoryRejectionReasonRequiredError,
} from "../lib/officeInventoryRequests";
import { resolveApprovalAuthority } from "../lib/officeInventoryDelegations";
import { getRequestApprovalContext } from "../lib/officeInventoryApprovalContext";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/office-inventory/requests
router.get(
  "/organizations/:organizationId/office-inventory/requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.request"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requests = await listMyRequests(req.membership!.organizationId, req.membership!.id);
    res.json(requests);
  },
);

// POST /organizations/:organizationId/office-inventory/requests
router.post(
  "/organizations/:organizationId/office-inventory/requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.request"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    try {
      if (parsed.data.requestType === "employee") {
        const forEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
        if (forEmployeeId === null) {
          res.status(400).json({ error: "No employee record is linked to your account" });
          return;
        }
        const result = await createEmployeeRequest({
          organizationId,
          forEmployeeId,
          reason: parsed.data.reason,
          lines: parsed.data.lines,
          requestedByMembershipId: req.membership!.id,
          actorApplicationUserId: req.userId!,
        });
        res.status(201).json(result);
        return;
      }

      if (!parsed.data.forDepartmentId) {
        res.status(400).json({ error: "forDepartmentId is required for a department request" });
        return;
      }
      const requestedByEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
      const result = await createDepartmentRequest({
        organizationId,
        forDepartmentId: parsed.data.forDepartmentId,
        reason: parsed.data.reason,
        lines: parsed.data.lines,
        requestedByMembershipId: req.membership!.id,
        requestedByEmployeeId,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (
        err instanceof OfficeInventoryEmployeeHasNoDepartmentError ||
        err instanceof OfficeInventoryDepartmentNotFoundError ||
        err instanceof OfficeInventoryRequesterNotInDepartmentError ||
        err instanceof OfficeInventoryRequestNoLinesError ||
        err instanceof OfficeInventoryRequestInvalidQuantityError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryRequestItemsNotFoundError) {
        res.status(400).json({ error: err.message, itemIds: err.itemIds });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/requests/:id
router.get(
  "/organizations/:organizationId/office-inventory/requests/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid request ID" });
      return;
    }
    try {
      const result = await getRequestWithLines(organizationId, id);
      const isOwn = result.request.requestedByMembershipId === req.membership!.id;
      const canReadOwn = isOwn && (await hasPermission(req.membership!.id, "office_inventory.request"));
      if (!canReadOwn) {
        const canApprove = await hasPermission(req.membership!.id, "office_inventory.approve");
        const authority = canApprove ? await resolveApprovalAuthority(organizationId, result.request.forDepartmentId, req.membership!.id) : null;
        if (!authority) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
      res.json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/requests/:id/cancel
router.post(
  "/organizations/:organizationId/office-inventory/requests/:id/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.request"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid request ID" });
      return;
    }
    try {
      const result = await cancelRequest({
        organizationId: req.membership!.organizationId,
        requestId: id,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNotRequesterError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryRequestNotCancellableError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/requests/:id/approval-context
router.get(
  "/organizations/:organizationId/office-inventory/requests/:id/approval-context",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid request ID" });
      return;
    }
    try {
      const { request } = await getRequestWithLines(organizationId, id);
      const authority = await resolveApprovalAuthority(organizationId, request.forDepartmentId, req.membership!.id);
      if (!authority) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const context = await getRequestApprovalContext(organizationId, id);
      res.json(context);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/departments/:departmentId/requests
router.get(
  "/organizations/:organizationId/office-inventory/departments/:departmentId/requests",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const authority = await resolveApprovalAuthority(organizationId, departmentId, req.membership!.id);
    if (!authority) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const requests = await listRequestsForDepartment(organizationId, departmentId);
    res.json(requests);
  },
);

// POST /organizations/:organizationId/office-inventory/request-lines/:lineId/approve
router.post(
  "/organizations/:organizationId/office-inventory/request-lines/:lineId/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const lineId = parseId(req.params.lineId);
    if (isNaN(lineId)) {
      res.status(400).json({ error: "Invalid request line ID" });
      return;
    }
    const parsed = ApproveOfficeInventoryRequestLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await approveRequestLine({
        organizationId: req.membership!.organizationId,
        lineId,
        approvedQuantity: parsed.data.approvedQuantity,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      const request = await getRequestWithLines(req.membership!.organizationId, result.request.id);
      res.json(request);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNoApprovalAuthorityError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryRequestLineAlreadyDecidedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidApprovedQuantityError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/request-lines/:lineId/reject
router.post(
  "/organizations/:organizationId/office-inventory/request-lines/:lineId/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const lineId = parseId(req.params.lineId);
    if (isNaN(lineId)) {
      res.status(400).json({ error: "Invalid request line ID" });
      return;
    }
    const parsed = RejectOfficeInventoryRequestLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await rejectRequestLine({
        organizationId: req.membership!.organizationId,
        lineId,
        rejectionReason: parsed.data.rejectionReason,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      const request = await getRequestWithLines(req.membership!.organizationId, result.request.id);
      res.json(request);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNoApprovalAuthorityError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryRequestLineAlreadyDecidedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryRejectionReasonRequiredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
