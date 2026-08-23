/**
 * Payroll, Workstream 3 — Payroll Run Foundation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §10, §13). One run per
 * (organization, period) — enforced by payroll_runs' own unique index. This
 * workstream only ever produces "draft"/"calculated"; "approved"/"locked"
 * are reserved for Workstream 4 and are not reachable from any function
 * here — `approvedByMembershipId`/`lockedAt` are never set by this file.
 *
 * Orchestrates: employee-inclusion resolution (§L, respecting
 * hireDate/separationDate — never assuming every employees row belongs in
 * every period, never depending on staff-number availability) ->
 * per-employee calculation (payrollCalculation.ts) -> persistence of both
 * the summary row (payroll_run_lines) and the itemized trace
 * (payroll_run_line_components). Calculation is transactionally coherent
 * (§W): if ANY included employee fails validation, the entire attempt is
 * rolled back and every per-employee error is reported together — a run
 * never ends up partially calculated.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  employeesTable,
  type PayrollPeriod,
  type PayrollRun,
  type PayrollRunLine,
  type Employee,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { calculateEmployeePayroll, type EmployeePayrollCalculationResult } from "./payrollCalculation";

export class PayrollRunCollisionError extends Error {
  constructor() {
    super("A payroll run already exists for this payroll period");
  }
}
export class PayrollRunNotFoundError extends Error {
  constructor() {
    super("Payroll run not found");
  }
}
export class PayrollPeriodNotFoundError extends Error {
  constructor() {
    super("Payroll period not found");
  }
}
export class NoEligibleEmployeesError extends Error {
  constructor() {
    super("No employees are eligible for this payroll period (by hire/separation date)");
  }
}
export class PayrollRunValidationError extends Error {
  employeeErrors: Array<{ employeeId: number; error: string }>;
  constructor(employeeErrors: Array<{ employeeId: number; error: string }>) {
    super(`Calculation failed for ${employeeErrors.length} employee(s) — no run data was persisted`);
    this.employeeErrors = employeeErrors;
  }
}

/**
 * Employees eligible for `period` — overlap of [hireDate, separationDate ??
 * open) with [period.startDate, period.endDate). Never filters on
 * employmentStatus beyond what separationDate already encodes: "on_leave"/
 * "suspended"/"probation" employees remain included at full resolved
 * compensation (§M — Attendance/Leave must never silently reduce pay merely
 * because a record exists). An employee with no hireDate is excluded — a
 * required, un-guessable input for eligibility.
 */
export async function resolveEligibleEmployeesForPeriod(organizationId: number, period: PayrollPeriod): Promise<Employee[]> {
  const rows = await db.select().from(employeesTable).where(eq(employeesTable.organizationId, organizationId));
  return rows.filter((e) => {
    if (!e.hireDate) return false;
    if (e.hireDate >= period.endDate) return false;
    if (e.separationDate && e.separationDate <= period.startDate) return false;
    return true;
  });
}

export interface CreatePayrollRunParams {
  organizationId: number;
  payrollPeriodId: number;
  actorMembershipId: number;
}

export async function createPayrollRun(params: CreatePayrollRunParams): Promise<PayrollRun> {
  try {
    return await db.transaction(async (tx) => {
      // Shared per-organization advisory-lock domain with payrollPeriods.ts
      // — deliberately conservative: an org's period creation and run
      // creation briefly serialize against each other too, which is a safe
      // over-approximation, not a correctness problem.
      await tx.execute(sql`select pg_advisory_xact_lock(${params.organizationId})`);

      const [period] = await tx
        .select()
        .from(payrollPeriodsTable)
        .where(and(eq(payrollPeriodsTable.id, params.payrollPeriodId), eq(payrollPeriodsTable.organizationId, params.organizationId)));
      if (!period) throw new PayrollPeriodNotFoundError();

      const [existingRun] = await tx
        .select()
        .from(payrollRunsTable)
        .where(and(eq(payrollRunsTable.organizationId, params.organizationId), eq(payrollRunsTable.payrollPeriodId, params.payrollPeriodId)));
      if (existingRun) throw new PayrollRunCollisionError();

      const [created] = await tx
        .insert(payrollRunsTable)
        .values({
          organizationId: params.organizationId,
          payrollPeriodId: params.payrollPeriodId,
          status: "draft",
          preparedByMembershipId: params.actorMembershipId,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new PayrollRunCollisionError();
    throw err;
  }
}

export async function listPayrollRuns(organizationId: number): Promise<PayrollRun[]> {
  return db.select().from(payrollRunsTable).where(eq(payrollRunsTable.organizationId, organizationId)).orderBy(payrollRunsTable.createdAt);
}

export async function getPayrollRun(organizationId: number, id: number): Promise<PayrollRun> {
  const [row] = await db
    .select()
    .from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, id), eq(payrollRunsTable.organizationId, organizationId)));
  if (!row) throw new PayrollRunNotFoundError();
  return row;
}

export interface PayrollRunLineWithTrace {
  line: PayrollRunLine;
  components: EmployeePayrollCalculationResult["components"];
}

export async function getPayrollRunLines(organizationId: number, payrollRunId: number): Promise<PayrollRunLineWithTrace[]> {
  const lines = await db
    .select()
    .from(payrollRunLinesTable)
    .where(and(eq(payrollRunLinesTable.organizationId, organizationId), eq(payrollRunLinesTable.payrollRunId, payrollRunId)));

  const result: PayrollRunLineWithTrace[] = [];
  for (const line of lines) {
    const components = await db
      .select()
      .from(payrollRunLineComponentsTable)
      .where(eq(payrollRunLineComponentsTable.payrollRunLineId, line.id));
    result.push({ line, components });
  }
  return result;
}

export interface CalculatePayrollRunParams {
  organizationId: number;
  payrollRunId: number;
  currency: string;
}

export interface PayrollRunCalculationSummary {
  run: PayrollRun;
  employeeCount: number;
}

/**
 * (Re)calculates every eligible employee for this run's period, atomically.
 * Any prior lines/components for this run are discarded and replaced —
 * explicit, permitted while the run has not passed "calculated" (no later
 * state is reachable in this workstream), never silent (the caller must
 * invoke this explicitly; nothing recalculates on its own).
 */
export async function calculatePayrollRun(params: CalculatePayrollRunParams): Promise<PayrollRunCalculationSummary> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(payrollRunsTable)
      .where(and(eq(payrollRunsTable.id, params.payrollRunId), eq(payrollRunsTable.organizationId, params.organizationId)))
      .for("update");
    if (!run) throw new PayrollRunNotFoundError();

    const [period] = await tx.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.payrollPeriodId));
    if (!period) throw new PayrollPeriodNotFoundError();

    const eligible = await resolveEligibleEmployeesForPeriod(params.organizationId, period);
    if (eligible.length === 0) throw new NoEligibleEmployeesError();

    // Discard any prior calculation for this run — line_components cascade
    // via FK onDelete:"cascade" on payroll_run_line_components.
    await tx.delete(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, run.id));

    const employeeErrors: Array<{ employeeId: number; error: string }> = [];

    for (const employee of eligible) {
      try {
        const result = await calculateEmployeePayroll({
          organizationId: params.organizationId,
          employeeId: employee.id,
          payrollPeriodId: period.id,
          payDate: period.payDate,
          currency: params.currency,
        });

        const [line] = await tx
          .insert(payrollRunLinesTable)
          .values({
            organizationId: params.organizationId,
            payrollRunId: run.id,
            employeeId: employee.id,
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
            currency: result.currency,
          })
          .returning();

        if (result.components.length > 0) {
          await tx.insert(payrollRunLineComponentsTable).values(
            result.components.map((c) => ({
              payrollRunLineId: line.id,
              category: c.category,
              componentTypeCode: c.componentTypeCode,
              amount: c.amount,
              taxableTreatment: c.taxableTreatment,
              pensionable: c.pensionable,
              source: c.source,
            })),
          );
        }
      } catch (err) {
        employeeErrors.push({ employeeId: employee.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (employeeErrors.length > 0) {
      // Throwing inside db.transaction's callback rolls back every write
      // made so far in this attempt, including the delete above — the run
      // remains exactly as it was before this call.
      throw new PayrollRunValidationError(employeeErrors);
    }

    const [updatedRun] = await tx
      .update(payrollRunsTable)
      .set({ status: "calculated", calculatedAt: new Date() })
      .where(eq(payrollRunsTable.id, run.id))
      .returning();

    return { run: updatedRun, employeeCount: eligible.length };
  });
}
