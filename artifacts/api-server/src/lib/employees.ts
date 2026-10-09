import { and, eq, ne, ilike, or, count, desc, sql, type SQL } from "drizzle-orm";
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
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";
import { recordEmploymentPeriodEvent } from "./employmentLifecycleService";
import {
  allocateGeneratedEmployeeNumber,
  allocateManualEmployeeNumber,
  auditEmployeeNumberAllocated,
} from "./numbering";
import {
  assertEmployeeWriteAuthorized,
  assertInitialStatusAllowed,
  assertStatusChangeAllowedViaUpdate,
  summarizeEmployeeChanges,
  summarizeEmployeeCreation,
  validateEmployeeFieldFormats,
  validateEmployeeDateConsistency,
  sameValue,
  type EmployeeWriteAuthorization,
} from "./employeeRecordPolicy";
import { assertNotSelfAdministration } from "./employeeSelfAdministration";

export class EmployeeSelfManagerError extends Error {
  constructor() {
    super("An employee cannot be their own reporting manager");
    this.name = "EmployeeSelfManagerError";
  }
}

export class EmployeeReportingCycleError extends Error {
  constructor() {
    super("This reporting manager would create a circular reporting line");
    this.name = "EmployeeReportingCycleError";
  }
}

export class EmployeeManagerIneligibleError extends Error {
  constructor(message = "The selected reporting manager is separated and cannot be assigned") {
    super(message);
    this.name = "EmployeeManagerIneligibleError";
  }
}

export class DuplicateEmployeeIdentifierError extends Error {
  readonly field: "nationalId" | "passportNumber";
  constructor(field: "nationalId" | "passportNumber") {
    super(
      field === "nationalId"
        ? "This national identification number is already recorded for another employee in this organization"
        : "This passport number is already recorded for another employee in this organization",
    );
    this.name = "DuplicateEmployeeIdentifierError";
    this.field = field;
  }
}

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

/**
 * Reporting-line integrity (Phase 1 hardening, 2026-10-08). The reporting
 * manager is the one employee-to-employee reference a client can set, so it
 * carries every check a bad value could need:
 *
 *   - same organization (assertEmployeeReferencesValid, unchanged);
 *   - not the employee themself;
 *   - not a separated employee — a terminated record cannot be anyone's
 *     current manager; existing reports of a newly separated manager are
 *     left as they are (reassignment is HR's decision, not a side effect);
 *   - no cycle of ANY length: walking up from the proposed manager must never
 *     reach the employee being updated. The walk is a single recursive CTE
 *     bounded to the organization and to a generous depth, so a pathological
 *     chain can neither escape the tenant nor loop forever.
 *
 * The cycle walk is only as good as its snapshot, so updateEmployee runs it
 * under a per-organization transaction-scoped advisory lock (see
 * REPORTING_LINE_LOCK_KEY): two concurrent updates that would each pass a
 * stale check (A→B while B→A) are serialized, and the second sees the first.
 */
const REPORTING_LINE_MAX_DEPTH = 1000;
const REPORTING_LINE_LOCK_KEY = "employee-reporting-line";

export async function assertReportingManagerEligible(
  client: QueryClient,
  params: { organizationId: number; employeeId: number | null; reportingManagerId: number | null | undefined },
): Promise<void> {
  const managerId = params.reportingManagerId;
  if (managerId == null) return;
  if (params.employeeId != null && managerId === params.employeeId) throw new EmployeeSelfManagerError();

  const [manager] = await client
    .select({ organizationId: employeesTable.organizationId, employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(eq(employeesTable.id, managerId))
    .limit(1);
  // Same message as every other foreign/nonexistent reference: a missing row
  // and another tenant's row are indistinguishable to the caller by design.
  if (!manager || manager.organizationId !== params.organizationId) throw new CrossOrganizationReferenceError("Reporting manager");
  if (manager.employmentStatus === "terminated") throw new EmployeeManagerIneligibleError();

  if (params.employeeId == null) return; // a record that does not exist yet cannot be on anyone's chain
  const chain = await client.execute(sql`
    with recursive chain(id, manager_id, depth) as (
      select e.id, e.reporting_manager_id, 1
        from employees e
       where e.id = ${managerId} and e.organization_id = ${params.organizationId}
      union all
      select e.id, e.reporting_manager_id, c.depth + 1
        from employees e
        join chain c on e.id = c.manager_id
       where e.organization_id = ${params.organizationId}
         and c.depth < ${REPORTING_LINE_MAX_DEPTH}
         and c.manager_id is not null
    )
    select 1 as hit from chain where id = ${params.employeeId} or manager_id = ${params.employeeId} limit 1
  `);
  const rows = (chain as unknown as { rows?: unknown[] }).rows ?? (chain as unknown as unknown[]);
  if (Array.isArray(rows) && rows.length > 0) throw new EmployeeReportingCycleError();
}

/**
 * National ID and passport number are unique per organization when present.
 * Checked in the application (not a unique index) so that existing records —
 * including any historical duplicates already in Production — are preserved
 * exactly as they are; only NEW writes are held to the rule. Comparison is
 * case-insensitive and ignores surrounding whitespace.
 */
export async function assertEmployeeIdentifiersUnique(
  client: QueryClient,
  params: {
    organizationId: number;
    excludeEmployeeId: number | null;
    nationalId?: string | null;
    passportNumber?: string | null;
  },
): Promise<void> {
  for (const field of ["nationalId", "passportNumber"] as const) {
    const raw = params[field];
    if (raw == null || raw.trim() === "") continue;
    const column = field === "nationalId" ? employeesTable.nationalId : employeesTable.passportNumber;
    const conditions: SQL[] = [
      eq(employeesTable.organizationId, params.organizationId),
      sql`lower(trim(${column})) = lower(trim(${raw}))`,
    ];
    if (params.excludeEmployeeId != null) conditions.push(ne(employeesTable.id, params.excludeEmployeeId));
    const [dup] = await client.select({ id: employeesTable.id }).from(employeesTable).where(and(...conditions)).limit(1);
    // The `ne` predicate already excludes the record itself; the id check is a
    // belt-and-braces guard so the rule can never flag an employee against
    // their own current value.
    if (dup && dup.id !== params.excludeEmployeeId) throw new DuplicateEmployeeIdentifierError(field);
  }
}

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
    fields: EmployeeCreateFields & { employmentStatus?: Employee["employmentStatus"] };
    actorApplicationUserId: number;
    actorMembershipId: number | null;
    /**
     * Phase 1 hardening (2026-10-08, tightened in the final security review).
     * What the ACTOR may write, resolved by the caller from the membership's
     * effective permissions. REQUIRED for every caller — there is no trusted
     * bypass: the HTTP route passes the caller's own grants, and candidate
     * conversion passes the converting actor's grants after dropping the
     * sensitive candidate fields that actor may not write (see
     * employeeConversion.ts). Reading a candidate never implies the right to
     * write sensitive employee data.
     */
    authorization: EmployeeWriteAuthorization;
  },
): Promise<Employee> {
  assertEmployeeWriteAuthorized(params.fields as unknown as Record<string, unknown>, params.authorization);
  assertInitialStatusAllowed(params.fields.employmentStatus);
  validateEmployeeFieldFormats(params.fields);
  validateEmployeeDateConsistency(params.fields);
  await assertEmployeeReferencesValid(params.organizationId, params.fields, client);
  await assertReportingManagerEligible(client, {
    organizationId: params.organizationId,
    employeeId: null,
    reportingManagerId: params.fields.reportingManagerId,
  });
  await assertEmployeeIdentifiersUnique(client, {
    organizationId: params.organizationId,
    excludeEmployeeId: null,
    nationalId: params.fields.nationalId,
    passportNumber: params.fields.passportNumber,
  });

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

  // Phase 1 hardening: the record's creation is itself an audited HR event.
  // Field NAMES are recorded; sensitive VALUES only in masked form. Written
  // through `client` so a caller's enclosing transaction (candidate
  // conversion) takes the event down with it on rollback.
  const creation = summarizeEmployeeCreation({ ...fieldsWithoutNumber, employeeNumber: employee.employeeNumber });
  await recordAuditEvent(
    {
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee.created",
      targetType: "employee",
      targetId: String(employee.id),
      afterState: creation.afterState,
      metadata: { setFields: creation.setFields, employmentStatus: employee.employmentStatus },
    },
    client,
  );

  return employee;
}

/** Fields `updateEmployee` accepts — UpdateEmployeeBody's shape, with no employee number. */
export type EmployeeUpdateFields = Partial<Omit<EmployeeCreateFields, "employeeNumber">> & {
  employmentStatus?: Employee["employmentStatus"];
};

/**
 * The single authoritative generic-update pathway (Phase 1 hardening,
 * 2026-10-08; made atomic in the independent-review corrections, 2026-10-09)
 * — what `PATCH /organizations/:id/employees/:employeeId` runs.
 *
 * Everything that reasons about the record runs in ONE transaction against
 * the row locked `FOR UPDATE`, and every audit event is written through the
 * same transaction. Consequences, in order:
 *
 *   - a concurrent update, separation, rehire or manager change commits
 *     either entirely before this one (and is then what we compare against)
 *     or entirely after it — the effective-change comparison, the sensitive
 *     write authorization, the status matrix, the date rules, the manager
 *     eligibility and the before/after audit states are all decided against
 *     the row as it is at write time, never a stale pre-read;
 *   - if an audit insert fails, the employee mutation rolls back with it —
 *     there is no committed change without its audit row, and no audit row
 *     for a change that never committed.
 *
 * Checks, in order, all before the single UPDATE statement:
 *
 *   1. authorization of the FIELDS (sensitive-write / notes) against the
 *      persisted row — a refused field rejects the whole body;
 *   2. the status matrix — termination, rehire and confirmation are refused
 *      here and pointed at their governed actions;
 *   3. validation of the MERGED record (locked row + patch), so a partial
 *      update cannot leave an inconsistent record behind;
 *   4. reference ownership, identifier uniqueness and reporting-line
 *      eligibility, all read through the transaction.
 *
 * LOCK ORDER (fixed, never reversed — this is what rules out deadlocks):
 *
 *   1. `pg_advisory_xact_lock(hashtext('employee-reporting-line:<orgId>'))`,
 *      taken ONLY when the body supplies `reportingManagerId` (decided from
 *      the request, before any row is read, so it is always the first lock);
 *   2. the target employee row, `SELECT ... FOR UPDATE`;
 *   3. plain (unlocked) reads of other rows: manager, references,
 *      identifier duplicates, the actor's own employee link.
 *
 * An update that does not touch the reporting line takes only lock 2, so it
 * can never hold a row while waiting for the advisory lock; a manager change
 * holds the advisory lock while waiting for the row. Two manager changes are
 * serialized by lock 1 regardless of which rows they target, which is what
 * keeps the cycle walk's snapshot valid (A→B ∥ B→A: exactly one commits).
 * createEmployee's reporting-line check does not take the advisory lock
 * (a row that does not exist yet cannot be on any chain), and no other code
 * path takes it, so there is no second acquisition order in the codebase.
 *
 * Self-administration (owner policy, 2026-10-09) is checked in the service as
 * well as at the route. It is asserted BEFORE the transaction (so the common
 * denial path writes its denial audit and returns without ever holding a
 * lock) and re-asserted INSIDE it against the locked state, so a link created
 * between the two cannot let the actor edit a record that became their own.
 * A denial writes nothing but its own "denied" event; it never produces an
 * employee.updated / employee.status_changed row because those are written
 * last, in the same transaction, and only after every check has passed.
 *
 * Audit: `employee.status_changed` (pre-existing, unchanged shape) when the
 * status changes; `employee.updated` for every other effective change,
 * carrying the changed field names and masked before/after values. A body
 * that changes nothing performs no write and records no audit event.
 */
export async function updateEmployee(params: {
  organizationId: number;
  employeeId: number;
  fields: EmployeeUpdateFields;
  actorApplicationUserId: number;
  /** Null only under a break-glass grant (no membership row exists for the platform actor); the user id still identifies the true actor. */
  actorMembershipId: number | null;
  authorization: EmployeeWriteAuthorization;
}): Promise<Employee> {
  // Pre-flight, outside the transaction: 404 and the self-administration
  // boundary. Neither holds a lock, and the denial audit commits on its own.
  const preflight = await getEmployeeById(params.organizationId, params.employeeId);
  if (!preflight) throw new EmployeeNotFoundError();
  const selfCheck = {
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    action: "employee.update",
  };
  await assertNotSelfAdministration(selfCheck);

  const fields = stripUndefined(params.fields as Record<string, unknown>);
  if (Object.keys(fields).length === 0) return preflight;
  // Decided from the REQUEST, before any row is read: the advisory lock must
  // always be the first lock taken (see LOCK ORDER above).
  const managerRequested = fields.reportingManagerId !== undefined;

  return db.transaction(async (tx) => {
    if (managerRequested) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${REPORTING_LINE_LOCK_KEY}:${params.organizationId}`}))`);
    }
    const [existing] = await tx
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
      .limit(1)
      .for("update");
    if (!existing) throw new EmployeeNotFoundError();
    // Re-asserted against the locked state (the actor's link may have been
    // created since the pre-flight). The denial event is written through the
    // pool, not this transaction, so it survives the rollback that follows.
    await assertNotSelfAdministration({ ...selfCheck, client: tx });

    const stored = existing as unknown as Record<string, unknown>;

    // Everything below reasons about EFFECTIVE changes only: a field whose
    // supplied value equals the persisted one (trimmed, "" ≡ null, dates by
    // instant, json by value) is a no-op. It is neither authorized, validated
    // nor written — so an actor without the sensitive key can re-send the
    // values the Edit form displays, and nobody can alter even the whitespace
    // of a sensitive value by re-sending it. A body that changes nothing
    // performs no write and records no audit event.
    const effective: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!sameValue(stored[k], v)) effective[k] = v;
    }
    if (Object.keys(effective).length === 0) return existing;
    const effectiveFields = effective as EmployeeUpdateFields;

    // Authorization is decided against the PERSISTED (locked) row, never a client claim.
    assertEmployeeWriteAuthorized(effective, params.authorization, stored);
    assertStatusChangeAllowedViaUpdate(existing.employmentStatus, effectiveFields.employmentStatus);
    // Pure check, answered before any further query.
    if (effectiveFields.reportingManagerId != null && effectiveFields.reportingManagerId === params.employeeId) throw new EmployeeSelfManagerError();

    validateEmployeeFieldFormats(effectiveFields);
    const merged = { ...existing, ...effective } as Employee;
    validateEmployeeDateConsistency(merged);
    await assertEmployeeReferencesValid(params.organizationId, effectiveFields, tx);
    await assertEmployeeIdentifiersUnique(tx, {
      organizationId: params.organizationId,
      excludeEmployeeId: params.employeeId,
      nationalId: effectiveFields.nationalId,
      passportNumber: effectiveFields.passportNumber,
    });
    if (effective.reportingManagerId !== undefined) {
      // Under the advisory lock taken above (managerRequested is necessarily true here).
      await assertReportingManagerEligible(tx, {
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        reportingManagerId: effectiveFields.reportingManagerId,
      });
    }

    const patch = { ...effective, updatedBy: params.actorApplicationUserId };
    const [updated] = await tx
      .update(employeesTable)
      .set(patch)
      .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
      .returning();
    if (!updated) throw new EmployeeNotFoundError();

    // Audit rows go through `tx`: a failure here rolls the UPDATE back.
    const statusChanged = effectiveFields.employmentStatus !== undefined && effectiveFields.employmentStatus !== existing.employmentStatus;
    if (statusChanged) {
      await recordAuditEvent(
        {
          actorApplicationUserId: params.actorApplicationUserId,
          actorMembershipId: params.actorMembershipId,
          organizationId: params.organizationId,
          eventType: "employee.status_changed",
          targetType: "employee",
          targetId: String(params.employeeId),
          beforeState: { employmentStatus: existing.employmentStatus },
          afterState: { employmentStatus: updated.employmentStatus },
        },
        tx,
      );
    }

    const requested = Object.keys(fields).filter((k) => k !== "employmentStatus");
    const changes = summarizeEmployeeChanges(existing as Record<string, unknown>, updated as Record<string, unknown>, requested);
    if (changes.changedFields.length > 0) {
      await recordAuditEvent(
        {
          actorApplicationUserId: params.actorApplicationUserId,
          actorMembershipId: params.actorMembershipId,
          organizationId: params.organizationId,
          eventType: "employee.updated",
          targetType: "employee",
          targetId: String(params.employeeId),
          beforeState: changes.beforeState,
          afterState: changes.afterState,
          metadata: { changedFields: changes.changedFields },
        },
        tx,
      );
    }

    return updated;
  });
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
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
  /**
   * Phase 1 hardening (2026-10-08): whether the caller may read the
   * sensitive field set (`employee.sensitive.read`). The directory search
   * matches ONLY directory fields — name, preferred name, staff number, work
   * email — unless this is true, in which case personal email also matches.
   * Without this a directory-only caller could confirm a colleague's private
   * email by searching for it even though the value itself is redacted in
   * the response: matching is disclosure. Defaults to false (fail closed).
   */
  includePrivateContactFields?: boolean;
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
      ...(params.includePrivateContactFields ? [ilike(employeesTable.personalEmail, term)] : []),
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
  await assertNotSelfAdministration({ organizationId: params.organizationId, employeeId: params.employeeId, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId, action: "employee.separate" });
  // Phase 1 hardening: the separation date is checked against the stored
  // hire date (the same merged-state rule the generic update applies).
  validateEmployeeDateConsistency({ ...before, separationDate: params.separationDate });

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
  await assertNotSelfAdministration({ organizationId: params.organizationId, employeeId: params.employeeId, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId, action: "employee.rehire" });

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

  await assertNotSelfAdministration({ organizationId: params.organizationId, employeeId: params.employeeId, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId, action: "employee.transfer" });

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
  await assertNotSelfAdministration({ organizationId: params.organizationId, employeeId: params.employeeId, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId, action: "employee.promote" });

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
  await assertNotSelfAdministration({ organizationId: params.organizationId, employeeId: params.employeeId, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId, action: "employee.confirm" });

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
