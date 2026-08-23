/**
 * Payroll, Workstream 2 — Banking & Statutory Identifiers
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8). Two structurally identical
 * "at most one open record per employee" tables, both highly sensitive and
 * both read-audited (frozen plan Decision 9) — the audit call itself lives
 * in the route layer (routes/payrollSensitiveRecords.ts), since it is a
 * concern of what was actually returned to a caller, not of the data-access
 * function in isolation.
 */
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  masterDataItemsTable,
  type EmployeeBankingDetail,
  type EmployeeStatutoryIdentifier,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

export class UnknownBankError extends Error {
  constructor(code: string) {
    super(`"${code}" is not a known bank for this organization`);
  }
}
export class BankingDetailCollisionError extends Error {
  constructor() {
    super("Another open banking record already exists for this employee at an overlapping effective period");
  }
}
export class StatutoryIdentifierCollisionError extends Error {
  constructor() {
    super("Another open statutory-identifier record already exists for this employee at an overlapping effective period");
  }
}

async function assertBankKnown(organizationId: number, bankCode: string): Promise<void> {
  const [row] = await db
    .select()
    .from(masterDataItemsTable)
    .where(and(eq(masterDataItemsTable.domain, "payroll_bank"), eq(masterDataItemsTable.code, bankCode), eq(masterDataItemsTable.status, "active")));
  if (!row || (row.organizationId !== null && row.organizationId !== organizationId)) {
    throw new UnknownBankError(bankCode);
  }
}

export interface CreateBankingDetailParams {
  organizationId: number;
  employeeId: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  branch?: string | null;
  validFrom: Date;
  actorMembershipId: number;
}

export async function createBankingDetail(params: CreateBankingDetailParams): Promise<EmployeeBankingDetail> {
  await assertBankKnown(params.organizationId, params.bankCode);
  try {
    return await db.transaction(async (tx) => {
      const [openExisting] = await tx
        .select()
        .from(employeeBankingDetailsTable)
        .where(and(eq(employeeBankingDetailsTable.employeeId, params.employeeId), isNull(employeeBankingDetailsTable.validTo)))
        .for("update");

      if (openExisting) {
        if (openExisting.validFrom >= params.validFrom) throw new BankingDetailCollisionError();
        await tx.update(employeeBankingDetailsTable).set({ validTo: params.validFrom }).where(eq(employeeBankingDetailsTable.id, openExisting.id));
      }

      const [created] = await tx
        .insert(employeeBankingDetailsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          branch: params.branch ?? null,
          validFrom: params.validFrom,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new BankingDetailCollisionError();
    throw err;
  }
}

export async function getCurrentBankingDetail(organizationId: number, employeeId: number): Promise<EmployeeBankingDetail | null> {
  const [row] = await db
    .select()
    .from(employeeBankingDetailsTable)
    .where(and(eq(employeeBankingDetailsTable.organizationId, organizationId), eq(employeeBankingDetailsTable.employeeId, employeeId), isNull(employeeBankingDetailsTable.validTo)));
  return row ?? null;
}

export async function listBankingHistory(organizationId: number, employeeId: number): Promise<EmployeeBankingDetail[]> {
  return db
    .select()
    .from(employeeBankingDetailsTable)
    .where(and(eq(employeeBankingDetailsTable.organizationId, organizationId), eq(employeeBankingDetailsTable.employeeId, employeeId)))
    .orderBy(desc(employeeBankingDetailsTable.validFrom));
}

export interface CreateStatutoryIdentifierParams {
  organizationId: number;
  employeeId: number;
  ssnitNumber?: string | null;
  tin?: string | null;
  validFrom: Date;
  actorMembershipId: number;
}

export async function createStatutoryIdentifier(params: CreateStatutoryIdentifierParams): Promise<EmployeeStatutoryIdentifier> {
  try {
    return await db.transaction(async (tx) => {
      const [openExisting] = await tx
        .select()
        .from(employeeStatutoryIdentifiersTable)
        .where(and(eq(employeeStatutoryIdentifiersTable.employeeId, params.employeeId), isNull(employeeStatutoryIdentifiersTable.validTo)))
        .for("update");

      if (openExisting) {
        if (openExisting.validFrom >= params.validFrom) throw new StatutoryIdentifierCollisionError();
        await tx.update(employeeStatutoryIdentifiersTable).set({ validTo: params.validFrom }).where(eq(employeeStatutoryIdentifiersTable.id, openExisting.id));
      }

      const [created] = await tx
        .insert(employeeStatutoryIdentifiersTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          ssnitNumber: params.ssnitNumber ?? null,
          tin: params.tin ?? null,
          validFrom: params.validFrom,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new StatutoryIdentifierCollisionError();
    throw err;
  }
}

export async function getCurrentStatutoryIdentifier(organizationId: number, employeeId: number): Promise<EmployeeStatutoryIdentifier | null> {
  const [row] = await db
    .select()
    .from(employeeStatutoryIdentifiersTable)
    .where(and(eq(employeeStatutoryIdentifiersTable.organizationId, organizationId), eq(employeeStatutoryIdentifiersTable.employeeId, employeeId), isNull(employeeStatutoryIdentifiersTable.validTo)));
  return row ?? null;
}

export async function listStatutoryIdentifierHistory(organizationId: number, employeeId: number): Promise<EmployeeStatutoryIdentifier[]> {
  return db
    .select()
    .from(employeeStatutoryIdentifiersTable)
    .where(and(eq(employeeStatutoryIdentifiersTable.organizationId, organizationId), eq(employeeStatutoryIdentifiersTable.employeeId, employeeId)))
    .orderBy(desc(employeeStatutoryIdentifiersTable.validFrom));
}

/**
 * Payroll, Workstream 5 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §12) — batched
 * (never one query per employee, §35) as-of resolution for the pension/
 * SSNIT schedule. Mirrors resolveCompensationAsOf's/pickAllocationAsOf's own
 * proven half-open [validFrom, validTo) pattern exactly: this is historical
 * resolution against an immutable effective-dated history, never a "live
 * current value" — resolving at `asOfDate` (a locked run's own payDate)
 * always yields the same answer on every future read, since prior rows are
 * never edited in place, only superseded. Returns null per employeeId with
 * no identifier on file at that date.
 */
/**
 * Payroll, Frozen Workstream 8 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6) —
 * batched (never one query per employee, §35) resolution of each
 * employee's CURRENTLY-OPEN banking record, for payment-batch-creation-time
 * snapshotting. Deliberately "current", not "as of a historical date" —
 * banking is a payment-instruction detail resolved at the moment a batch is
 * prepared, never part of the payroll calculation itself, so there is no
 * historical payDate to resolve against here (contrast
 * resolveStatutoryIdentifiersAsOf, which does have one). Returns no entry
 * for an employee with no open banking record on file.
 */
export async function resolveCurrentBankingDetailsBatch(organizationId: number, employeeIds: number[]): Promise<Map<number, EmployeeBankingDetail>> {
  const result = new Map<number, EmployeeBankingDetail>();
  if (employeeIds.length === 0) return result;

  const rows = await db
    .select()
    .from(employeeBankingDetailsTable)
    .where(
      and(
        eq(employeeBankingDetailsTable.organizationId, organizationId),
        inArray(employeeBankingDetailsTable.employeeId, employeeIds),
        isNull(employeeBankingDetailsTable.validTo),
      ),
    );
  for (const row of rows) result.set(row.employeeId, row);
  return result;
}

export async function resolveStatutoryIdentifiersAsOf(
  organizationId: number,
  employeeIds: number[],
  asOfDate: Date,
): Promise<Map<number, EmployeeStatutoryIdentifier | null>> {
  const result = new Map<number, EmployeeStatutoryIdentifier | null>();
  if (employeeIds.length === 0) return result;

  const rows = await db
    .select()
    .from(employeeStatutoryIdentifiersTable)
    .where(and(eq(employeeStatutoryIdentifiersTable.organizationId, organizationId), inArray(employeeStatutoryIdentifiersTable.employeeId, employeeIds)));

  const byEmployee = new Map<number, EmployeeStatutoryIdentifier[]>();
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }

  const at = asOfDate.getTime();
  for (const employeeId of employeeIds) {
    const history = byEmployee.get(employeeId) ?? [];
    const match = history.find((row) => {
      const from = row.validFrom.getTime();
      const to = row.validTo ? row.validTo.getTime() : Infinity;
      return at >= from && at < to;
    });
    result.set(employeeId, match ?? null);
  }
  return result;
}
