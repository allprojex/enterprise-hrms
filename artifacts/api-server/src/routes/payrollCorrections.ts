/**
 * Payroll, Workstream 4 — Corrections & Reversals
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §11, §13). Every route
 * requires the payroll module enabled AND `payroll.run.correct` — a single
 * distinct permission gating both create and approve, with server-side
 * maker-checker (different actor) enforced inside the lib layer regardless
 * of whether the same membership happens to hold the permission twice.
 */
import { Router } from "express";
import { CreatePayrollCorrectionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createPayrollCorrection,
  approvePayrollCorrection,
  listPayrollCorrectionsForRun,
  getPayrollCorrectionWithComponents,
  PayrollRunNotFoundError,
  PayrollRunNotLockedError,
  PayrollRunLineNotFoundError,
  PayrollCorrectionAlreadyOpenError,
  PayrollCorrectionNotFoundError,
  PayrollCorrectionNotDraftError,
  PayrollCorrectionSelfApprovalError,
} from "../lib/payrollCorrections";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/payroll/runs/:runId/corrections
router.get(
  "/organizations/:organizationId/payroll/runs/:runId/corrections",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.correct"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const rows = await listPayrollCorrectionsForRun(req.membership!.organizationId, runId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/payroll/runs/:runId/corrections
router.post(
  "/organizations/:organizationId/payroll/runs/:runId/corrections",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.correct"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const parsed = CreatePayrollCorrectionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;

    try {
      const correction = await createPayrollCorrection({
        organizationId,
        originalRunId: runId,
        originalRunLineId: parsed.data.originalRunLineId,
        reason: parsed.data.reason,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_correction.created",
        targetType: "payroll_correction",
        targetId: String(correction.id),
        afterState: {
          originalRunId: correction.originalRunId,
          originalRunLineId: correction.originalRunLineId,
          employeeId: correction.employeeId,
          netPay: correction.netPay,
          netPayDelta: correction.netPayDelta,
          reason: correction.reason,
        },
      });

      res.status(201).json(correction);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError || err instanceof PayrollRunLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollCorrectionAlreadyOpenError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/corrections/:id
router.get(
  "/organizations/:organizationId/payroll/corrections/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.correct"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid correction ID" });
      return;
    }
    const detail = await getPayrollCorrectionWithComponents(req.membership!.organizationId, id);
    if (!detail) {
      res.status(404).json({ error: "Payroll correction not found" });
      return;
    }
    res.json(detail);
  },
);

// POST /organizations/:organizationId/payroll/corrections/:id/approve
router.post(
  "/organizations/:organizationId/payroll/corrections/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.correct"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid correction ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;

    try {
      const correction = await approvePayrollCorrection({ organizationId, correctionId: id, approverMembershipId: req.membership!.id });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_correction.approved",
        targetType: "payroll_correction",
        targetId: String(correction.id),
        afterState: { status: correction.status, approvedByMembershipId: correction.approvedByMembershipId },
      });

      res.json(correction);
    } catch (err) {
      if (err instanceof PayrollCorrectionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollCorrectionNotDraftError || err instanceof PayrollCorrectionSelfApprovalError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
