import { and, eq, ilike, or, count, desc, type SQL } from "drizzle-orm";
import { db, employeesTable, departmentsTable, branchesTable, positionsTable } from "@workspace/db";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";
import { recordEmploymentPeriodEvent } from "./employmentLifecycleService";

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found");
    this.name = "EmployeeNotFoundError";
  }
}

export class EmployeeAlreadySeparatedError extends Error {
  constructor() {
    super("Employee is already separated");
    this.name = "EmployeeAlreadySeparatedError";
  }
}

export class EmployeeNotSeparatedError extends Error {
  constructor() {
    super("Employee is not currently separated");
    this.name = "EmployeeNotSeparatedError";
  }
}

export class EmployeeTransferNoChangeError extends Error {
  constructor() {
    super("Transfer must change at least one of department, branch, or position");
    this.name = "EmployeeTransferNoChangeError";
  }
}

export class EmployeePromotionNoChangeError extends Error {
  constructor() {
    super("Promotion must change the employee's position");
    this.name = "EmployeePromotionNoChangeError";
  }
}

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

/**
 * Separation (W15, ADR-013): the employee record is never deleted, only
 * marked terminated with a date/reason. Rehiring later starts a new
 * employment period on the same record — the prior separation's details
 * are preserved in the audit event's beforeState, not overwritten in place.
 */
export async function separateEmployee(params: {
  organizationId: number;
  employeeId: number;
  separationDate: Date;
  separationReason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const before = await getEmployeeById(params.organizationId, params.employeeId);
  if (!before) throw new EmployeeNotFoundError();
  if (before.employmentStatus === "terminated") throw new EmployeeAlreadySeparatedError();

  const [updated] = await db
    .update(employeesTable)
    .set({
      employmentStatus: "terminated",
      separationDate: params.separationDate,
      separationReason: params.separationReason ?? null,
      updatedBy: params.actorApplicationUserId,
    })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee.separated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { employmentStatus: before.employmentStatus, separationDate: before.separationDate, separationReason: before.separationReason },
    afterState: { employmentStatus: updated.employmentStatus, separationDate: updated.separationDate, separationReason: updated.separationReason },
  });

  return updated;
}

/** Rehire: starts a new employment period on the same record. Clears the prior separation fields — their values remain in the audit trail. */
export async function rehireEmployee(params: {
  organizationId: number;
  employeeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const before = await getEmployeeById(params.organizationId, params.employeeId);
  if (!before) throw new EmployeeNotFoundError();
  if (before.employmentStatus !== "terminated") throw new EmployeeNotSeparatedError();

  const [updated] = await db
    .update(employeesTable)
    .set({
      employmentStatus: "active",
      separationDate: null,
      separationReason: null,
      updatedBy: params.actorApplicationUserId,
    })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee.rehired",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { employmentStatus: before.employmentStatus, separationDate: before.separationDate, separationReason: before.separationReason },
    afterState: { employmentStatus: updated.employmentStatus },
  });

  return updated;
}

/**
 * Transfer (Phase 2A, W25): department/branch/position reassignment.
 * Cross-org reference validation reuses assertEmployeeReferencesValid — the
 * same validation create/update already runs, not a duplicate check
 * (Architecture Decision 3, ADR-012). Unlike separate/rehire, this doesn't
 * change employmentStatus; `employees` always holds the *current* placement,
 * while the dated before/after history is preserved in `employment_periods`
 * (W22's EmploymentLifecycleService) — never overwritten, mirroring how
 * separation preserves prior values in the audit trail instead of on the row.
 */
export async function transferEmployee(params: {
  organizationId: number;
  employeeId: number;
  departmentId?: number | null;
  branchId?: number | null;
  positionId?: number | null;
  effectiveDate: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const before = await getEmployeeById(params.organizationId, params.employeeId);
  if (!before) throw new EmployeeNotFoundError();

  const nextDepartmentId = params.departmentId !== undefined ? params.departmentId : before.departmentId;
  const nextBranchId = params.branchId !== undefined ? params.branchId : before.branchId;
  const nextPositionId = params.positionId !== undefined ? params.positionId : before.positionId;

  if (nextDepartmentId === before.departmentId && nextBranchId === before.branchId && nextPositionId === before.positionId) {
    throw new EmployeeTransferNoChangeError();
  }

  await assertEmployeeReferencesValid(params.organizationId, {
    departmentId: nextDepartmentId,
    branchId: nextBranchId,
    positionId: nextPositionId,
  });

  const [updated] = await db
    .update(employeesTable)
    .set({
      departmentId: nextDepartmentId,
      branchId: nextBranchId,
      positionId: nextPositionId,
      updatedBy: params.actorApplicationUserId,
    })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "transfer",
    effectiveDate: params.effectiveDate,
    previousState: { departmentId: before.departmentId, branchId: before.branchId, positionId: before.positionId },
    newState: { departmentId: updated.departmentId, branchId: updated.branchId, positionId: updated.positionId },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return updated;
}

/**
 * Promotion (Phase 2A, W26): position/title change with an effective date.
 * No compensation/salary concept exists anywhere in this schema — out of
 * scope, per the frozen plan. Only touches `positionId`, unlike Transfer
 * (W25), which can also move department/branch — a promotion is specifically
 * a position change. Cross-org reference validation reuses
 * assertEmployeeReferencesValid, same as Transfer, not duplicated. History
 * preserved via W22's `employment_periods`, never overwritten.
 */
export async function promoteEmployee(params: {
  organizationId: number;
  employeeId: number;
  positionId: number;
  effectiveDate: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const before = await getEmployeeById(params.organizationId, params.employeeId);
  if (!before) throw new EmployeeNotFoundError();
  if (before.positionId === params.positionId) throw new EmployeePromotionNoChangeError();

  await assertEmployeeReferencesValid(params.organizationId, { positionId: params.positionId });

  const [updated] = await db
    .update(employeesTable)
    .set({ positionId: params.positionId, updatedBy: params.actorApplicationUserId })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "promotion",
    effectiveDate: params.effectiveDate,
    previousState: { positionId: before.positionId },
    newState: { positionId: updated.positionId },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return updated;
}
