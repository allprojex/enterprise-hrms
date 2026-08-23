/**
 * Phase 3H, W114 — Numbering & Identifier History.
 *
 * The organization-level numbering-format engine (frozen plan §4/Decision 5)
 * plus the employee/staff-number allocation, release, and reuse lifecycle
 * (frozen plan §5) built on top of it. `employee_number_allocations` is the
 * authoritative historical source; `employees.employeeNumber` remains only a
 * denormalized current-value cache, kept in sync inside the same transaction
 * as every allocation-history change — never written independently anywhere
 * else (closes the previously-disclosed, unaudited generic-PATCH mutation
 * gap: routes/employees.ts's PATCH handler no longer accepts employeeNumber
 * at all; see UpdateEmployeeInput in the OpenAPI spec).
 *
 * Concurrency (frozen plan §4): sequence generation is never
 * SELECT MAX(...) + 1. `numbering_sequences` is locked with
 * `SELECT ... FOR UPDATE` inside the same transaction as the increment and
 * the allocation-row insert, the same pattern already established by
 * learningEnrollments.ts's session-capacity check. Collisions (an
 * already-active number, two concurrent reuse attempts, a manual-override
 * collision) are caught by employee_number_allocations' own partial unique
 * index (`WHERE valid_to IS NULL`) at the database level — the same
 * isUniqueViolation()/dbErrors.ts pattern used throughout this codebase.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  employeesTable,
  branchesTable,
  departmentsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  type Employee,
  type EmployeeNumberAllocation,
} from "@workspace/db";
import { getNamespaceConfig } from "../services/organizationConfig";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class EmployeeNotFoundForNumberingError extends Error {
  constructor() {
    super("Employee not found");
    this.name = "EmployeeNotFoundForNumberingError";
  }
}

export class EmployeeNumberAlreadyActiveError extends Error {
  constructor() {
    super("This employee already has an active staff number — release it before allocating a new one");
    this.name = "EmployeeNumberAlreadyActiveError";
  }
}

export class EmployeeNumberReuseDisabledError extends Error {
  constructor() {
    super("This staff number was previously used and this organization does not permit staff-number reuse");
    this.name = "EmployeeNumberReuseDisabledError";
  }
}

export class EmployeeNumberCollisionError extends Error {
  constructor() {
    super("This staff number is already actively allocated to another employee");
    this.name = "EmployeeNumberCollisionError";
  }
}

export class EmployeeNumberMissingTokenDataError extends Error {
  constructor(label: string) {
    super(`This organization's numbering configuration requires a ${label}, but the employee has none assigned`);
    this.name = "EmployeeNumberMissingTokenDataError";
  }
}

export class EmployeeNumberNoActiveAllocationError extends Error {
  constructor() {
    super("This employee has no active staff-number allocation to release");
    this.name = "EmployeeNumberNoActiveAllocationError";
  }
}

export class EmployeeNumberStillActivelyEmployedError extends Error {
  constructor() {
    super("A staff number cannot be released while the employee is still actively employed");
    this.name = "EmployeeNumberStillActivelyEmployedError";
  }
}

export class InvalidManualEmployeeNumberError extends Error {
  constructor() {
    super("A manual staff-number value is required");
    this.name = "InvalidManualEmployeeNumberError";
  }
}

// Structurally accepts either the global `db` or an already-open
// `db.transaction(...)` callback's `tx` — mirrors lib/employees.ts's own
// QueryClient convention exactly, so this engine composes correctly whether
// it's driving employee creation from the plain HTTP route (POST
// .../employees, no outer transaction) or from a caller that already has one
// open (e.g. a future bulk-import workstream). Nested `.transaction()` calls
// become Postgres SAVEPOINTs (drizzle-orm's own documented node-postgres
// behavior) — verified present in this repo's exact installed drizzle-orm
// version before relying on it here.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface EmployeeNumberFormatConfig {
  prefix?: string;
  suffix?: string;
  separator?: string;
  sequenceLength?: number;
  startingSequence?: number;
  includeBranchToken?: boolean;
  includeDepartmentToken?: boolean;
  includeYearToken?: boolean;
  includeMonthToken?: boolean;
  resetPolicy?: "never" | "yearly" | "monthly";
  reuseEnabled?: boolean;
}

const EMPLOYEE_NUMBER_SEQUENCE_KEY = "employee_number";

/** "" for "never" (a single lifetime counter — never NULL, see the schema's own note on why), "2026" for yearly, "2026-08" for monthly. */
function resolvePeriodKey(resetPolicy: EmployeeNumberFormatConfig["resetPolicy"], now: Date): string {
  if (resetPolicy === "yearly") return String(now.getUTCFullYear());
  if (resetPolicy === "monthly") return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return "";
}

function formatGeneratedNumber(
  config: EmployeeNumberFormatConfig,
  sequenceValue: number,
  tokens: { branchCode: string | null; departmentCode: string | null; year: number; month: number },
): string {
  const segments: string[] = [];
  if (config.prefix) segments.push(config.prefix);
  if (config.includeBranchToken) {
    if (!tokens.branchCode) throw new EmployeeNumberMissingTokenDataError("branch");
    segments.push(tokens.branchCode);
  }
  if (config.includeDepartmentToken) {
    if (!tokens.departmentCode) throw new EmployeeNumberMissingTokenDataError("department");
    segments.push(tokens.departmentCode);
  }
  if (config.includeYearToken) segments.push(String(tokens.year));
  if (config.includeMonthToken) segments.push(String(tokens.month).padStart(2, "0"));
  segments.push(String(sequenceValue).padStart(config.sequenceLength ?? 4, "0"));
  if (config.suffix) segments.push(config.suffix);
  return segments.join(config.separator ?? "-");
}

/**
 * Locks (or creates, on first use) the counter row for this
 * (organization, sequenceKey, periodKey) and returns the next value —
 * atomic and race-free within `tx`. Never SELECT MAX(...) + 1.
 */
async function lockAndIncrementSequenceIn(
  tx: QueryClient,
  params: { organizationId: number; sequenceKey: string; periodKey: string; startingSequence: number },
): Promise<number> {
  const where = and(
    eq(numberingSequencesTable.organizationId, params.organizationId),
    eq(numberingSequencesTable.sequenceKey, params.sequenceKey),
    eq(numberingSequencesTable.periodKey, params.periodKey),
  );

  const [existing] = await tx.select().from(numberingSequencesTable).where(where).for("update");
  if (existing) {
    const nextValue = existing.currentValue + 1;
    await tx.update(numberingSequencesTable).set({ currentValue: nextValue }).where(eq(numberingSequencesTable.id, existing.id));
    return nextValue;
  }

  try {
    const [inserted] = await tx
      .insert(numberingSequencesTable)
      .values({
        organizationId: params.organizationId,
        sequenceKey: params.sequenceKey,
        periodKey: params.periodKey,
        currentValue: params.startingSequence,
      })
      .returning();
    return inserted.currentValue;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Lost a race with a concurrent first allocation for this period — the
    // row now exists; lock and increment it instead of double-creating it.
    const [raced] = await tx.select().from(numberingSequencesTable).where(where).for("update");
    const nextValue = raced!.currentValue + 1;
    await tx.update(numberingSequencesTable).set({ currentValue: nextValue }).where(eq(numberingSequencesTable.id, raced!.id));
    return nextValue;
  }
}

/**
 * Increments the sequence in its OWN immediately-committing transaction
 * against the real `db` — deliberately never nested inside the caller's own
 * (possibly-retried) transaction. A sequence is only required to never issue
 * the same value twice, never to avoid gaps (the same tolerance a plain
 * Postgres SERIAL/IDENTITY column already has on any rolled-back insert) —
 * so decoupling the increment from the rest of a generation attempt is
 * correct, not merely convenient. It is also what makes
 * allocateGeneratedEmployeeNumber's own retry-on-collision loop actually
 * progress: if the increment lived inside the same savepoint as the
 * allocation-row insert, a collision's rollback would undo the increment
 * too, and every retry would recompute the exact same (still-colliding)
 * value forever.
 */
async function lockAndIncrementSequence(
  params: { organizationId: number; sequenceKey: string; periodKey: string; startingSequence: number },
): Promise<number> {
  return db.transaction((tx) => lockAndIncrementSequenceIn(tx, params));
}

async function resolveTokenCodes(
  tx: QueryClient,
  employee: Pick<Employee, "branchId" | "departmentId">,
): Promise<{ branchCode: string | null; departmentCode: string | null }> {
  const [branch, department] = await Promise.all([
    employee.branchId
      ? tx.select({ code: branchesTable.code }).from(branchesTable).where(eq(branchesTable.id, employee.branchId)).limit(1)
      : Promise.resolve([]),
    employee.departmentId
      ? tx
          .select({ code: departmentsTable.code })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, employee.departmentId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { branchCode: branch[0]?.code ?? null, departmentCode: department[0]?.code ?? null };
}

async function getEmployeeNumberFormatConfig(organizationId: number): Promise<EmployeeNumberFormatConfig> {
  const config = await getNamespaceConfig(organizationId, "numbering");
  return (config.data.employeeNumber as EmployeeNumberFormatConfig | undefined) ?? {};
}

/**
 * Allocates a fresh, engine-generated staff number to `employeeId` inside
 * `client` (a transaction, or a savepoint if `client` is already one).
 * Never reuses a released number — a generated number always comes from a
 * strictly incrementing counter, so it can never collide with a previously
 * allocated one (reuse is only ever reachable through
 * `allocateManualEmployeeNumber`'s deliberate path, per the frozen plan).
 * Used both by createEmployee (new hires) and the standalone allocate route
 * (e.g. re-allocating after a correction).
 */
// A generated number is only guaranteed collision-free against
// employee_number_allocations' own history — an organization with
// employees created before this workstream (whose employeeNumber predates
// employee_number_allocations entirely, until the one-time backfill script
// runs) can still hold a legacy number the sequence counter doesn't know
// about yet. Rather than fail outright on that first collision, retry with
// the next sequence value, bounded, self-healing past any such legacy gap
// without needing to parse or understand the legacy format at all — this is
// the disclosed pre-existing generateEmployeeNumber() race/retry limitation
// this workstream's own frozen plan commits to closing.
const MAX_GENERATED_NUMBER_ATTEMPTS = 20;

export async function allocateGeneratedEmployeeNumber(
  client: QueryClient,
  params: { organizationId: number; employeeId: number; actorMembershipId: number | null },
): Promise<{ employee: Employee; allocation: EmployeeNumberAllocation }> {
  const config = await getEmployeeNumberFormatConfig(params.organizationId);
  const periodKey = resolvePeriodKey(config.resetPolicy, new Date());

  for (let attempt = 1; attempt <= MAX_GENERATED_NUMBER_ATTEMPTS; attempt++) {
    // Deliberately outside the transaction below — see
    // lockAndIncrementSequence's own comment on why the increment must
    // commit independently of this attempt's own possible rollback.
    const sequenceValue = await lockAndIncrementSequence({
      organizationId: params.organizationId,
      sequenceKey: EMPLOYEE_NUMBER_SEQUENCE_KEY,
      periodKey,
      startingSequence: config.startingSequence ?? 1,
    });

    try {
      return await client.transaction(async (tx) => {
        const [employee] = await tx
          .select()
          .from(employeesTable)
          .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
          .for("update");
        if (!employee) throw new EmployeeNotFoundForNumberingError();

        const [openAllocation] = await tx
          .select({ id: employeeNumberAllocationsTable.id })
          .from(employeeNumberAllocationsTable)
          .where(and(eq(employeeNumberAllocationsTable.employeeId, params.employeeId), isNull(employeeNumberAllocationsTable.validTo)))
          .limit(1);
        if (openAllocation) throw new EmployeeNumberAlreadyActiveError();

        const { branchCode, departmentCode } = await resolveTokenCodes(tx, employee);
        const now = new Date();
        const employeeNumber = formatGeneratedNumber(config, sequenceValue, {
          branchCode,
          departmentCode,
          year: now.getUTCFullYear(),
          month: now.getUTCMonth() + 1,
        });

        const [allocation] = await tx
          .insert(employeeNumberAllocationsTable)
          .values({
            organizationId: params.organizationId,
            employeeId: params.employeeId,
            employeeNumber,
            allocationMethod: "generated",
            allocatedByMembershipId: params.actorMembershipId,
          })
          .returning();

        const [updatedEmployee] = await tx
          .update(employeesTable)
          .set({ employeeNumber })
          .where(eq(employeesTable.id, params.employeeId))
          .returning();

        return { employee: updatedEmployee, allocation };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_GENERATED_NUMBER_ATTEMPTS) continue;
      throw err;
    }
  }
  // Unreachable — the loop always returns or throws — but keeps TypeScript's
  // control-flow analysis satisfied without an unsound non-null assertion.
  throw new EmployeeNumberCollisionError();
}

/**
 * Allocates (or deliberately reuses) an HR-supplied staff number. Whether
 * this counts as "reuse" is determined by whether `employeeNumber` has ANY
 * prior allocation row in this organization's history — if so, the
 * organization's own reuseEnabled policy gates it (frozen plan Decision 2);
 * if this exact string has never been used before, it's a plain manual
 * allocation, always allowed. Either way, the partial unique index is the
 * final authority against an active-number collision or a simultaneous
 * reuse race — this function's own pre-checks are a clear-error fast path,
 * not the actual safety mechanism.
 */
export async function allocateManualEmployeeNumber(
  client: QueryClient,
  params: { organizationId: number; employeeId: number; employeeNumber: string; actorMembershipId: number | null },
): Promise<{ employee: Employee; allocation: EmployeeNumberAllocation }> {
  const employeeNumber = params.employeeNumber.trim();
  if (!employeeNumber) throw new InvalidManualEmployeeNumberError();

  return client.transaction(async (tx) => {
    const [employee] = await tx
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
      .for("update");
    if (!employee) throw new EmployeeNotFoundForNumberingError();

    const [openAllocation] = await tx
      .select({ id: employeeNumberAllocationsTable.id })
      .from(employeeNumberAllocationsTable)
      .where(and(eq(employeeNumberAllocationsTable.employeeId, params.employeeId), isNull(employeeNumberAllocationsTable.validTo)))
      .limit(1);
    if (openAllocation) throw new EmployeeNumberAlreadyActiveError();

    // Distinct from `openAllocation` above (which checks THIS employee): an
    // open allocation of this exact number under ANY employee is a true
    // active collision, always rejected regardless of reuse policy — reuse
    // only ever applies to a number whose most recent allocation is already
    // CLOSED. Checked explicitly here (not left to the partial unique index
    // alone) so it surfaces as a clean 409 rather than being miscategorized
    // as "reuse disabled" by the check below.
    const [openAllocationOfThisNumber] = await tx
      .select({ id: employeeNumberAllocationsTable.id })
      .from(employeeNumberAllocationsTable)
      .where(
        and(
          eq(employeeNumberAllocationsTable.organizationId, params.organizationId),
          eq(employeeNumberAllocationsTable.employeeNumber, employeeNumber),
          isNull(employeeNumberAllocationsTable.validTo),
        ),
      )
      .limit(1);
    if (openAllocationOfThisNumber) throw new EmployeeNumberCollisionError();

    const [priorAllocationOfThisNumber] = await tx
      .select({ id: employeeNumberAllocationsTable.id })
      .from(employeeNumberAllocationsTable)
      .where(
        and(
          eq(employeeNumberAllocationsTable.organizationId, params.organizationId),
          eq(employeeNumberAllocationsTable.employeeNumber, employeeNumber),
        ),
      )
      .limit(1);

    let allocationMethod: "manual" | "reused" = "manual";
    if (priorAllocationOfThisNumber) {
      const config = await getEmployeeNumberFormatConfig(params.organizationId);
      if (config.reuseEnabled !== true) throw new EmployeeNumberReuseDisabledError();
      allocationMethod = "reused";
    }

    let allocation: EmployeeNumberAllocation;
    try {
      [allocation] = await tx
        .insert(employeeNumberAllocationsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          employeeNumber,
          allocationMethod,
          allocatedByMembershipId: params.actorMembershipId,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmployeeNumberCollisionError();
      throw err;
    }

    const [updatedEmployee] = await tx
      .update(employeesTable)
      .set({ employeeNumber })
      .where(eq(employeesTable.id, params.employeeId))
      .returning();

    return { employee: updatedEmployee, allocation };
  });
}

/**
 * Explicit HR release (frozen plan §5, step 5) — never automatic on
 * separation. Blocked while the employee is still actively employed
 * (`active`/`probation`/`on_leave`/`suspended` — anything other than
 * `terminated`). Closes the allocation historically; never deletes or
 * rewrites it. Clears the current-value cache on `employees` so the
 * pre-existing `(organizationId, employeeNumber)` unique index never blocks
 * a later reallocation of the same number.
 */
export async function releaseEmployeeNumber(
  client: QueryClient,
  params: { organizationId: number; employeeId: number; actorMembershipId: number | null },
): Promise<{ employee: Employee; allocation: EmployeeNumberAllocation }> {
  return client.transaction(async (tx) => {
    const [employee] = await tx
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
      .for("update");
    if (!employee) throw new EmployeeNotFoundForNumberingError();
    if (employee.employmentStatus !== "terminated") throw new EmployeeNumberStillActivelyEmployedError();

    const [openAllocation] = await tx
      .select()
      .from(employeeNumberAllocationsTable)
      .where(and(eq(employeeNumberAllocationsTable.employeeId, params.employeeId), isNull(employeeNumberAllocationsTable.validTo)))
      .limit(1);
    if (!openAllocation) throw new EmployeeNumberNoActiveAllocationError();

    const [releasedAllocation] = await tx
      .update(employeeNumberAllocationsTable)
      .set({ validTo: new Date(), releasedByMembershipId: params.actorMembershipId })
      .where(eq(employeeNumberAllocationsTable.id, openAllocation.id))
      .returning();

    const [updatedEmployee] = await tx
      .update(employeesTable)
      .set({ employeeNumber: null })
      .where(eq(employeesTable.id, params.employeeId))
      .returning();

    return { employee: updatedEmployee, allocation: releasedAllocation };
  });
}

/** Full allocation history for one employee, most recent first — the authoritative source, never `employees.employeeNumber` alone. */
export async function listEmployeeNumberAllocationsForEmployee(
  organizationId: number,
  employeeId: number,
): Promise<EmployeeNumberAllocation[]> {
  return db
    .select()
    .from(employeeNumberAllocationsTable)
    .where(and(eq(employeeNumberAllocationsTable.organizationId, organizationId), eq(employeeNumberAllocationsTable.employeeId, employeeId)))
    .orderBy(employeeNumberAllocationsTable.validFrom);
}

/** Every allocation (any employee) that has ever held a given number, most recent first — needed to show a reused number's full ownership chain without ambiguity. */
export async function listEmployeeNumberAllocationsForNumber(
  organizationId: number,
  employeeNumber: string,
): Promise<EmployeeNumberAllocation[]> {
  return db
    .select()
    .from(employeeNumberAllocationsTable)
    .where(
      and(
        eq(employeeNumberAllocationsTable.organizationId, organizationId),
        eq(employeeNumberAllocationsTable.employeeNumber, employeeNumber),
      ),
    )
    .orderBy(employeeNumberAllocationsTable.validFrom);
}

/**
 * Resolves the staff number that belonged to `employeeId` as of
 * `asOfDate` (defaults to now) — the authoritative historical-resolution
 * helper (frozen plan §6) later report/search consumers must use instead of
 * ever reading `employees.employeeNumber` as historical truth. Returns null
 * if the employee held no allocation at that date.
 */
export async function resolveEmployeeNumberAsOf(
  organizationId: number,
  employeeId: number,
  asOfDate: Date = new Date(),
): Promise<string | null> {
  const rows = await db
    .select()
    .from(employeeNumberAllocationsTable)
    .where(and(eq(employeeNumberAllocationsTable.organizationId, organizationId), eq(employeeNumberAllocationsTable.employeeId, employeeId)));

  for (const row of rows) {
    const from = row.validFrom.getTime();
    const to = row.validTo ? row.validTo.getTime() : Infinity;
    const at = asOfDate.getTime();
    if (at >= from && at < to) return row.employeeNumber;
  }
  return null;
}

export async function auditEmployeeNumberAllocated(params: {
  organizationId: number;
  employeeId: number;
  allocation: EmployeeNumberAllocation;
  actorApplicationUserId: number | null;
  actorMembershipId: number | null;
}): Promise<void> {
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_number.allocated",
    targetType: "employee",
    targetId: String(params.employeeId),
    afterState: {
      employeeNumber: params.allocation.employeeNumber,
      allocationMethod: params.allocation.allocationMethod,
      allocationId: params.allocation.id,
    },
  });
}

export async function auditEmployeeNumberReleased(params: {
  organizationId: number;
  employeeId: number;
  allocation: EmployeeNumberAllocation;
  actorApplicationUserId: number | null;
  actorMembershipId: number | null;
}): Promise<void> {
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_number.released",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { employeeNumber: params.allocation.employeeNumber, allocationId: params.allocation.id },
  });
}

