/**
 * Payroll, Workstream 3 — One-Off Payroll Inputs
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §13). The explicit,
 * attributable, period-specific bridge from a one-off entry into a payroll
 * calculation — never an implicit join against Attendance/Leave/any other
 * module (§M). `sourceType` is "manual" for every input created here;
 * mirrors employment_periods.eventType's own "free-text discriminator,
 * extensible without a schema change" precedent so a future workstream
 * could populate an approved event from elsewhere without a schema change,
 * without this workstream doing so itself. componentTypeCode is validated
 * against the same master-data catalogue W2 established for recurring
 * compensation. `approvedByMembershipId` on the underlying row stays null
 * throughout this workstream (resolved, Owner Review/W2 report) — the run's
 * own approval (Workstream 4) covers every input transitively.
 *
 * Workstream 4 lock-invariant hardening (§G/§O): once this period's run (if
 * any) has passed "calculated" (i.e. is "approved" or "locked"), no input
 * may be added, deleted, or replaced — enforced here via
 * `lockRunForPeriodIfExists`, which row-locks the run (if one exists) for
 * the lifetime of this same transaction, so a concurrent lock() call and a
 * concurrent input mutation serialize correctly against each other.
 */
import { and, eq } from "drizzle-orm";
import { db, payrollInputReferencesTable, payrollPeriodsTable, type PayrollInputReference } from "@workspace/db";
import { assertComponentTypeKnown, UnknownComponentTypeError } from "./payrollCompensation";
import { lockRunForPeriodIfExists, PayrollRunNotEditableError } from "./payrollRuns";

export { UnknownComponentTypeError, PayrollRunNotEditableError };

export class PayrollInputReferencePeriodNotFoundError extends Error {
  constructor() {
    super("Payroll period not found");
  }
}
export class PayrollInputReferenceNotFoundError extends Error {
  constructor() {
    super("Payroll input reference not found");
  }
}

export interface CreatePayrollInputReferenceParams {
  organizationId: number;
  payrollPeriodId: number;
  employeeId: number;
  category: "earning" | "deduction";
  componentTypeCode: string;
  amount: string;
  currency: string;
  taxableTreatment?: "ordinary" | "benefit_in_kind" | "bonus" | "overtime";
  description?: string | null;
  actorMembershipId: number;
}

export async function createPayrollInputReference(
  params: CreatePayrollInputReferenceParams,
): Promise<PayrollInputReference> {
  await assertComponentTypeKnown(params.organizationId, params.category, params.componentTypeCode);

  return db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(payrollPeriodsTable)
      .where(and(eq(payrollPeriodsTable.id, params.payrollPeriodId), eq(payrollPeriodsTable.organizationId, params.organizationId)));
    if (!period) throw new PayrollInputReferencePeriodNotFoundError();

    const run = await lockRunForPeriodIfExists(tx, params.organizationId, params.payrollPeriodId);
    if (run && (run.status === "approved" || run.status === "locked")) throw new PayrollRunNotEditableError(run.status);

    const [created] = await tx
      .insert(payrollInputReferencesTable)
      .values({
        organizationId: params.organizationId,
        payrollPeriodId: params.payrollPeriodId,
        employeeId: params.employeeId,
        sourceType: "manual",
        sourceId: null,
        category: params.category,
        componentTypeCode: params.componentTypeCode,
        amount: params.amount,
        currency: params.currency,
        taxableTreatment: params.taxableTreatment ?? "ordinary",
        description: params.description ?? null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    return created;
  });
}

export async function listPayrollInputReferences(
  organizationId: number,
  payrollPeriodId: number,
  employeeId?: number,
): Promise<PayrollInputReference[]> {
  const conditions = [
    eq(payrollInputReferencesTable.organizationId, organizationId),
    eq(payrollInputReferencesTable.payrollPeriodId, payrollPeriodId),
  ];
  if (employeeId !== undefined) conditions.push(eq(payrollInputReferencesTable.employeeId, employeeId));
  return db
    .select()
    .from(payrollInputReferencesTable)
    .where(and(...conditions));
}

export async function deletePayrollInputReference(organizationId: number, id: number): Promise<PayrollInputReference> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(payrollInputReferencesTable)
      .where(and(eq(payrollInputReferencesTable.id, id), eq(payrollInputReferencesTable.organizationId, organizationId)));
    if (!row) throw new PayrollInputReferenceNotFoundError();

    const run = await lockRunForPeriodIfExists(tx, organizationId, row.payrollPeriodId);
    if (run && (run.status === "approved" || run.status === "locked")) throw new PayrollRunNotEditableError(run.status);

    await tx.delete(payrollInputReferencesTable).where(eq(payrollInputReferencesTable.id, id));
    return row;
  });
}
