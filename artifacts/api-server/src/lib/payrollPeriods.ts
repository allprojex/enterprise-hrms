/**
 * Payroll, Workstream 3 — Payroll Periods
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.3, §13). Org-scoped calendar
 * definition, explicit dates, stable identity. Duplicate/overlapping
 * periods for one (organization, frequency) are prevented two ways: a
 * `pg_advisory_xact_lock` keyed by organizationId serializes concurrent
 * creation attempts for the same organization for the lifetime of the
 * transaction (no existing codebase precedent for advisory locks — a new,
 * standard technique introduced here because periodKey alone only catches
 * an exact-cycle duplicate, not a genuine date-range overlap across
 * differently-keyed rows), and the unique index on
 * (organizationId, frequency, periodKey) is the final database-level
 * backstop.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, payrollPeriodsTable, type PayrollPeriod } from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

export type PayrollPeriodFrequency = "monthly" | "bi_weekly" | "weekly";

export class PayrollPeriodCollisionError extends Error {
  constructor() {
    super("A payroll period already exists for this organization/frequency covering an overlapping date range");
  }
}
export class PayrollPeriodNotFoundError extends Error {
  constructor() {
    super("Payroll period not found");
  }
}
export class InvalidPayrollPeriodDatesError extends Error {}

/**
 * Stable dedup key for (organization, frequency, cycle) — NOT a
 * human-facing calendar label (startDate/endDate/payDate are the actual
 * displayed dates). Monthly uses "YYYY-MM"; weekly/bi-weekly use a
 * deterministic whole-weeks-since-epoch counter, which needs no calendar
 * convention to stay stable and collision-free.
 */
export function computePayrollPeriodKey(frequency: PayrollPeriodFrequency, startDate: Date): string {
  if (frequency === "monthly") {
    const year = startDate.getUTCFullYear();
    const month = String(startDate.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }
  const daysSinceEpoch = Math.floor(startDate.getTime() / 86_400_000);
  const weekNumber = Math.floor(daysSinceEpoch / 7);
  const prefix = frequency === "weekly" ? "W" : "BW";
  return `${prefix}${weekNumber}`;
}

export interface CreatePayrollPeriodParams {
  organizationId: number;
  frequency: PayrollPeriodFrequency;
  startDate: Date;
  endDate: Date;
  payDate: Date;
  actorMembershipId: number;
}

export async function createPayrollPeriod(params: CreatePayrollPeriodParams): Promise<PayrollPeriod> {
  if (params.endDate <= params.startDate) {
    throw new InvalidPayrollPeriodDatesError("endDate must be after startDate");
  }
  if (params.payDate < params.startDate) {
    throw new InvalidPayrollPeriodDatesError("payDate must not be before startDate");
  }

  const periodKey = computePayrollPeriodKey(params.frequency, params.startDate);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${params.organizationId})`);

      const existing = await tx
        .select()
        .from(payrollPeriodsTable)
        .where(
          and(eq(payrollPeriodsTable.organizationId, params.organizationId), eq(payrollPeriodsTable.frequency, params.frequency)),
        );
      const overlaps = existing.some((row) => params.startDate < row.endDate && params.endDate > row.startDate);
      if (overlaps) throw new PayrollPeriodCollisionError();

      const [created] = await tx
        .insert(payrollPeriodsTable)
        .values({
          organizationId: params.organizationId,
          frequency: params.frequency,
          periodKey,
          startDate: params.startDate,
          endDate: params.endDate,
          payDate: params.payDate,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new PayrollPeriodCollisionError();
    throw err;
  }
}

export async function listPayrollPeriods(organizationId: number): Promise<PayrollPeriod[]> {
  return db
    .select()
    .from(payrollPeriodsTable)
    .where(eq(payrollPeriodsTable.organizationId, organizationId))
    .orderBy(payrollPeriodsTable.startDate);
}

export async function getPayrollPeriod(organizationId: number, id: number): Promise<PayrollPeriod> {
  const [row] = await db
    .select()
    .from(payrollPeriodsTable)
    .where(and(eq(payrollPeriodsTable.id, id), eq(payrollPeriodsTable.organizationId, organizationId)));
  if (!row) throw new PayrollPeriodNotFoundError();
  return row;
}
