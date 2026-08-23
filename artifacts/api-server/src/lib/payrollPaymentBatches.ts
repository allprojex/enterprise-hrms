/**
 * Payroll, Frozen Workstream 8 — Payment Batches
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §13). PAYMENT BATCH
 * PREPARATION only:
 *
 *   PAYROLL FINANCIAL RESULT -> PAYMENT BATCH PREPARATION -> EXPORT/
 *   INSTRUCTION FILE -> EXTERNAL BANK/PAYMENT PROCESS
 *
 * never "payroll -> automatically send money". No bank/mobile-money/
 * payment-gateway integration exists anywhere in this file or this
 * platform (frozen plan §19's deferral).
 *
 * SOURCE OF PAYMENT VALUES: a batch line's `amount` is the EFFECTIVE net
 * pay at batch-creation time — the run line's own net pay, or (if a
 * correction has been approved for that line) the latest approved
 * correction's own already-recalculated net pay — mirroring exactly the
 * "effective" figure payrollReporting.ts already established for payslips
 * (Workstream 5), not a new invented concept. This value is snapshotted
 * into the batch line at creation and never recomputed afterward, even
 * while the batch is still "draft" — a correction approved AFTER a batch
 * already exists for its run does not retroactively alter that batch (§12/
 * §30 — never a silent overwrite of an already-produced payment
 * instruction). Exactly one batch is permitted per payroll run for the
 * run's entire lifetime (payroll_payment_batches' own unique index) — this
 * workstream does not implement multi-batch/delta-supplementary-payment
 * handling for a correction approved after a batch already exists; that is
 * an explicit, disclosed V1 boundary, not an oversight.
 *
 * ELIGIBILITY (§15, resolved pragmatically and disclosed, not invented
 * silently): only a line whose effective net pay is POSITIVE becomes a
 * batch line — a real, sensible payment instruction. A line with effective
 * net pay of exactly zero, or negative (money owed BY the employee, not a
 * valid bank-transfer instruction), is EXCLUDED from the batch and
 * reported back to the caller in `excludedLines` (never silently dropped),
 * so `sum(batch lines) == batch.totalAmount` always holds exactly, and the
 * caller always has full visibility into who was excluded and why.
 *
 * BANKING SNAPSHOT (§7): each included line's bank code/account number/
 * account name/branch are copied from employee_banking_details' currently
 * OPEN row at batch-creation time. If ANY eligible (positive-net-pay)
 * employee has no open banking record, batch creation fails entirely
 * (all-or-nothing among the eligible population) — never a batch with an
 * incomplete payment destination.
 *
 * MAKER-CHECKER (§9): the frozen plan's own §14 permission list names only
 * ONE payroll-payment permission — `payroll.payment.manage` — no separate
 * `.approve` key was frozen. No approval stage is invented here; a single
 * permission gates create/export/delete, matching "do not invent or remove
 * approval stages."
 */
import { randomBytes } from "crypto";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollCorrectionsTable,
  payrollPaymentBatchesTable,
  payrollPaymentBatchLinesTable,
  type PayrollPaymentBatch,
  type PayrollPaymentBatchLine,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { toMinorUnits, fromMinorUnits, sumMinor } from "./payrollMoney";
import { resolveCurrentBankingDetailsBatch } from "./payrollSensitiveRecords";

export class PayrollRunNotFoundError extends Error {
  constructor() {
    super("Payroll run not found");
  }
}
export class PayrollRunNotLockedError extends Error {
  constructor(status: string) {
    super(`A payment batch may only be prepared for a "locked" run (this run is currently "${status}")`);
  }
}
export class PayrollPaymentBatchAlreadyExistsError extends Error {
  constructor() {
    super("A payment batch already exists for this payroll run");
  }
}
export class PayrollPaymentBatchNoEligibleLinesError extends Error {
  constructor() {
    super("No employee on this run has a positive net pay eligible for a payment batch");
  }
}
export class PayrollPaymentBatchMissingBankingError extends Error {
  employeeIds: number[];
  constructor(employeeIds: number[]) {
    super(`${employeeIds.length} employee(s) eligible for payment have no banking details on file — resolve before preparing this batch`);
    this.employeeIds = employeeIds;
  }
}
export class PayrollPaymentBatchNotFoundError extends Error {
  constructor() {
    super("Payment batch not found");
  }
}
export class PayrollPaymentBatchNotDraftError extends Error {
  constructor(status: string) {
    super(`This action requires the payment batch to be in "draft" status (currently "${status}")`);
  }
}

function generateReference(organizationId: number, payrollRunId: number): string {
  return `PB-${organizationId}-${payrollRunId}-${randomBytes(6).toString("hex")}`;
}

export interface ExcludedLine {
  employeeId: number;
  netPay: string;
  reason: "zero_net_pay" | "negative_net_pay";
}

export interface CreatePaymentBatchResult {
  batch: PayrollPaymentBatch;
  lines: PayrollPaymentBatchLine[];
  excludedLines: ExcludedLine[];
}

export interface CreatePaymentBatchParams {
  organizationId: number;
  payrollRunId: number;
  actorMembershipId: number;
}

export async function createPaymentBatch(params: CreatePaymentBatchParams): Promise<CreatePaymentBatchResult> {
  const [run] = await db
    .select()
    .from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, params.payrollRunId), eq(payrollRunsTable.organizationId, params.organizationId)));
  if (!run) throw new PayrollRunNotFoundError();
  if (run.status !== "locked") throw new PayrollRunNotLockedError(run.status);

  const [existing] = await db.select().from(payrollPaymentBatchesTable).where(eq(payrollPaymentBatchesTable.payrollRunId, run.id));
  if (existing) throw new PayrollPaymentBatchAlreadyExistsError();

  const lines = await db.select().from(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, run.id));
  if (lines.length === 0) throw new PayrollPaymentBatchNoEligibleLinesError();

  // Latest APPROVED correction per line — the same "effective figure"
  // concept payrollReporting.ts already established for payslips.
  const lineIds = lines.map((l) => l.id);
  const approvedCorrections = await db
    .select()
    .from(payrollCorrectionsTable)
    .where(and(inArray(payrollCorrectionsTable.originalRunLineId, lineIds), eq(payrollCorrectionsTable.status, "approved")))
    .orderBy(desc(payrollCorrectionsTable.approvedAt));
  const latestCorrectionByLine = new Map<number, (typeof approvedCorrections)[number]>();
  for (const c of approvedCorrections) {
    if (!latestCorrectionByLine.has(c.originalRunLineId)) latestCorrectionByLine.set(c.originalRunLineId, c);
  }

  const eligible: Array<{ line: (typeof lines)[number]; netPay: string; sourceCorrectionId: number | null }> = [];
  const excludedLines: ExcludedLine[] = [];

  for (const line of lines) {
    const correction = latestCorrectionByLine.get(line.id) ?? null;
    const netPay = correction ? correction.netPay : line.netPay;
    const netPayMinor = toMinorUnits(netPay);
    if (netPayMinor > 0n) {
      eligible.push({ line, netPay, sourceCorrectionId: correction?.id ?? null });
    } else {
      excludedLines.push({ employeeId: line.employeeId, netPay, reason: netPayMinor === 0n ? "zero_net_pay" : "negative_net_pay" });
    }
  }

  if (eligible.length === 0) throw new PayrollPaymentBatchNoEligibleLinesError();

  const bankingByEmployee = await resolveCurrentBankingDetailsBatch(
    params.organizationId,
    eligible.map((e) => e.line.employeeId),
  );
  const missingBanking = eligible.filter((e) => !bankingByEmployee.has(e.line.employeeId)).map((e) => e.line.employeeId);
  if (missingBanking.length > 0) throw new PayrollPaymentBatchMissingBankingError(missingBanking);

  const currency = lines[0].currency;
  const totalAmount = fromMinorUnits(sumMinor(eligible.map((e) => toMinorUnits(e.netPay))));
  const reference = generateReference(params.organizationId, run.id);

  try {
    return await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(payrollPaymentBatchesTable)
        .values({
          organizationId: params.organizationId,
          payrollRunId: run.id,
          paymentMethod: "bank_transfer",
          reference,
          status: "draft",
          currency,
          totalAmount,
          employeeCount: eligible.length,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      const insertedLines = await tx
        .insert(payrollPaymentBatchLinesTable)
        .values(
          eligible.map((e) => {
            const banking = bankingByEmployee.get(e.line.employeeId)!;
            return {
              paymentBatchId: batch.id,
              organizationId: params.organizationId,
              payrollRunLineId: e.line.id,
              sourceCorrectionId: e.sourceCorrectionId,
              employeeId: e.line.employeeId,
              staffNumberSnapshot: e.line.staffNumberSnapshot,
              amount: e.netPay,
              currency: e.line.currency,
              bankCode: banking.bankCode,
              accountNumber: banking.accountNumber,
              accountName: banking.accountName,
              branch: banking.branch,
              paymentReference: `${reference}-L${e.line.employeeId}`,
            };
          }),
        )
        .returning();

      return { batch, lines: insertedLines, excludedLines };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new PayrollPaymentBatchAlreadyExistsError();
    throw err;
  }
}

export async function listPaymentBatchesForRun(organizationId: number, payrollRunId: number): Promise<PayrollPaymentBatch[]> {
  return db
    .select()
    .from(payrollPaymentBatchesTable)
    .where(and(eq(payrollPaymentBatchesTable.organizationId, organizationId), eq(payrollPaymentBatchesTable.payrollRunId, payrollRunId)));
}

export async function getPaymentBatch(organizationId: number, id: number): Promise<PayrollPaymentBatch> {
  const [row] = await db
    .select()
    .from(payrollPaymentBatchesTable)
    .where(and(eq(payrollPaymentBatchesTable.id, id), eq(payrollPaymentBatchesTable.organizationId, organizationId)));
  if (!row) throw new PayrollPaymentBatchNotFoundError();
  return row;
}

export async function getPaymentBatchLines(organizationId: number, paymentBatchId: number): Promise<PayrollPaymentBatchLine[]> {
  return db
    .select()
    .from(payrollPaymentBatchLinesTable)
    .where(and(eq(payrollPaymentBatchLinesTable.organizationId, organizationId), eq(payrollPaymentBatchLinesTable.paymentBatchId, paymentBatchId)));
}

/** Draft only — nothing has been exported yet, so nothing external depends on this row. Lines cascade. */
export async function deletePaymentBatch(organizationId: number, id: number): Promise<void> {
  const batch = await getPaymentBatch(organizationId, id);
  if (batch.status !== "draft") throw new PayrollPaymentBatchNotDraftError(batch.status);
  await db.delete(payrollPaymentBatchesTable).where(eq(payrollPaymentBatchesTable.id, batch.id));
}

export interface ExportPaymentBatchResult {
  batch: PayrollPaymentBatch;
  lines: PayrollPaymentBatchLine[];
  wasAlreadyExported: boolean;
}

/**
 * First call on a "draft" batch: transitions to "exported" (terminal,
 * immutable) and returns the full line set for the caller to render as a
 * file. A repeat call on an already-"exported" batch performs no further
 * mutation and simply re-returns the identical, already-persisted lines —
 * a non-mutating re-download, never a second state transition.
 */
export async function exportPaymentBatch(params: { organizationId: number; id: number; actorMembershipId: number }): Promise<ExportPaymentBatchResult> {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(payrollPaymentBatchesTable)
      .where(and(eq(payrollPaymentBatchesTable.id, params.id), eq(payrollPaymentBatchesTable.organizationId, params.organizationId)))
      .for("update");
    if (!batch) throw new PayrollPaymentBatchNotFoundError();

    const lines = await tx
      .select()
      .from(payrollPaymentBatchLinesTable)
      .where(eq(payrollPaymentBatchLinesTable.paymentBatchId, batch.id));

    if (batch.status === "exported") {
      return { batch, lines, wasAlreadyExported: true };
    }

    const [updated] = await tx
      .update(payrollPaymentBatchesTable)
      .set({ status: "exported", exportedAt: new Date(), exportedByMembershipId: params.actorMembershipId })
      .where(eq(payrollPaymentBatchesTable.id, batch.id))
      .returning();

    return { batch: updated, lines, wasAlreadyExported: false };
  });
}

/** Last 4 characters visible only — for ordinary JSON review surfaces. Full values are only ever returned by the export route (§8). */
export function maskAccountNumber(accountNumber: string): string {
  if (accountNumber.length <= 4) return "*".repeat(accountNumber.length);
  return "*".repeat(accountNumber.length - 4) + accountNumber.slice(-4);
}
