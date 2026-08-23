/**
 * Payroll, Frozen Workstream 8 — Payment Batches
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §13). Every route requires the
 * single frozen `payroll.payment.manage` permission — no separate approval
 * permission was frozen for payment batches, so none is invented here.
 *
 * CSV FORMULA-INJECTION HARDENING (disclosed scope exception): every other
 * CSV export in this platform (including this workstream's own sibling,
 * payrollReports.ts) shares one known, pre-existing, platform-wide gap —
 * no leading-character escaping against spreadsheet formula injection. That
 * gap is NOT fixed platform-wide by this workstream. This ONE export is
 * different: it is a real payment instruction, containing live-resolved
 * employee names and bank account-holder names that could plausibly begin
 * with a formula-triggering character, opened by a bank operator who may
 * paste its values directly into a payment system. That is a materially
 * higher-stakes context than a read-only report, so this route applies a
 * standard OWASP-style mitigation (a leading `'` guard on any cell
 * beginning with =, +, -, @, tab, or CR) before the normal CSV quoting —
 * scoped to this file only, not claimed as fixed anywhere else.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createPaymentBatch,
  listPaymentBatchesForRun,
  getPaymentBatch,
  getPaymentBatchLines,
  deletePaymentBatch,
  exportPaymentBatch,
  maskAccountNumber,
  PayrollRunNotFoundError,
  PayrollRunNotLockedError,
  PayrollPaymentBatchAlreadyExistsError,
  PayrollPaymentBatchNoEligibleLinesError,
  PayrollPaymentBatchMissingBankingError,
  PayrollPaymentBatchNotFoundError,
  PayrollPaymentBatchNotDraftError,
} from "../lib/payrollPaymentBatches";
import { batchEmployeeNames } from "../lib/payrollReporting";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function safeCsvCell(value: string | number | null): string {
  let str = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(rows: Array<Record<string, string | number | null>>, columns: { key: string; label: string }[]): string {
  const header = columns.map((c) => safeCsvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => safeCsvCell(row[c.key])).join(","));
  return [header, ...body].join("\n");
}

const EXPORT_COLUMNS = [
  { key: "employeeId", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "staffNumber", label: "Staff Number" },
  { key: "bankCode", label: "Bank Code" },
  { key: "accountNumber", label: "Account Number" },
  { key: "accountName", label: "Account Name" },
  { key: "branch", label: "Branch" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "paymentReference", label: "Payment Reference" },
];

// POST /organizations/:organizationId/payroll/runs/:runId/payment-batches
router.post(
  "/organizations/:organizationId/payroll/runs/:runId/payment-batches",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payment.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    try {
      const result = await createPaymentBatch({ organizationId, payrollRunId: runId, actorMembershipId: req.membership!.id });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_payment_batch.created",
        targetType: "payroll_payment_batch",
        targetId: String(result.batch.id),
        afterState: {
          payrollRunId: runId,
          reference: result.batch.reference,
          employeeCount: result.batch.employeeCount,
          totalAmount: result.batch.totalAmount,
          currency: result.batch.currency,
          excludedCount: result.excludedLines.length,
        },
      });

      res.status(201).json({
        batch: result.batch,
        lines: result.lines.map((l) => ({ ...l, accountNumber: maskAccountNumber(l.accountNumber) })),
        excludedLines: result.excludedLines,
      });
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollPaymentBatchAlreadyExistsError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollPaymentBatchNoEligibleLinesError) {
        res.status(422).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollPaymentBatchMissingBankingError) {
        res.status(422).json({ error: err.message, employeeIds: err.employeeIds });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/runs/:runId/payment-batches
router.get(
  "/organizations/:organizationId/payroll/runs/:runId/payment-batches",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payment.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const rows = await listPaymentBatchesForRun(req.membership!.organizationId, runId);
    res.json(rows);
  },
);

// GET /organizations/:organizationId/payroll/payment-batches/:id
router.get(
  "/organizations/:organizationId/payroll/payment-batches/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payment.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid payment batch ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    try {
      const batch = await getPaymentBatch(organizationId, id);
      const lines = await getPaymentBatchLines(organizationId, batch.id);
      const employeeNames = await batchEmployeeNames(lines.map((l) => l.employeeId));
      res.json({
        batch,
        lines: lines.map((l) => ({
          ...l,
          employeeName: employeeNames.get(l.employeeId) ?? `Employee #${l.employeeId}`,
          accountNumber: maskAccountNumber(l.accountNumber),
        })),
      });
    } catch (err) {
      if (err instanceof PayrollPaymentBatchNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/payroll/payment-batches/:id
router.delete(
  "/organizations/:organizationId/payroll/payment-batches/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payment.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid payment batch ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    try {
      await deletePaymentBatch(organizationId, id);

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "payroll_payment_batch.deleted",
        targetType: "payroll_payment_batch",
        targetId: String(id),
      });

      res.status(204).send();
    } catch (err) {
      if (err instanceof PayrollPaymentBatchNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollPaymentBatchNotDraftError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/payroll/payment-batches/:id/export
router.post(
  "/organizations/:organizationId/payroll/payment-batches/:id/export",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.payment.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid payment batch ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    try {
      const result = await exportPaymentBatch({ organizationId, id, actorMembershipId: req.membership!.id });
      const employeeNames = await batchEmployeeNames(result.lines.map((l) => l.employeeId));

      if (!result.wasAlreadyExported) {
        // Full, unmasked account numbers are only ever produced here — a
        // sensitive-data disclosure event, audited per Decision 9's
        // established banking-read-audit convention.
        await recordAuditEvent({
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          organizationId,
          eventType: "payroll_payment_batch.exported",
          targetType: "payroll_payment_batch",
          targetId: String(id),
          afterState: { employeeCount: result.batch.employeeCount, totalAmount: result.batch.totalAmount, currency: result.batch.currency },
        });
      }

      const rows = result.lines.map((l) => ({
        employeeId: l.employeeId,
        employeeName: employeeNames.get(l.employeeId) ?? `Employee #${l.employeeId}`,
        staffNumber: l.staffNumberSnapshot,
        bankCode: l.bankCode,
        accountNumber: l.accountNumber,
        accountName: l.accountName,
        branch: l.branch,
        amount: l.amount,
        currency: l.currency,
        paymentReference: l.paymentReference,
      }));

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="payment-batch-${result.batch.reference}.csv"`);
      res.send(toCsv(rows, EXPORT_COLUMNS));
    } catch (err) {
      if (err instanceof PayrollPaymentBatchNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
