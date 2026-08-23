/**
 * Payroll, Workstream 3 — Payroll Periods & One-Off Inputs
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.3, §9.6, §13). Every route
 * requires the payroll module enabled AND payroll.run.prepare — the frozen
 * plan's distinct "preparation" authority, never inherited from ordinary
 * HR, compensation management, or statutory-rule authority.
 */
import { Router } from "express";
import { CreatePayrollPeriodBody, CreatePayrollInputReferenceBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createPayrollPeriod,
  listPayrollPeriods,
  getPayrollPeriod,
  PayrollPeriodCollisionError,
  PayrollPeriodNotFoundError,
  InvalidPayrollPeriodDatesError,
} from "../lib/payrollPeriods";
import {
  createPayrollInputReference,
  listPayrollInputReferences,
  deletePayrollInputReference,
  UnknownComponentTypeError,
  PayrollInputReferencePeriodNotFoundError,
  PayrollInputReferenceNotFoundError,
  PayrollRunNotEditableError,
} from "../lib/payrollInputReferences";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/payroll/periods
router.get(
  "/organizations/:organizationId/payroll/periods",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const rows = await listPayrollPeriods(req.membership!.organizationId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/payroll/periods
router.post(
  "/organizations/:organizationId/payroll/periods",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePayrollPeriodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const period = await createPayrollPeriod({
        organizationId: req.membership!.organizationId,
        frequency: parsed.data.frequency,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        payDate: parsed.data.payDate,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_period.created",
        targetType: "payroll_period",
        targetId: String(period.id),
        afterState: { frequency: period.frequency, periodKey: period.periodKey, startDate: period.startDate, endDate: period.endDate, payDate: period.payDate },
      });

      res.status(201).json(period);
    } catch (err) {
      if (err instanceof InvalidPayrollPeriodDatesError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollPeriodCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/periods/:id
router.get(
  "/organizations/:organizationId/payroll/periods/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid period ID" });
      return;
    }
    try {
      const period = await getPayrollPeriod(req.membership!.organizationId, id);
      res.json(period);
    } catch (err) {
      if (err instanceof PayrollPeriodNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/periods/:periodId/inputs
router.get(
  "/organizations/:organizationId/payroll/periods/:periodId/inputs",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const periodId = parseId(req.params.periodId);
    if (isNaN(periodId)) {
      res.status(400).json({ error: "Invalid period ID" });
      return;
    }
    const employeeIdRaw = req.query.employeeId;
    const employeeId = typeof employeeIdRaw === "string" && employeeIdRaw.trim() ? parseInt(employeeIdRaw, 10) : undefined;
    const rows = await listPayrollInputReferences(req.membership!.organizationId, periodId, employeeId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/payroll/periods/:periodId/inputs
router.post(
  "/organizations/:organizationId/payroll/periods/:periodId/inputs",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const periodId = parseId(req.params.periodId);
    if (isNaN(periodId)) {
      res.status(400).json({ error: "Invalid period ID" });
      return;
    }
    const parsed = CreatePayrollInputReferenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const input = await createPayrollInputReference({
        organizationId: req.membership!.organizationId,
        payrollPeriodId: periodId,
        employeeId: parsed.data.employeeId,
        category: parsed.data.category,
        componentTypeCode: parsed.data.componentTypeCode,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        taxableTreatment: parsed.data.taxableTreatment,
        description: parsed.data.description ?? null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_input_reference.created",
        targetType: "payroll_input_reference",
        targetId: String(input.id),
        afterState: { employeeId: input.employeeId, category: input.category, componentTypeCode: input.componentTypeCode, amount: input.amount, currency: input.currency },
      });

      res.status(201).json(input);
    } catch (err) {
      if (err instanceof PayrollInputReferencePeriodNotFoundError || err instanceof UnknownComponentTypeError) {
        res.status(400).json({ error: err.message });
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

// DELETE /organizations/:organizationId/payroll/periods/:periodId/inputs/:id
router.delete(
  "/organizations/:organizationId/payroll/periods/:periodId/inputs/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.run.prepare"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid input reference ID" });
      return;
    }
    try {
      const removed = await deletePayrollInputReference(req.membership!.organizationId, id);

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_input_reference.deleted",
        targetType: "payroll_input_reference",
        targetId: String(removed.id),
        beforeState: { employeeId: removed.employeeId, category: removed.category, componentTypeCode: removed.componentTypeCode, amount: removed.amount, currency: removed.currency },
      });

      res.json(removed);
    } catch (err) {
      if (err instanceof PayrollInputReferenceNotFoundError) {
        res.status(404).json({ error: err.message });
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

export default router;
