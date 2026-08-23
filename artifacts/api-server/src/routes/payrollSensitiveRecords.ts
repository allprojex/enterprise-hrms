/**
 * Payroll, Workstream 2 — Banking & Statutory Identifiers
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8, §14, §15). Highly sensitive —
 * gated by their own distinct, narrow permissions, never employee.read.
 * Every READ here is audit-logged (frozen plan Decision 9), a deliberate
 * exception to the platform's general read-silence convention.
 */
import { Router, type Response } from "express";
import { CreateEmployeeBankingDetailBody, CreateEmployeeStatutoryIdentifierBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import {
  createBankingDetail,
  getCurrentBankingDetail,
  listBankingHistory,
  createStatutoryIdentifier,
  getCurrentStatutoryIdentifier,
  listStatutoryIdentifierHistory,
  UnknownBankError,
  BankingDetailCollisionError,
  StatutoryIdentifierCollisionError,
} from "../lib/payrollSensitiveRecords";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

async function requireKnownEmployee(req: MembershipRequest, res: Response): Promise<number | null> {
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

// ================================================================
// Banking
// ================================================================

// GET /organizations/:organizationId/employees/:employeeId/payroll/banking
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/banking",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.banking.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;
    const detail = await getCurrentBankingDetail(req.membership!.organizationId, employeeId);

    // Read-audit — deliberate exception to the platform's general
    // read-silence convention (frozen plan Decision 9).
    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId: req.membership!.organizationId,
      eventType: "payroll_banking.read",
      targetType: "employee_banking_detail",
      targetId: String(employeeId),
    });

    res.json(detail);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/payroll/banking
router.post(
  "/organizations/:organizationId/employees/:employeeId/payroll/banking",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.banking.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;

    const parsed = CreateEmployeeBankingDetailBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const detail = await createBankingDetail({
        organizationId: req.membership!.organizationId,
        employeeId,
        bankCode: parsed.data.bankCode,
        accountNumber: parsed.data.accountNumber,
        accountName: parsed.data.accountName,
        branch: parsed.data.branch ?? null,
        validFrom: parsed.data.validFrom,
        actorMembershipId: req.membership!.id,
      });

      // Mutation audit — never includes the account number in afterState,
      // matching the general principle that highly sensitive values are
      // narrowly exposed even within audit records; the account existing
      // and which bank/employee is enough for a mutation trail, the read
      // route above is the audited path for anyone actually viewing the
      // number itself.
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_banking.created",
        targetType: "employee_banking_detail",
        targetId: String(detail.id),
        afterState: { employeeId, bankCode: detail.bankCode, validFrom: detail.validFrom },
      });

      res.status(201).json(detail);
    } catch (err) {
      if (err instanceof UnknownBankError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof BankingDetailCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/payroll/banking/history
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/banking/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.banking.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;
    const rows = await listBankingHistory(req.membership!.organizationId, employeeId);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId: req.membership!.organizationId,
      eventType: "payroll_banking.history_read",
      targetType: "employee_banking_detail",
      targetId: String(employeeId),
    });

    res.json(rows);
  },
);

// ================================================================
// Statutory identifiers
// ================================================================

// GET /organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.statutory_identifiers.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;
    const detail = await getCurrentStatutoryIdentifier(req.membership!.organizationId, employeeId);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId: req.membership!.organizationId,
      eventType: "payroll_statutory_identifier.read",
      targetType: "employee_statutory_identifier",
      targetId: String(employeeId),
    });

    res.json(detail);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers
router.post(
  "/organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.statutory_identifiers.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;

    const parsed = CreateEmployeeStatutoryIdentifierBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const detail = await createStatutoryIdentifier({
        organizationId: req.membership!.organizationId,
        employeeId,
        ssnitNumber: parsed.data.ssnitNumber ?? null,
        tin: parsed.data.tin ?? null,
        validFrom: parsed.data.validFrom,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_statutory_identifier.created",
        targetType: "employee_statutory_identifier",
        targetId: String(detail.id),
        afterState: { employeeId, validFrom: detail.validFrom },
      });

      res.status(201).json(detail);
    } catch (err) {
      if (err instanceof StatutoryIdentifierCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers/history
router.get(
  "/organizations/:organizationId/employees/:employeeId/payroll/statutory-identifiers/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.statutory_identifiers.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = await requireKnownEmployee(req, res);
    if (employeeId == null) return;
    const rows = await listStatutoryIdentifierHistory(req.membership!.organizationId, employeeId);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId: req.membership!.organizationId,
      eventType: "payroll_statutory_identifier.history_read",
      targetType: "employee_statutory_identifier",
      targetId: String(employeeId),
    });

    res.json(rows);
  },
);

export default router;
