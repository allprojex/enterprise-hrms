/**
 * Payroll, Workstream 5 (frozen plan §9.7/§13 — Workstream 6 "Payslips &
 * Employee Self Service Exposure"). HR/admin view of another employee's
 * payslip is gated `payroll.payslip.read`; the ESS own-scoped view is
 * gated `payroll.payslip.read.own` and resolves identity server-side via
 * the same employee_user_links lookup every other ESS surface uses —
 * never a client-supplied employeeId. Both routes only ever return output
 * for a "locked" run; a draft/calculated/approved run's payslip does not
 * exist yet.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { getPayslip, listOwnPayslipSummaries, PayrollRunNotFoundError, PayrollRunNotLockedError, PayrollRunLineNotFoundError } from "../lib/payrollReporting";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/payroll/runs/:runId/lines/:lineId/payslip
router.get(
  "/organizations/:organizationId/payroll/runs/:runId/lines/:lineId/payslip",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payslip.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    const lineId = parseId(req.params.lineId);
    if (isNaN(runId) || isNaN(lineId)) {
      res.status(400).json({ error: "Invalid run or line ID" });
      return;
    }
    try {
      const payslip = await getPayslip(req.membership!.organizationId, runId, lineId);
      res.json(payslip);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError || err instanceof PayrollRunLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/me/payslips
router.get(
  "/organizations/:organizationId/payroll/me/payslips",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payslip.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.json([]);
      return;
    }
    const summaries = await listOwnPayslipSummaries(organizationId, employeeId);
    res.json(summaries);
  },
);

// GET /organizations/:organizationId/payroll/me/payslips/:runId
router.get(
  "/organizations/:organizationId/payroll/me/payslips/:runId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payslip.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.status(404).json({ error: "No linked employee record" });
      return;
    }

    // Resolves this employee's OWN line for the run — never a
    // client-supplied lineId, so there is no route for one ESS actor to
    // request a coworker's payslip by guessing a line ID.
    const summaries = await listOwnPayslipSummaries(organizationId, employeeId);
    const own = summaries.find((s) => s.payrollRunId === runId);
    if (!own) {
      res.status(404).json({ error: "Payslip not found" });
      return;
    }

    try {
      const payslip = await getPayslip(organizationId, runId, own.payrollRunLineId);
      res.json(payslip);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError || err instanceof PayrollRunLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
