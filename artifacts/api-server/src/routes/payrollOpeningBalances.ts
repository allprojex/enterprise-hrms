/**
 * Payroll Opening Balances — a minimal review/correction surface.
 *
 * Deliberately narrow: list and read what was imported, amend it while it is
 * still amendable, and read the year-to-date figure it contributes to. There
 * is no create endpoint — an opening balance is brought-forward history
 * established at migration cutover, so WS-7's reviewed/approved import is the
 * only way one comes into existence. Adding a free-hand create route would
 * bypass that review path for no stated need.
 *
 * Audit is emitted here rather than in the service, following this codebase's
 * own payroll convention (see payrollSensitiveRecords.ts): the audit call is a
 * concern of what was actually returned to, or changed by, a caller.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { recordAuditEvent } from "../lib/auditLog";
import {
  getEmployeeYearToDate,
  getPayrollOpeningBalance,
  listPayrollOpeningBalances,
  updatePayrollOpeningBalanceBeforeLock,
  isOpeningBalanceLocked,
  PayrollOpeningBalanceNotFoundError,
  PayrollOpeningBalanceLockedError,
  InvalidPayrollOpeningBalanceError,
  type OpeningBalanceAmounts,
} from "../lib/payrollOpeningBalances";

const router = Router();

const AMOUNT_KEYS: (keyof OpeningBalanceAmounts)[] = [
  "grossEarnings",
  "taxableIncome",
  "payeAmount",
  "pensionableEarnings",
  "employeePensionDeduction",
  "employerPensionContribution",
];

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof PayrollOpeningBalanceNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof PayrollOpeningBalanceLockedError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidPayrollOpeningBalanceError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/payroll/opening-balances?taxYear=
router.get(
  "/organizations/:organizationId/payroll/opening-balances",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("payroll.opening_balance.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const taxYearRaw = req.query.taxYear;
    const taxYear = taxYearRaw != null && taxYearRaw !== "" ? Number(taxYearRaw) : undefined;
    if (taxYear != null && !Number.isInteger(taxYear)) {
      res.status(400).json({ error: "taxYear must be a whole year" });
      return;
    }
    const balances = await listPayrollOpeningBalances(organizationId, taxYear);

    // Payroll amounts are sensitive; reading a set of them is an auditable
    // event in this codebase's payroll convention. Scalar counts only.
    await recordAuditEvent({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      eventType: "payroll_opening_balance.read",
      targetType: "organization",
      targetId: String(organizationId),
      afterState: { taxYear: taxYear ?? null, count: balances.length },
    });

    res.json({ balances });
  },
);

// GET /organizations/:organizationId/payroll/opening-balances/:employeeId/:taxYear
router.get(
  "/organizations/:organizationId/payroll/opening-balances/:employeeId/:taxYear",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("payroll.opening_balance.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = Number(req.params.employeeId);
    const taxYear = Number(req.params.taxYear);
    const balance = await getPayrollOpeningBalance(organizationId, employeeId, taxYear);
    // Org-scoped lookup: another organization's record is indistinguishable
    // from one that does not exist.
    if (!balance) {
      res.status(404).json({ error: "Payroll opening balance not found" });
      return;
    }
    res.json({ balance, locked: !!balance.lockedAt || (await isOpeningBalanceLocked(organizationId, employeeId, taxYear)) });
  },
);

// PUT /organizations/:organizationId/payroll/opening-balances/:employeeId/:taxYear
router.put(
  "/organizations/:organizationId/payroll/opening-balances/:employeeId/:taxYear",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("payroll.opening_balance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = Number(req.params.employeeId);
    const taxYear = Number(req.params.taxYear);

    const amounts = {} as OpeningBalanceAmounts;
    for (const key of AMOUNT_KEYS) {
      const value = req.body?.[key];
      if (value == null) {
        res.status(400).json({ error: `${key} is required` });
        return;
      }
      amounts[key] = String(value);
    }

    try {
      const before = await getPayrollOpeningBalance(organizationId, employeeId, taxYear);
      const updated = await updatePayrollOpeningBalanceBeforeLock({
        organizationId,
        employeeId,
        taxYear,
        amounts,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "payroll_opening_balance.updated",
        targetType: "payroll_opening_balance",
        targetId: String(updated.id),
        beforeState: before ? { taxYear: before.taxYear, grossEarnings: before.grossEarnings, payeAmount: before.payeAmount } : null,
        afterState: { taxYear: updated.taxYear, grossEarnings: updated.grossEarnings, payeAmount: updated.payeAmount },
      });

      res.json(updated);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/year-to-date/:employeeId/:taxYear
router.get(
  "/organizations/:organizationId/payroll/year-to-date/:employeeId/:taxYear",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("payroll.report.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = Number(req.params.employeeId);
    const taxYear = Number(req.params.taxYear);
    if (!Number.isInteger(taxYear)) {
      res.status(400).json({ error: "taxYear must be a whole year" });
      return;
    }
    res.json(await getEmployeeYearToDate(organizationId, employeeId, taxYear));
  },
);

export default router;
