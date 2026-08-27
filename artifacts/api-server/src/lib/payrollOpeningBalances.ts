/**
 * Payroll Opening Balances — the canonical service. Nothing else may insert
 * or update `payroll_opening_balances`; WS-7's migration adapter calls this,
 * as does the Payroll admin route.
 *
 * An opening balance is brought-forward payroll/statutory history for payroll
 * processed OUTSIDE this HRMS before the organization's cutover. It is never
 * paid, never becomes compensation, and never produces a run, payslip,
 * payment or journal.
 *
 * The one integration point is `getEmployeeYearToDate`, which adds
 * brought-forward totals to the totals of payroll actually finalized inside
 * this HRMS. The current-period calculation engine (`payrollCalculation.ts`)
 * is deliberately NOT touched: every input it uses is per-period (graduated
 * bands on the period's taxable income, the SSNIT ceiling clamped to the
 * period's pensionable earnings, bonus tax annualising the CURRENT basic
 * salary), so there is nothing for a brought-forward figure to feed. That is
 * not an omission — it is the structural reason an opening balance can never
 * be re-paid.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  db,
  payrollOpeningBalancesTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollPeriodsTable,
  employeesTable,
  type PayrollOpeningBalance,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

/** Accepts the global `db` or a transaction client, so an opening balance can be created inside a caller's own transaction (WS-7 atomic migration). */
export type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PayrollOpeningBalanceNotFoundError extends Error {
  constructor() {
    super("Payroll opening balance not found");
    this.name = "PayrollOpeningBalanceNotFoundError";
  }
}

export class DuplicatePayrollOpeningBalanceError extends Error {
  constructor(taxYear: number) {
    super(`This employee already has a payroll opening balance for ${taxYear}`);
    this.name = "DuplicatePayrollOpeningBalanceError";
  }
}

export class PayrollOpeningBalanceLockedError extends Error {
  constructor() {
    super("This opening balance has been consumed by finalized payroll and can no longer be edited");
    this.name = "PayrollOpeningBalanceLockedError";
  }
}

export class InvalidPayrollOpeningBalanceError extends Error {}

export class CrossOrganizationEmployeeError extends Error {
  constructor() {
    super("Employee does not belong to this organization");
    this.name = "CrossOrganizationEmployeeError";
  }
}

/** The six brought-forward measures, in the same denomination payroll_run_lines uses. */
export interface OpeningBalanceAmounts {
  grossEarnings: string;
  taxableIncome: string;
  payeAmount: string;
  pensionableEarnings: string;
  employeePensionDeduction: string;
  employerPensionContribution: string;
}

const AMOUNT_FIELDS: (keyof OpeningBalanceAmounts)[] = [
  "grossEarnings",
  "taxableIncome",
  "payeAmount",
  "pensionableEarnings",
  "employeePensionDeduction",
  "employerPensionContribution",
];

/** Tax years this platform will accept. Bounded so a typo'd year cannot create an unreachable record. */
const MIN_TAX_YEAR = 1900;

function assertValidAmounts(amounts: OpeningBalanceAmounts): void {
  for (const field of AMOUNT_FIELDS) {
    const raw = amounts[field];
    if (raw == null || String(raw).trim() === "") throw new InvalidPayrollOpeningBalanceError(`${field} is required`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new InvalidPayrollOpeningBalanceError(`${field} must be a number`);
    // Brought-forward statutory totals are accumulations of amounts already
    // paid/withheld; a negative total is not representable and is far more
    // likely a mis-mapped column than a real credit.
    if (value < 0) throw new InvalidPayrollOpeningBalanceError(`${field} cannot be negative`);
  }
}

function assertValidYearAndCutover(taxYear: number, cutoverDate: Date): void {
  if (!Number.isInteger(taxYear) || taxYear < MIN_TAX_YEAR) {
    throw new InvalidPayrollOpeningBalanceError(`Tax year "${taxYear}" is not a valid year`);
  }
  if (Number.isNaN(cutoverDate.getTime())) throw new InvalidPayrollOpeningBalanceError("Cutover date is not a valid date");
  // The cutover must sit inside the year whose totals are being carried
  // forward — a 2026 opening balance with a 2024 cutover describes nothing
  // coherent.
  if (cutoverDate.getUTCFullYear() !== taxYear) {
    throw new InvalidPayrollOpeningBalanceError(`Cutover date must fall within tax year ${taxYear}`);
  }
  const currentYear = new Date().getUTCFullYear();
  if (taxYear > currentYear) {
    throw new InvalidPayrollOpeningBalanceError(`Tax year ${taxYear} is in the future — opening balances are historical`);
  }
}

async function assertEmployeeInOrganization(client: QueryClient, organizationId: number, employeeId: number): Promise<void> {
  const [row] = await client
    .select({ organizationId: employeesTable.organizationId })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);
  if (!row || row.organizationId !== organizationId) throw new CrossOrganizationEmployeeError();
}

export interface CreatePayrollOpeningBalanceParams extends OpeningBalanceAmounts {
  organizationId: number;
  employeeId: number;
  taxYear: number;
  cutoverDate: Date;
  currency: string;
  sourceReferenceType?: string | null;
  sourceReferenceId?: number | null;
  sourceRowNumber?: number | null;
  actorMembershipId: number | null;
}

/**
 * Creates the single authoritative brought-forward record for
 * (organization, employee, tax year). A second attempt for the same triple is
 * refused by the database's own unique index, which is what makes a replayed
 * migration harmless rather than duplicating history.
 */
export async function createPayrollOpeningBalance(
  client: QueryClient,
  params: CreatePayrollOpeningBalanceParams,
): Promise<PayrollOpeningBalance> {
  assertValidYearAndCutover(params.taxYear, params.cutoverDate);
  assertValidAmounts(params);
  await assertEmployeeInOrganization(client, params.organizationId, params.employeeId);

  try {
    const [created] = await client
      .insert(payrollOpeningBalancesTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        taxYear: params.taxYear,
        cutoverDate: params.cutoverDate,
        currency: params.currency,
        grossEarnings: params.grossEarnings,
        taxableIncome: params.taxableIncome,
        payeAmount: params.payeAmount,
        pensionableEarnings: params.pensionableEarnings,
        employeePensionDeduction: params.employeePensionDeduction,
        employerPensionContribution: params.employerPensionContribution,
        sourceReferenceType: params.sourceReferenceType ?? null,
        sourceReferenceId: params.sourceReferenceId ?? null,
        sourceRowNumber: params.sourceRowNumber ?? null,
        createdByMembershipId: params.actorMembershipId,
        updatedByMembershipId: params.actorMembershipId,
      })
      .returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicatePayrollOpeningBalanceError(params.taxYear);
    throw err;
  }
}

export async function getPayrollOpeningBalance(
  organizationId: number,
  employeeId: number,
  taxYear: number,
): Promise<PayrollOpeningBalance | null> {
  const [row] = await db
    .select()
    .from(payrollOpeningBalancesTable)
    .where(
      and(
        eq(payrollOpeningBalancesTable.organizationId, organizationId),
        eq(payrollOpeningBalancesTable.employeeId, employeeId),
        eq(payrollOpeningBalancesTable.taxYear, taxYear),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listPayrollOpeningBalances(organizationId: number, taxYear?: number): Promise<PayrollOpeningBalance[]> {
  const conditions = [eq(payrollOpeningBalancesTable.organizationId, organizationId)];
  if (taxYear != null) conditions.push(eq(payrollOpeningBalancesTable.taxYear, taxYear));
  return db.select().from(payrollOpeningBalancesTable).where(and(...conditions));
}

/**
 * True once ANY payroll run for this employee's organization in this tax year
 * has reached `locked` — the run-status lifecycle's own terminal, immutable
 * state. From that point the brought-forward figures have informed finalized
 * payroll history, so overwriting them would silently rewrite that history.
 */
export async function isOpeningBalanceLocked(organizationId: number, employeeId: number, taxYear: number): Promise<boolean> {
  const yearStart = new Date(Date.UTC(taxYear, 0, 1));
  const yearEnd = new Date(Date.UTC(taxYear + 1, 0, 1));
  const [row] = await db
    .select({ id: payrollRunLinesTable.id })
    .from(payrollRunLinesTable)
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollRunLinesTable.payrollRunId))
    .innerJoin(payrollPeriodsTable, eq(payrollPeriodsTable.id, payrollRunsTable.payrollPeriodId))
    .where(
      and(
        eq(payrollRunLinesTable.organizationId, organizationId),
        eq(payrollRunLinesTable.employeeId, employeeId),
        eq(payrollRunsTable.status, "locked"),
        gte(payrollPeriodsTable.startDate, yearStart),
        lt(payrollPeriodsTable.startDate, yearEnd),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Amends a brought-forward record. Refused once locked — a correction after
 * finalized payroll must go through Payroll's existing correction mechanism
 * rather than rewriting the historical input behind it.
 */
export async function updatePayrollOpeningBalanceBeforeLock(params: {
  organizationId: number;
  employeeId: number;
  taxYear: number;
  amounts: OpeningBalanceAmounts;
  actorMembershipId: number | null;
}): Promise<PayrollOpeningBalance> {
  const existing = await getPayrollOpeningBalance(params.organizationId, params.employeeId, params.taxYear);
  if (!existing) throw new PayrollOpeningBalanceNotFoundError();
  if (existing.lockedAt) throw new PayrollOpeningBalanceLockedError();
  if (await isOpeningBalanceLocked(params.organizationId, params.employeeId, params.taxYear)) {
    // Lazily stamp the lock we just discovered, so the state is durable and
    // the next reader does not have to re-derive it.
    await db
      .update(payrollOpeningBalancesTable)
      .set({ lockedAt: new Date() })
      .where(eq(payrollOpeningBalancesTable.id, existing.id));
    throw new PayrollOpeningBalanceLockedError();
  }

  assertValidAmounts(params.amounts);
  const [updated] = await db
    .update(payrollOpeningBalancesTable)
    .set({ ...params.amounts, updatedByMembershipId: params.actorMembershipId })
    .where(eq(payrollOpeningBalancesTable.id, existing.id))
    .returning();
  return updated;
}

/** Marks the record locked. Idempotent. */
export async function lockPayrollOpeningBalance(organizationId: number, employeeId: number, taxYear: number): Promise<void> {
  await db
    .update(payrollOpeningBalancesTable)
    .set({ lockedAt: new Date() })
    .where(
      and(
        eq(payrollOpeningBalancesTable.organizationId, organizationId),
        eq(payrollOpeningBalancesTable.employeeId, employeeId),
        eq(payrollOpeningBalancesTable.taxYear, taxYear),
        sql`${payrollOpeningBalancesTable.lockedAt} IS NULL`,
      ),
    );
}

export interface YearToDateTotals extends OpeningBalanceAmounts {
  taxYear: number;
  /** The brought-forward half, kept separate so a report can show what came from before cutover. */
  broughtForward: OpeningBalanceAmounts | null;
  /** The half this HRMS actually calculated (locked runs only). */
  inSystem: OpeningBalanceAmounts;
}

const ZERO_AMOUNTS: OpeningBalanceAmounts = {
  grossEarnings: "0.00",
  taxableIncome: "0.00",
  payeAmount: "0.00",
  pensionableEarnings: "0.00",
  employeePensionDeduction: "0.00",
  employerPensionContribution: "0.00",
};

function addAmounts(a: OpeningBalanceAmounts, b: OpeningBalanceAmounts): OpeningBalanceAmounts {
  const out = {} as OpeningBalanceAmounts;
  for (const field of AMOUNT_FIELDS) out[field] = (Number(a[field]) + Number(b[field])).toFixed(2);
  return out;
}

/**
 * THE integration point. Year-to-date = brought-forward history + payroll
 * finalized inside this HRMS.
 *
 * Only `locked` runs are summed: a draft or merely-calculated run is not
 * finalized payroll and must not inflate a statutory year-to-date figure.
 *
 * This is a REPORTING function. It is deliberately not called from
 * `payrollCalculation.ts`, because no statutory calculation in this engine
 * takes a cumulative input — which is precisely what guarantees a
 * brought-forward amount can never leak into current-period pay.
 */
export async function getEmployeeYearToDate(
  organizationId: number,
  employeeId: number,
  taxYear: number,
): Promise<YearToDateTotals> {
  const opening = await getPayrollOpeningBalance(organizationId, employeeId, taxYear);
  const yearStart = new Date(Date.UTC(taxYear, 0, 1));
  const yearEnd = new Date(Date.UTC(taxYear + 1, 0, 1));

  const [summed] = await db
    .select({
      grossEarnings: sql<string>`COALESCE(SUM(${payrollRunLinesTable.grossEarnings}), 0)::text`,
      taxableIncome: sql<string>`COALESCE(SUM(${payrollRunLinesTable.taxableIncome}), 0)::text`,
      payeAmount: sql<string>`COALESCE(SUM(${payrollRunLinesTable.payeAmount}), 0)::text`,
      pensionableEarnings: sql<string>`COALESCE(SUM(${payrollRunLinesTable.pensionableEarnings}), 0)::text`,
      employeePensionDeduction: sql<string>`COALESCE(SUM(${payrollRunLinesTable.employeePensionDeduction}), 0)::text`,
      employerPensionContribution: sql<string>`COALESCE(SUM(${payrollRunLinesTable.employerPensionContribution}), 0)::text`,
    })
    .from(payrollRunLinesTable)
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payrollRunLinesTable.payrollRunId))
    .innerJoin(payrollPeriodsTable, eq(payrollPeriodsTable.id, payrollRunsTable.payrollPeriodId))
    .where(
      and(
        eq(payrollRunLinesTable.organizationId, organizationId),
        eq(payrollRunLinesTable.employeeId, employeeId),
        eq(payrollRunsTable.status, "locked"),
        gte(payrollPeriodsTable.startDate, yearStart),
        lt(payrollPeriodsTable.startDate, yearEnd),
      ),
    );

  const inSystem: OpeningBalanceAmounts = {
    grossEarnings: Number(summed?.grossEarnings ?? 0).toFixed(2),
    taxableIncome: Number(summed?.taxableIncome ?? 0).toFixed(2),
    payeAmount: Number(summed?.payeAmount ?? 0).toFixed(2),
    pensionableEarnings: Number(summed?.pensionableEarnings ?? 0).toFixed(2),
    employeePensionDeduction: Number(summed?.employeePensionDeduction ?? 0).toFixed(2),
    employerPensionContribution: Number(summed?.employerPensionContribution ?? 0).toFixed(2),
  };

  const broughtForward: OpeningBalanceAmounts | null = opening
    ? {
        grossEarnings: opening.grossEarnings,
        taxableIncome: opening.taxableIncome,
        payeAmount: opening.payeAmount,
        pensionableEarnings: opening.pensionableEarnings,
        employeePensionDeduction: opening.employeePensionDeduction,
        employerPensionContribution: opening.employerPensionContribution,
      }
    : null;

  return { taxYear, broughtForward, inSystem, ...addAmounts(broughtForward ?? ZERO_AMOUNTS, inSystem) };
}
