/**
 * Payroll, Workstream 4 — Corrections & Reversals
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §11, §13). A correction NEVER
 * edits a locked run's own lines/components in place — it re-invokes W3's
 * exact calculateEmployeePayroll for the ORIGINAL period's payDate (never
 * "today"), so it naturally re-resolves whatever compensation/statutory
 * data is now on file as of that historical date (never assumes the newest
 * statutory version — §M), and persists the result into its own,
 * separately-approved payroll_corrections/payroll_correction_components
 * rows. The original payroll_run_lines row is read-only here and is never
 * written to by this file.
 *
 * Maker-checker: a single permission (payroll.run.correct) gates both
 * create and approve; the approve step still requires a different
 * membership than the one that created the draft (server-side, mirroring
 * W1's statutory self-approval block), even though both actions share one
 * permission — exactly the frozen plan's "maker-checker applies here too."
 *
 * Every correction attaches directly to the original run line, never to a
 * prior correction — preventing chain/cycle complexity by construction.
 * Multiple sequential (already-approved) corrections per line remain
 * allowed; at most one DRAFT correction may be open per line at a time
 * (payroll_corrections' own partial unique index).
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollPeriodsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  type PayrollCorrection,
  type PayrollCorrectionComponent,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { calculateEmployeePayroll } from "./payrollCalculation";
import { toMinorUnits, fromMinorUnits } from "./payrollMoney";
import { PayrollRunNotFoundError } from "./payrollRuns";
import { violatesSeparationOfDuties } from "./separationOfDuties";

export { PayrollRunNotFoundError };

export class PayrollRunNotLockedError extends Error {
  constructor(status: string) {
    super(`A correction may only be created against a "locked" run (this run is currently "${status}")`);
  }
}
export class PayrollRunLineNotFoundError extends Error {
  constructor() {
    super("Payroll run line not found on this run");
  }
}
export class PayrollCorrectionAlreadyOpenError extends Error {
  constructor() {
    super("A draft correction is already open for this run line — approve or use the existing one before creating another");
  }
}
export class PayrollCorrectionNotFoundError extends Error {
  constructor() {
    super("Payroll correction not found");
  }
}
export class PayrollCorrectionNotDraftError extends Error {
  constructor(status: string) {
    super(`This action requires the correction to be in "draft" status (currently "${status}")`);
  }
}
export class PayrollCorrectionSelfApprovalError extends Error {
  constructor() {
    super("The membership that created a correction may not also approve it");
  }
}

export interface CreatePayrollCorrectionParams {
  organizationId: number;
  originalRunId: number;
  originalRunLineId: number;
  reason: string;
  actorMembershipId: number;
}

export async function createPayrollCorrection(params: CreatePayrollCorrectionParams): Promise<PayrollCorrection> {
  const [run] = await db
    .select()
    .from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, params.originalRunId), eq(payrollRunsTable.organizationId, params.organizationId)));
  if (!run) throw new PayrollRunNotFoundError();
  if (run.status !== "locked") throw new PayrollRunNotLockedError(run.status);

  const [line] = await db
    .select()
    .from(payrollRunLinesTable)
    .where(and(eq(payrollRunLinesTable.id, params.originalRunLineId), eq(payrollRunLinesTable.payrollRunId, run.id)));
  if (!line) throw new PayrollRunLineNotFoundError();

  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.payrollPeriodId));
  if (!period) throw new PayrollRunLineNotFoundError();

  // Re-invokes the unmodified W3 engine, scoped to the ORIGINAL period's
  // payDate — never "now" — so historically-reused staff numbers and
  // superseded statutory versions resolve exactly as they would have for
  // that date, never the current/live state.
  const result = await calculateEmployeePayroll({
    organizationId: params.organizationId,
    employeeId: line.employeeId,
    payrollPeriodId: run.payrollPeriodId,
    payDate: period.payDate,
    currency: line.currency,
  });

  const netPayDelta = fromMinorUnits(toMinorUnits(result.netPay) - toMinorUnits(line.netPay));

  try {
    return await db.transaction(async (tx) => {
      const [correction] = await tx
        .insert(payrollCorrectionsTable)
        .values({
          organizationId: params.organizationId,
          originalRunId: run.id,
          originalRunLineId: line.id,
          employeeId: line.employeeId,
          status: "draft",
          reason: params.reason,
          staffNumberSnapshot: result.staffNumberSnapshot,
          payeBandsVersionId: result.payeBandsVersionId,
          pensionRatesVersionId: result.pensionRatesVersionId,
          pensionEarningsCeilingVersionId: result.pensionEarningsCeilingVersionId,
          grossEarnings: result.grossEarnings,
          pensionableEarnings: result.pensionableEarnings,
          employeePensionDeduction: result.employeePensionDeduction,
          employerPensionContribution: result.employerPensionContribution,
          tier1Amount: result.tier1Amount,
          tier2Amount: result.tier2Amount,
          taxableIncome: result.taxableIncome,
          payeAmount: result.payeAmount,
          otherDeductions: result.otherDeductions,
          netPay: result.netPay,
          netPayDelta,
          currency: result.currency,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      if (result.components.length > 0) {
        await tx.insert(payrollCorrectionComponentsTable).values(
          result.components.map((c) => ({
            payrollCorrectionId: correction.id,
            category: c.category,
            componentTypeCode: c.componentTypeCode,
            amount: c.amount,
            taxableTreatment: c.taxableTreatment,
            pensionable: c.pensionable,
            source: c.source,
          })),
        );
      }
      return correction;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new PayrollCorrectionAlreadyOpenError();
    throw err;
  }
}

/**
 * Maker-checker approval — terminal for a correction (no further "locked"
 * state; approval is itself immutable). Same distinct-actor discipline as
 * W1's statutory rules, and the `.for("update")` lock means two concurrent
 * approval attempts on the same correction serialize naturally.
 */
export async function approvePayrollCorrection(params: {
  organizationId: number;
  correctionId: number;
  approverMembershipId: number;
}): Promise<PayrollCorrection> {
  return db.transaction(async (tx) => {
    const [correction] = await tx
      .select()
      .from(payrollCorrectionsTable)
      .where(and(eq(payrollCorrectionsTable.id, params.correctionId), eq(payrollCorrectionsTable.organizationId, params.organizationId)))
      .for("update");
    if (!correction) throw new PayrollCorrectionNotFoundError();
    if (correction.status !== "draft") throw new PayrollCorrectionNotDraftError(correction.status);
    // WS18-P4-02: created_by_membership_id is ON DELETE SET NULL.
    if (violatesSeparationOfDuties(correction.createdByMembershipId, params.approverMembershipId)) {
      throw new PayrollCorrectionSelfApprovalError();
    }

    const [updated] = await tx
      .update(payrollCorrectionsTable)
      .set({ status: "approved", approvedByMembershipId: params.approverMembershipId, approvedAt: new Date() })
      .where(eq(payrollCorrectionsTable.id, correction.id))
      .returning();
    return updated;
  });
}

export async function listPayrollCorrectionsForRun(organizationId: number, originalRunId: number): Promise<PayrollCorrection[]> {
  return db
    .select()
    .from(payrollCorrectionsTable)
    .where(and(eq(payrollCorrectionsTable.organizationId, organizationId), eq(payrollCorrectionsTable.originalRunId, originalRunId)));
}

export async function getPayrollCorrectionWithComponents(
  organizationId: number,
  correctionId: number,
): Promise<{ correction: PayrollCorrection; components: PayrollCorrectionComponent[] } | null> {
  const [correction] = await db
    .select()
    .from(payrollCorrectionsTable)
    .where(and(eq(payrollCorrectionsTable.id, correctionId), eq(payrollCorrectionsTable.organizationId, organizationId)));
  if (!correction) return null;

  const components = await db
    .select()
    .from(payrollCorrectionComponentsTable)
    .where(eq(payrollCorrectionComponentsTable.payrollCorrectionId, correction.id));
  return { correction, components };
}
