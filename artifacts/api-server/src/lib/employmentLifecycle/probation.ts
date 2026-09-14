import { and, asc, eq, desc, isNotNull, lte } from "drizzle-orm";
import {
  db,
  employeesTable,
  employmentPeriodsTable,
  performanceReviewsTable,
  performanceCyclesTable,
  type Employee,
} from "@workspace/db";
import { recordEmploymentPeriodEvent } from "../employmentLifecycleService";
import { isSystemEventType } from "./eventTypes";

/**
 * WS-11 — probation extension and outcome
 * (see §27.8–27.9, and §21's standing ruling).
 *
 * NO SECOND PROBATION MECHANISM. There is deliberately no probation table here.
 * `confirmEmployee()` remains untouched and authoritative for the successful
 * path; `employees.probationEndDate` remains the current-state column; and
 * `employment_periods` carries the history. WS-11 adds only the two capabilities
 * §21 recorded as missing: extension-as-an-event, and an unsuccessful outcome.
 *
 * THE RULE THIS FILE MOST EXISTS TO HOLD (§27.8): recording an unsuccessful
 * outcome must NEVER separate the employee. Nothing in this file calls
 * `separateEmployee`, changes `employmentStatus`, or schedules anything that
 * would. If employment ends, it ends through the authoritative separation
 * service by an explicit authorized act — never as a side effect of a probation
 * verdict.
 */

export class EmployeeNotFoundForProbationError extends Error {
  constructor() {
    super("Employee not found in this organization.");
    this.name = "EmployeeNotFoundForProbationError";
  }
}
export class EmployeeNotOnProbationForActionError extends Error {
  constructor() {
    super("This employee is not on probation.");
    this.name = "EmployeeNotOnProbationForActionError";
  }
}
export class InvalidProbationExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProbationExtensionError";
  }
}
export class ProbationExtensionsNotPermittedError extends Error {
  constructor() {
    super("This organization does not permit probation extensions.");
    this.name = "ProbationExtensionsNotPermittedError";
  }
}
export class ProbationExtensionLimitReachedError extends Error {
  constructor(readonly limit: number) {
    super(`This organization allows at most ${limit} probation extension(s).`);
    this.name = "ProbationExtensionLimitReachedError";
  }
}
export class InvalidProbationReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProbationReviewError";
  }
}

async function loadEmployee(organizationId: number, employeeId: number): Promise<Employee> {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) throw new EmployeeNotFoundForProbationError();
  return employee;
}

/**
 * Validates a probation review reference exactly as `confirmEmployee()` does —
 * same organization, same employee, and a cycle whose type is `probation`.
 *
 * Reused rather than reimplemented so the two paths cannot drift apart.
 */
async function assertValidProbationReview(organizationId: number, employeeId: number, reviewId: number): Promise<void> {
  const [review] = await db
    .select({ employeeId: performanceReviewsTable.employeeId, cycleType: performanceCyclesTable.cycleType })
    .from(performanceReviewsTable)
    .innerJoin(performanceCyclesTable, eq(performanceReviewsTable.cycleId, performanceCyclesTable.id))
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  if (!review) throw new InvalidProbationReviewError("Referenced performance review not found in this organization.");
  if (review.employeeId !== employeeId) throw new InvalidProbationReviewError("That review does not belong to this employee.");
  if (review.cycleType !== "probation") throw new InvalidProbationReviewError("That review is not part of a probation cycle.");
}

/** How many controlled extension events this employee already has. */
export async function countExtensions(organizationId: number, employeeId: number): Promise<number> {
  const rows = await db
    .select({ id: employmentPeriodsTable.id })
    .from(employmentPeriodsTable)
    .where(
      and(
        eq(employmentPeriodsTable.organizationId, organizationId),
        eq(employmentPeriodsTable.employeeId, employeeId),
        eq(employmentPeriodsTable.eventType, "probation_extension"),
      ),
    );
  return rows.length;
}

/**
 * The current expected probation end (§27.9): the latest REGISTERED extension
 * event where one exists, otherwise `employees.probationEndDate`.
 *
 * The filter on registered system types is the point. An imported history row
 * whose free-text `eventType` happens to read "probation_extension" is
 * historical evidence, not an instruction — only events this platform itself
 * wrote may move a live date (§27.15, §27.19). Since the extension service
 * updates the column in the same operation, the two sources agree by
 * construction; the event is consulted first because §27.9 says so, and because
 * it carries the authorship the column cannot.
 */
export async function resolveProbationEnd(
  organizationId: number,
  employeeId: number,
): Promise<{ probationEndDate: Date | null; source: "extension_event" | "employee_record" | "none" }> {
  const [latest] = await db
    .select({ eventType: employmentPeriodsTable.eventType, newState: employmentPeriodsTable.newState })
    .from(employmentPeriodsTable)
    .where(
      and(
        eq(employmentPeriodsTable.organizationId, organizationId),
        eq(employmentPeriodsTable.employeeId, employeeId),
        eq(employmentPeriodsTable.eventType, "probation_extension"),
      ),
    )
    .orderBy(desc(employmentPeriodsTable.effectiveDate), desc(employmentPeriodsTable.id))
    .limit(1);

  if (latest && isSystemEventType(latest.eventType)) {
    const raw = (latest.newState as { newProbationEndDate?: string | Date } | null)?.newProbationEndDate;
    if (raw) return { probationEndDate: raw instanceof Date ? raw : new Date(raw), source: "extension_event" };
  }

  const employee = await loadEmployee(organizationId, employeeId);
  return employee.probationEndDate
    ? { probationEndDate: employee.probationEndDate, source: "employee_record" }
    : { probationEndDate: null, source: "none" };
}

/**
 * Employees still on probation whose expected end falls on or before
 * `onOrBefore` (already-passed ends included — an unconfirmed probation past
 * its end is the most urgent case, not a resolved one).
 *
 * Batch counterpart of resolveProbationEnd for list surfaces. It reads
 * `employees.probationEndDate` directly, which is sound because
 * extendProbation moves that column in the same operation that writes the
 * registered extension event (§27.9) — the two agree by construction — and
 * it avoids one event lookup per employee.
 */
export async function listProbationsEndingOnOrBefore(organizationId: number, onOrBefore: Date) {
  return db
    .select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      probationEndDate: employeesTable.probationEndDate,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.organizationId, organizationId),
        eq(employeesTable.employmentStatus, "probation"),
        isNotNull(employeesTable.probationEndDate),
        lte(employeesTable.probationEndDate, onOrBefore),
      ),
    )
    .orderBy(asc(employeesTable.probationEndDate), asc(employeesTable.id));
}

/**
 * Extends probation as a real effective-dated lifecycle event.
 *
 * The prior expected end is captured in `previousState` before the column moves,
 * so the history remains reconstructable even though the column is overwritten
 * — the column is current state, the event is history (§27.15).
 */
export async function extendProbation(params: {
  organizationId: number;
  employeeId: number;
  newProbationEndDate: Date;
  effectiveDate: Date;
  reason: string;
  probationReviewId?: number | null;
  extensionsAllowed: boolean;
  maxExtensions: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ employee: Employee; previousProbationEndDate: Date | null }> {
  if (!params.reason?.trim()) throw new InvalidProbationExtensionError("A probation extension needs a reason.");
  if (!params.extensionsAllowed) throw new ProbationExtensionsNotPermittedError();

  const employee = await loadEmployee(params.organizationId, params.employeeId);
  if (employee.employmentStatus !== "probation") throw new EmployeeNotOnProbationForActionError();

  const current = await resolveProbationEnd(params.organizationId, params.employeeId);
  if (current.probationEndDate && params.newProbationEndDate.getTime() <= current.probationEndDate.getTime()) {
    throw new InvalidProbationExtensionError("The new probation end must be later than the current one.");
  }

  if (params.maxExtensions != null) {
    const used = await countExtensions(params.organizationId, params.employeeId);
    if (used >= params.maxExtensions) throw new ProbationExtensionLimitReachedError(params.maxExtensions);
  }

  if (params.probationReviewId != null) {
    await assertValidProbationReview(params.organizationId, params.employeeId, params.probationReviewId);
  }

  const [updated] = await db
    .update(employeesTable)
    .set({ probationEndDate: params.newProbationEndDate, updatedBy: params.actorApplicationUserId })
    .where(eq(employeesTable.id, params.employeeId))
    .returning();

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "probation_extension",
    effectiveDate: params.effectiveDate,
    previousState: { probationEndDate: current.probationEndDate },
    newState: {
      previousProbationEndDate: current.probationEndDate,
      newProbationEndDate: params.newProbationEndDate,
      reason: params.reason.trim(),
      ...(params.probationReviewId != null ? { probationReviewId: params.probationReviewId } : {}),
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return { employee: updated, previousProbationEndDate: current.probationEndDate };
}

/**
 * Records an unsuccessful probation outcome.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE (§27.8). This function records a
 * FACT and surfaces an HR action. It deliberately does not:
 *   - call `separateEmployee()`;
 *   - change `employmentStatus` (the employee stays on probation until an
 *     authorized person decides what happens next);
 *   - schedule any job that would do either.
 *
 * The employment decision belongs to an authorized organizational process, and
 * if employment ends it ends through the authoritative separation service. A
 * hidden "probation failed → terminate" coupling is exactly what the frozen
 * architecture forbids.
 */
export async function recordUnsuccessfulProbation(params: {
  organizationId: number;
  employeeId: number;
  effectiveDate: Date;
  reason: string;
  probationReviewId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ employee: Employee }> {
  if (!params.reason?.trim()) throw new InvalidProbationExtensionError("A probation outcome needs a reason.");

  const employee = await loadEmployee(params.organizationId, params.employeeId);
  if (employee.employmentStatus !== "probation") throw new EmployeeNotOnProbationForActionError();

  if (params.probationReviewId != null) {
    await assertValidProbationReview(params.organizationId, params.employeeId, params.probationReviewId);
  }

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: "probation_unsuccessful",
    effectiveDate: params.effectiveDate,
    previousState: { employmentStatus: employee.employmentStatus },
    newState: {
      outcome: "unsuccessful",
      reason: params.reason.trim(),
      // Employment status is unchanged on purpose — recorded explicitly so the
      // history states what did NOT happen as clearly as what did.
      employmentStatus: employee.employmentStatus,
      ...(params.probationReviewId != null ? { probationReviewId: params.probationReviewId } : {}),
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return { employee };
}

/** Whether an unsuccessful outcome has already been recorded, for HR surfaces. */
export async function hasUnsuccessfulOutcome(organizationId: number, employeeId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: employmentPeriodsTable.id })
    .from(employmentPeriodsTable)
    .where(
      and(
        eq(employmentPeriodsTable.organizationId, organizationId),
        eq(employmentPeriodsTable.employeeId, employeeId),
        eq(employmentPeriodsTable.eventType, "probation_unsuccessful"),
      ),
    )
    .limit(1);
  return !!row;
}
