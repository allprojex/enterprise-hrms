/**
 * Payroll, Workstream 2 — Banking & Statutory Identifiers
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8, §14, §15). Highly sensitive —
 * gated by their own distinct, narrow permissions, never employee.read.
 * Every READ here is audit-logged (frozen plan Decision 9), a deliberate
 * exception to the platform's general read-silence convention.
 */
import { Router, type Response, type Request } from "express";
import { CreateEmployeeBankingDetailBody, CreateEmployeeStatutoryIdentifierBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
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
import { maskAccountNumber, maskIdentifier } from "../lib/sensitiveData";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// WS-3 (Owner Decision #23): masked-by-default, explicit reveal. Reuses the
// SAME payroll.banking.read/payroll.statutory_identifiers.read permission
// this route already gated on before this workstream — per the frozen
// review's own §23 guidance ("do not require reveal-click UX if the
// current page already has a safe dedicated sensitive endpoint... use
// evidence"), this endpoint was already narrow, dedicated, and non-default
// (no role gets it by default), so a second, narrower permission would add
// no real boundary. What was genuinely missing was the masked-by-default
// behavior and a distinct audit trail for "saw the masked value" vs "saw
// the full value" — both added here.
function wantsReveal(req: Request): boolean {
  return req.query.reveal === "true";
}

async function requireKnownEmployee(req: MembershipRequest, res: Response): Promise<number | null> {
  const employeeId = parseId(req.params.employeeId);
  if (isNaN(employeeId)) {
    res.status(400).json({ error: "Invalid employee ID" });
    return null;
  }
  const employee = await getEmployeeById(resolveOrganizationId(req), employeeId);
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
    const organizationId = resolveOrganizationId(req);
    const detail = await getCurrentBankingDetail(organizationId, employeeId);
    const reveal = wantsReveal(req);

    // Read-audit — deliberate exception to the platform's general
    // read-silence convention (frozen plan Decision 9). WS-3: the masked
    // view and a full reveal are now distinct, separately auditable events
    // — a reveal is the higher-sensitivity action and must be visible as
    // such in the audit trail, not indistinguishable from an ordinary
    // masked view. WS-4: actorMembershipId is null and breakGlassGrantId is
    // auto-attached when this read happens under an active break-glass
    // grant rather than a real membership.
    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: reveal ? "payroll_banking.revealed" : "payroll_banking.read",
      targetType: "employee_banking_detail",
      targetId: String(employeeId),
      outcome: "success",
    });

    if (!detail) {
      res.json(detail);
      return;
    }
    res.json(reveal ? detail : { ...detail, accountNumber: maskAccountNumber(detail.accountNumber) });
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
    const organizationId = resolveOrganizationId(req);
    const rows = await listBankingHistory(organizationId, employeeId);
    const reveal = wantsReveal(req);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: reveal ? "payroll_banking.history_revealed" : "payroll_banking.history_read",
      targetType: "employee_banking_detail",
      targetId: String(employeeId),
      outcome: "success",
    });

    res.json(reveal ? rows : rows.map((r) => ({ ...r, accountNumber: maskAccountNumber(r.accountNumber) })));
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
    const organizationId = resolveOrganizationId(req);
    const detail = await getCurrentStatutoryIdentifier(organizationId, employeeId);
    const reveal = wantsReveal(req);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: reveal ? "payroll_statutory_identifier.revealed" : "payroll_statutory_identifier.read",
      targetType: "employee_statutory_identifier",
      targetId: String(employeeId),
      outcome: "success",
    });

    if (!detail) {
      res.json(detail);
      return;
    }
    res.json(
      reveal
        ? detail
        : {
            ...detail,
            ssnitNumber: detail.ssnitNumber ? maskIdentifier(detail.ssnitNumber) : detail.ssnitNumber,
            tin: detail.tin ? maskIdentifier(detail.tin) : detail.tin,
          },
    );
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
    const organizationId = resolveOrganizationId(req);
    const rows = await listStatutoryIdentifierHistory(organizationId, employeeId);
    const reveal = wantsReveal(req);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: resolveActorMembershipId(req),
      organizationId,
      eventType: reveal ? "payroll_statutory_identifier.history_revealed" : "payroll_statutory_identifier.history_read",
      targetType: "employee_statutory_identifier",
      targetId: String(employeeId),
      outcome: "success",
    });

    res.json(
      reveal
        ? rows
        : rows.map((r) => ({
            ...r,
            ssnitNumber: r.ssnitNumber ? maskIdentifier(r.ssnitNumber) : r.ssnitNumber,
            tin: r.tin ? maskIdentifier(r.tin) : r.tin,
          })),
    );
  },
);

export default router;
