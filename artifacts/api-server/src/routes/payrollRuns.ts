/**
 * Payroll, Workstream 3/4 — Payroll Run Foundation, Approval & Locking
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §10, §13). Every route
 * requires the payroll module enabled AND a frozen permission —
 * `payroll.run.prepare` for creation/calculation/reads, `payroll.run.approve`
 * for approval, `payroll.run.lock` for finalization — each distinct, none
 * inherited from another.
 */
import { Router } from "express";
import { CreatePayrollRunBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createPayrollRun,
  listPayrollRuns,
  getPayrollRun,
  getPayrollRunLines,
  calculatePayrollRun,
  approvePayrollRun,
  lockPayrollRun,
  PayrollRunCollisionError,
  PayrollRunNotFoundError,
  PayrollPeriodNotFoundError,
  NoEligibleEmployeesError,
  PayrollRunValidationError,
  PayrollRunNotEditableError,
  PayrollRunNotCalculatedError,
  PayrollRunNotApprovedError,
  PayrollRunNoLinesError,
  PayrollRunSelfApprovalError,
} from "../lib/payrollRuns";
import { getNamespaceConfig } from "../services/organizationConfig";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/payroll/runs
router.get(
  "/organizations/:organizationId/payroll/runs",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const rows = await listPayrollRuns(req.membership!.organizationId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/payroll/runs
router.post(
  "/organizations/:organizationId/payroll/runs",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePayrollRunBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const run = await createPayrollRun({
        organizationId: req.membership!.organizationId,
        payrollPeriodId: parsed.data.payrollPeriodId,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_run.created",
        targetType: "payroll_run",
        targetId: String(run.id),
        afterState: { payrollPeriodId: run.payrollPeriodId, status: run.status },
      });

      res.status(201).json(run);
    } catch (err) {
      if (err instanceof PayrollPeriodNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/runs/:id
router.get(
  "/organizations/:organizationId/payroll/runs/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    try {
      const run = await getPayrollRun(req.membership!.organizationId, id);
      res.json(run);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/runs/:id/lines
router.get(
  "/organizations/:organizationId/payroll/runs/:id/lines",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const rows = await getPayrollRunLines(req.membership!.organizationId, id);
    res.json(rows.map(({ line, components }) => ({ line, components })));
  },
);

// POST /organizations/:organizationId/payroll/runs/:id/calculate
router.post(
  "/organizations/:organizationId/payroll/runs/:id/calculate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const payrollConfig = await getNamespaceConfig(organizationId, "payroll");
    const currency = (payrollConfig.data.defaultCurrency as string | undefined) ?? "GHS";

    try {
      const summary = await calculatePayrollRun({ organizationId, payrollRunId: id, currency });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_run.calculated",
        targetType: "payroll_run",
        targetId: String(summary.run.id),
        afterState: { status: summary.run.status, employeeCount: summary.employeeCount, calculatedAt: summary.run.calculatedAt },
      });

      res.json(summary);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError || err instanceof PayrollPeriodNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof NoEligibleEmployeesError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunValidationError) {
        res.status(422).json({ error: err.message, employeeErrors: err.employeeErrors });
        return;
      }
      if (err instanceof PayrollRunNotEditableError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/payroll/runs/:id/approve
router.post(
  "/organizations/:organizationId/payroll/runs/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;

    try {
      const run = await approvePayrollRun({ organizationId, payrollRunId: id, approverMembershipId: req.membership!.id });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_run.approved",
        targetType: "payroll_run",
        targetId: String(run.id),
        afterState: { status: run.status, approvedByMembershipId: run.approvedByMembershipId },
      });

      res.json(run);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotCalculatedError || err instanceof PayrollRunNoLinesError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunSelfApprovalError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/payroll/runs/:id/lock
router.post(
  "/organizations/:organizationId/payroll/runs/:id/lock",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.lock"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;

    try {
      const run = await lockPayrollRun({ organizationId, payrollRunId: id, actorMembershipId: req.membership!.id });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_run.locked",
        targetType: "payroll_run",
        targetId: String(run.id),
        afterState: { status: run.status, lockedAt: run.lockedAt },
      });

      res.json(run);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotApprovedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunSelfApprovalError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
