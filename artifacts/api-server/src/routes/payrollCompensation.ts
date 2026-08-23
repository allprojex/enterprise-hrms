/**
 * Payroll, Workstream 2 — Employee Compensation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.4, §13). Every route requires the
 * payroll module enabled AND the narrow payroll.compensation.* permission —
 * never inherited from employee.read/.write, never exposed through the
 * generic employee GET/list, ESS, Manager Portal, or personnel-record
 * search.
 */
import { Router } from "express";
import { CreateEmployeeCompensationComponentBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import {
  createCompensationComponent,
  endCompensationComponent,
  listCurrentCompensationComponents,
  listCompensationComponentHistory,
  resolveCompensationAsOf,
  UnknownComponentTypeError,
  CompensationComponentCollisionError,
  CompensationComponentNotFoundError,
  CompensationComponentAlreadyEndedError,
} from "../lib/payrollCompensation";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

async function requireKnownEmployee(req: MembershipRequest, res: import("express").Response): Promise<number | null> {
  const employeeId = parseId(req.params.employeeId);
  if (isNaN(employeeId)) {
    res.status(400).json({ error: "Invalid employee ID" });
    return null;
  }
  const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return null;
  }
  return employeeId;
}

// GET /organizations/:organizationId/employees/:employeeId/payroll/compensation
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/compensation",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.compensation.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;
    const rows = await listCurrentCompensationComponents(req.membership!.organizationId, employeeId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/payroll/compensation
router.post(
  "/organizations/:organizationId/employees/:employeeId/payroll/compensation",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.compensation.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;

    const parsed = CreateEmployeeCompensationComponentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const component = await createCompensationComponent({
        organizationId: req.membership!.organizationId,
        employeeId,
        category: parsed.data.category,
        componentTypeCode: parsed.data.componentTypeCode,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        recurring: parsed.data.recurring,
        taxableTreatment: parsed.data.taxableTreatment,
        pensionable: parsed.data.pensionable,
        sourceReferenceType: parsed.data.sourceReferenceType ?? null,
        sourceReferenceId: parsed.data.sourceReferenceId ?? null,
        validFrom: parsed.data.validFrom,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_compensation.created",
        targetType: "employee_compensation_component",
        targetId: String(component.id),
        afterState: { employeeId, category: component.category, componentTypeCode: component.componentTypeCode, amount: component.amount, currency: component.currency, validFrom: component.validFrom },
      });

      res.status(201).json(component);
    } catch (err) {
      if (err instanceof UnknownComponentTypeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof CompensationComponentCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/payroll/compensation/history?asOf=
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/compensation/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.compensation.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;

    const asOfRaw = req.query.asOf;
    if (typeof asOfRaw === "string" && asOfRaw.trim()) {
      const asOfDate = new Date(asOfRaw);
      const rows = await resolveCompensationAsOf(req.membership!.organizationId, employeeId, asOfDate);
      res.json(rows);
      return;
    }

    const rows = await listCompensationComponentHistory(req.membership!.organizationId, employeeId);
    res.json(rows);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/payroll/compensation/:id/end
router.post(
  "/organizations/:organizationId/employees/:employeeId/payroll/compensation/:id/end",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.compensation.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;

    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid component ID" });
      return;
    }
    const endDateRaw = req.body?.endDate;
    const endDate = endDateRaw ? new Date(endDateRaw) : null;
    if (!endDate || isNaN(endDate.getTime())) {
      res.status(400).json({ error: "endDate is required" });
      return;
    }

    try {
      const component = await endCompensationComponent({ organizationId: req.membership!.organizationId, id, endDate });
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_compensation.ended",
        targetType: "employee_compensation_component",
        targetId: String(component.id),
        afterState: { validTo: component.validTo },
      });
      res.json(component);
    } catch (err) {
      if (err instanceof CompensationComponentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof CompensationComponentAlreadyEndedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
