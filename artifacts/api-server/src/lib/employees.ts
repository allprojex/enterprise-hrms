import { and, eq, ilike, or, count, desc, type SQL } from "drizzle-orm";
import { db, employeesTable, departmentsTable, branchesTable, positionsTable } from "@workspace/db";
import { assertBelongsToOrganization } from "./orgScopedRefs";

/**
 * Every FK an employee record can point at (department, branch, position,
 * reporting manager) must be independently verified to belong to the same
 * organization — the raw foreign key alone doesn't enforce that, and a
 * mismatched reference would leak another organization's structure.
 */
export async function assertEmployeeReferencesValid(
  organizationId: number,
  refs: {
    departmentId?: number | null;
    branchId?: number | null;
    positionId?: number | null;
    reportingManagerId?: number | null;
  },
): Promise<void> {
  await assertBelongsToOrganization(departmentsTable, refs.departmentId, organizationId, "Department");
  await assertBelongsToOrganization(branchesTable, refs.branchId, organizationId, "Branch");
  await assertBelongsToOrganization(positionsTable, refs.positionId, organizationId, "Position");
  await assertBelongsToOrganization(employeesTable, refs.reportingManagerId, organizationId, "Reporting manager");
}

/**
 * Simple org-scoped sequential numbering (EMP-0001, EMP-0002, ...) based on
 * how many employees the org already has. Safe against duplicates because
 * of the (organizationId, employeeNumber) unique constraint — a race
 * between two simultaneous creations would surface as a 409, not silent
 * corruption — but isn't retried automatically; see known limitations.
 */
export async function generateEmployeeNumber(organizationId: number): Promise<string> {
  const [row] = await db
    .select({ value: count() })
    .from(employeesTable)
    .where(eq(employeesTable.organizationId, organizationId));
  const sequence = (row?.value ?? 0) + 1;
  return `EMP-${String(sequence).padStart(4, "0")}`;
}

export interface ListEmployeesParams {
  organizationId: number;
  search?: string;
  departmentId?: number;
  branchId?: number;
  positionId?: number;
  employmentStatus?: string;
  page: number;
  pageSize: number;
}

export async function listEmployees(params: ListEmployeesParams) {
  const conditions: SQL[] = [eq(employeesTable.organizationId, params.organizationId)];
  if (params.departmentId != null) conditions.push(eq(employeesTable.departmentId, params.departmentId));
  if (params.branchId != null) conditions.push(eq(employeesTable.branchId, params.branchId));
  if (params.positionId != null) conditions.push(eq(employeesTable.positionId, params.positionId));
  if (params.employmentStatus) {
    conditions.push(eq(employeesTable.employmentStatus, params.employmentStatus as never));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(
      ilike(employeesTable.firstName, term),
      ilike(employeesTable.lastName, term),
      ilike(employeesTable.preferredName, term),
      ilike(employeesTable.employeeNumber, term),
      ilike(employeesTable.workEmail, term),
      ilike(employeesTable.personalEmail, term),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(employeesTable).where(where);
  const total = totalRow?.value ?? 0;

  const items = await db
    .select()
    .from(employeesTable)
    .where(where)
    .orderBy(desc(employeesTable.createdAt))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  return { items, total };
}

export async function getEmployeeById(organizationId: number, employeeId: number) {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}
