import { and, eq, ilike, or, count, desc, type SQL } from "drizzle-orm";
import {
  db,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  performanceReviewsTable,
  performanceCyclesTable,
  type Employee,
} from "@workspace/db";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";
import { recordEmploymentPeriodEvent } from "./employmentLifecycleService";
import {
  allocateGeneratedEmployeeNumber,
  allocateManualEmployeeNumber,
  auditEmployeeNumberAllocated,
} from "./numbering";

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

export class InvalidProbationReviewReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProbationReviewReferenceError";
  }
}

export class EmployeeNotOnProbationError extends Error {
  constructor() {
    super("Employee is not currently on probation");
    this.name = "EmployeeNotOnProbationError";
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
  /**
   * Optional transaction client, defaulting to the global `db` so every
   * pre-existing caller is unchanged. A caller creating structure and
   * employees in ONE transaction (WS-7 atomic migration) passes its `tx`,
   * so these checks see the department/branch/position that transaction has
   * just created but not yet committed.
   */
  client: QueryClient = db,
): Promise<void> {
  await assertBelongsToOrganization(departmentsTable, refs.departmentId, organizationId, "Department", client);
  await assertBelongsToOrganization(branchesTable, refs.branchId, organizationId, "Branch", client);
  await assertBelongsToOrganization(positionsTable, refs.positionId, organizationId, "Position", client);
  await assertBelongsToOrganization(employeesTable, refs.reportingManagerId, organizationId, "Reporting manager", client);
}

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx` — lets employee creation run inside a caller's own
// transaction (e.g. employeeConversion.ts's convert-to-employee) without a
// second query-client type, the same pattern established by
// leaveBalances.ts/requisitionApprovals.ts/offers.ts.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface EmployeeCreateFields {
  firstName: string;
  lastName: string;
  middleName?: string | null;
  preferredName?: string | null;
  gender?: Employee["gender"];
  dateOfBirth?: Date | null;
  maritalStatus?: Employee["maritalStatus"];
  nationality?: string | null;
  nationalId?: string | null;
  passportNumber?: string | null;
  personalEmail?: string | null;
  workEmail?: string | null;
  phoneNumber?: string | null;
  alternatePhoneNumber?: string | null;
  residentialAddress?: unknown;
  emergencyContacts?: unknown;
  departmentId?: number | null;
  branchId?: number | null;
  positionId?: number | null;
  reportingManagerId?: number | null;
  employmentType?: Employee["employmentType"];
  hireDate?: Date | null;
  probationEndDate?: Date | null;
  workLocation?: string | null;
  notes?: string | null;
  employeeNumber?: string | null;
}

/**
 * The single authoritative employee-creation pathway — the exact logic
 * `POST /organizations/:id/employees` has always used (extracted from
 * routes/employees.ts, not reimplemented), now also reused by
 * employeeConversion.ts's convert-to-employee (Phase 3A, W59) so that
 * exactly one code path ever inserts into `employees`. Accepts a
 * `QueryClient` so a caller (like convert-to-employee) can run this inside
 * its own transaction; the existing HTTP route continues to call it with
 * the plain `db`.
 *
 * Phase 3H, W114: the row insert and the staff-number allocation
 * (lib/numbering.ts) now happen inside one transaction (a savepoint when
 * `client` is already a transaction) — an allocation failure (e.g. a
 * manually-supplied number colliding with an active allocation) rolls back
 * the employee insert too, rather than leaving behind a numberless orphan
 * row. `fields.employeeNumber`, if supplied, is a manual override routed
 * through allocateManualEmployeeNumber (which itself decides, from
 * allocation history, whether this is a fresh assignment or a deliberate
 * reuse); otherwise a number is engine-generated. Never written to the
 * `employees` row directly — createEmployee is the only place besides
 * lib/numbering.ts itself that touches employeeNumber at all.
 */
export async function createEmployee(
  client: QueryClient,
  params: {
    organizationId: number;
    fields: EmployeeCreateFields;
    actorApplicationUserId: number;
    actorMembershipId: number | null;
  },
): Promise<Employee> {
  await assertEmployeeReferencesValid(params.organizationId, params.fields);

  const { employeeNumber: manualEmployeeNumber, ...fieldsWithoutNumber } = params.fields;

  const { employee, allocation } = await client.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(employeesTable)
      .values({
        ...fieldsWithoutNumber,
        employeeNumber: null,
        organizationId: params.organizationId,
        createdBy: params.actorApplicationUserId,
        updatedBy: params.actorApplicationUserId,
      })
      .returning();

    const result = manualEmployeeNumber
      ? await allocateManualEmployeeNumber(tx, {
          organizationId: params.organizationId,
          employeeId: inserted.id,
          employeeNumber: manualEmployeeNumber,
          actorMembershipId: params.actorMembershipId,
        })
      : await allocateGeneratedEmployeeNumber(tx, {
          organizationId: params.organizationId,
          employeeId: inserted.id,
          actorMembershipId: params.actorMembershipId,
        });

    return result;
  });

  await auditEmployeeNumberAllocated({
    organizationId: params.organizationId,
    employeeId: employee.id,
    allocation,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return employee;
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
    // WS-11 (§27.3) — this audit event is UNCHANGED and is not weakened. The
    // lifecycle-history event appended below is additional, not a replacement.
    eventType: "employee.separated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { employmentStatus: before.employmentStatus, separationDate: before.separationDate, separationReason: before.separationReason },
    afterState: { employmentStatus: updated.employmentStatus, separationDate: updated.separationDate, separationReason: updated.separationReason },
  });

  // WS-11 (§27.3) — close the lifecycle-history gap, FORWARD ONLY. Separation
  // previously produced an audit event but no `employment_periods` row, so the
  // Employment History surface omitted it. New separations now append one.
  // Nothing backfills the past: an employee already terminated without an event
  // keeps that honest absence rather than gaining an invented date.
  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "separation",
    effectiveDate: params.separationDate,
    previousState: { employmentStatus: before.employmentStatus },
    newState: {
      employmentStatus: updated.employmentStatus,
      separationDate: updated.separationDate,
      ...(updated.separationReason ? { separationReason: updated.separationReason } : {}),
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
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
    // WS-11 (§27.3) — unchanged and not weakened; the lifecycle event below is
    // additional.
    eventType: "employee.rehired",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { employmentStatus: before.employmentStatus, separationDate: before.separationDate, separationReason: before.separationReason },
    afterState: { employmentStatus: updated.employmentStatus },
  });

  // WS-11 (§27.3). The rehire keeps the SAME employees.id and the same history —
  // the prior separation event stays exactly where it is, and this appends the
  // return beside it. `effectiveDate` is the rehire instant because no earlier
  // date is known; inventing one would be the fabrication §27.3 forbids.
  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "rehire",
    effectiveDate: new Date(),
    previousState: {
      employmentStatus: before.employmentStatus,
      separationDate: before.separationDate,
      separationReason: before.separationReason,
    },
    newState: { employmentStatus: updated.employmentStatus },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
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

/**
 * Confirmation (Phase 2A, W27): formalizes the existing
 * employmentStatus "probation" -> "active" transition (the field and enum
 * value already exist on `employees`, W1) into an audited, permission-gated,
 * dated action — mirroring separateEmployee/rehireEmployee's shape. History
 * preserved via W22's `employment_periods`, never overwritten.
 *
 * Phase 3H, W117 (frozen plan Decision 13): an optional `probationReviewId`
 * — when supplied, must reference a real performance_reviews row belonging
 * to this employee and to a `cycleType = 'probation'` cycle in this
 * organization; recorded directly inside this same confirmation event's own
 * `newState` (`employment_periods.newState` is free-form jsonb, already the
 * established per-event-type mechanism — zero schema change). Review
 * completion never auto-confirms — this remains the one, single authoritative
 * confirmation action; HR decides whether and when to call it.
 */
export async function confirmEmployee(params: {
  organizationId: number;
  employeeId: number;
  effectiveDate: Date;
  probationReviewId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const before = await getEmployeeById(params.organizationId, params.employeeId);
  if (!before) throw new EmployeeNotFoundError();
  if (before.employmentStatus !== "probation") throw new EmployeeNotOnProbationError();

  if (params.probationReviewId != null) {
    const [review] = await db
      .select({ employeeId: performanceReviewsTable.employeeId, cycleType: performanceCyclesTable.cycleType })
      .from(performanceReviewsTable)
      .innerJoin(performanceCyclesTable, eq(performanceReviewsTable.cycleId, performanceCyclesTable.id))
      .where(and(eq(performanceReviewsTable.id, params.probationReviewId), eq(performanceReviewsTable.organizationId, params.organizationId)))
      .limit(1);
    if (!review) throw new InvalidProbationReviewReferenceError("Referenced performance review not found in this organization");
    if (review.employeeId !== params.employeeId) {
      throw new InvalidProbationReviewReferenceError("Referenced performance review does not belong to this employee");
    }
    if (review.cycleType !== "probation") {
      throw new InvalidProbationReviewReferenceError("Referenced performance review is not part of a probation cycle");
    }
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ employmentStatus: "active", updatedBy: params.actorApplicationUserId })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "confirmation",
    effectiveDate: params.effectiveDate,
    previousState: { employmentStatus: before.employmentStatus },
    newState:
      params.probationReviewId != null
        ? { employmentStatus: updated.employmentStatus, probationReviewId: params.probationReviewId }
        : { employmentStatus: updated.employmentStatus },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return updated;
}
