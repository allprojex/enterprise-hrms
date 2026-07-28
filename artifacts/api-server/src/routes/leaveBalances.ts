import { Router } from "express";
import { AdjustLeaveBalanceBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { getEmployeeById } from "../lib/employees";
import { resolveOwnEmployeeId, toIsoDate } from "../lib/leaveRequests";
import {
  getEmployeeBalances,
  getLedgerHistory,
  postManualAdjustment,
  LeaveBalanceValidationError,
  DuplicateLedgerEntryError,
} from "../lib/leaveBalances";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

/** Coarse route gate (leave_request.read.own, held by every role) + fine-grained own/manager/org-wide check — same shape as W33's GET /leave-requests. */
async function authorizeBalanceRead(req: MembershipRequest, employeeId: number): Promise<boolean> {
  const organizationId = req.membership!.organizationId;
  const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
  const target = await getEmployeeById(organizationId, employeeId);
  if (!target) return false;
  const isOwn = ownEmployeeId != null && ownEmployeeId === employeeId;
  const isManager = ownEmployeeId != null && target.reportingManagerId === ownEmployeeId;
  const isOrgWide = !isOwn && !isManager && (await hasPermission(req.membership!.id, "leave_request.manage"));
  return isOwn || isManager || isOrgWide;
}

// GET /organizations/:organizationId/employees/:employeeId/leave-balances
router.get(
  "/organizations/:organizationId/employees/:employeeId/leave-balances",
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

    if (!(await authorizeBalanceRead(req, employeeId))) {
      res.status(403).json({ error: "Not authorized to view this employee's leave balances" });
      return;
    }

    const balances = await getEmployeeBalances(req.membership!.organizationId, employeeId);
    res.json(balances);
  },
);

// GET /organizations/:organizationId/employees/:employeeId/leave-balances/ledger?leaveTypeId=
router.get(
  "/organizations/:organizationId/employees/:employeeId/leave-balances/ledger",
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

    if (!(await authorizeBalanceRead(req, employeeId))) {
      res.status(403).json({ error: "Not authorized to view this employee's leave balance ledger" });
      return;
    }

    const rawLeaveTypeId = req.query.leaveTypeId;
    let leaveTypeId: number | undefined;
    if (typeof rawLeaveTypeId === "string" && rawLeaveTypeId.length > 0) {
      const parsed = parseId(rawLeaveTypeId);
      if (isNaN(parsed)) {
        res.status(400).json({ error: "Invalid leaveTypeId" });
        return;
      }
      leaveTypeId = parsed;
    }

    const entries = await getLedgerHistory(req.membership!.organizationId, employeeId, leaveTypeId);
    res.json(entries);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/leave-balances/adjust
// HR-organization-wide only (leave_request.manage) — an own/manager tier
// never grants the authority to post a manual adjustment.
router.post(
  "/organizations/:organizationId/employees/:employeeId/leave-balances/adjust",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.manage"),
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

    const parsed = AdjustLeaveBalanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const entry = await postManualAdjustment({
        organizationId,
        employeeId,
        leaveTypeId: parsed.data.leaveTypeId,
        amount: parsed.data.amount,
        effectiveDate: toIsoDate(parsed.data.effectiveDate),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(entry);
    } catch (err) {
      if (err instanceof LeaveBalanceValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateLedgerEntryError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
