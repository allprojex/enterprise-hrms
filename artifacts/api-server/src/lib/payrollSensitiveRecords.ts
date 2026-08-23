/**
 * Payroll, Workstream 2 — Banking & Statutory Identifiers
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8). Two structurally identical
 * "at most one open record per employee" tables, both highly sensitive and
 * both read-audited (frozen plan Decision 9) — the audit call itself lives
 * in the route layer (routes/payrollSensitiveRecords.ts), since it is a
 * concern of what was actually returned to a caller, not of the data-access
 * function in isolation.
 */
import { and, eq, isNull, desc } from "drizzle-orm";
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
