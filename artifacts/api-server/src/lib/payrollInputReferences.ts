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
 * own future approval (Workstream 4) covers every input transitively.
 */
import { and, eq } from "drizzle-orm";
import { db, payrollInputReferencesTable, payrollPeriodsTable, type PayrollInputReference } from "@workspace/db";
import { assertComponentTypeKnown, UnknownComponentTypeError } from "./payrollCompensation";

export { UnknownComponentTypeError };

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
  const [period] = await db
    .select()
    .from(payrollPeriodsTable)
    .where(and(eq(payrollPeriodsTable.id, params.payrollPeriodId), eq(payrollPeriodsTable.organizationId, params.organizationId)));
  if (!period) throw new PayrollInputReferencePeriodNotFoundError();

  await assertComponentTypeKnown(params.organizationId, params.category, params.componentTypeCode);

  const [created] = await db
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
  const [row] = await db
    .select()
    .from(payrollInputReferencesTable)
    .where(and(eq(payrollInputReferencesTable.id, id), eq(payrollInputReferencesTable.organizationId, organizationId)));
  if (!row) throw new PayrollInputReferenceNotFoundError();

  await db.delete(payrollInputReferencesTable).where(eq(payrollInputReferencesTable.id, id));
  return row;
}
