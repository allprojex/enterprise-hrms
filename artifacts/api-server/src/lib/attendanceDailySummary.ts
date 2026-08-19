/**
 * Attendance Daily Summary — Read-Model (Phase 3B, W66): turns
 * attendance_events (+ approved attendance_adjustments) into the "who
 * attended, were they late, were they absent" answer, per
 * docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §3.3/§3.7. A pure
 * computed read-model, exactly like Leave balances (leave_balance_entries)
 * and every Recruitment reporting figure since W61 — never a stored,
 * separately-invalidated table. Nothing here writes to attendance_events or
 * attendance_adjustments; a summary read has zero side effects.
 *
 * Precedence (§3.3, "date-level exclusions first, then person-level, then
 * event-derived"), implemented as one explicit pipeline in
 * computeDailySummaryForDate:
 *   0. Outside the employment window (before hireDate / on-or-after
 *      separationDate) -> no summary at all (status: null), per §3.7's
 *      literal "no summary generated" wording for these two rows.
 *   1. Organization holiday for this civil date -> "holiday"
 *   2. Not a configured work day -> "non_working_day"
 *   3. An approved leave_requests row spans this civil date -> "on_leave"
 *   4. Otherwise, event-derived: an approved whole-day adjustment
 *      (mark_present/mark_absent/excuse_absence) short-circuits to its own
 *      status; otherwise the effective first-clock-in/last-clock-out pair
 *      (raw events, with an approved manual_clock_in/manual_clock_out
 *      adjustment overriding the matching raw value when present, per
 *      §3.3's "adjustments... take precedence over raw-event derivation")
 *      resolves to present/late/partial/absent.
 *   5. A final person-level adjustment (§3.7's "on_leave, suspended
 *      (employmentStatus): no absent ever generated for these days"): if
 *      step 4 landed on "absent" and the employee's *current*
 *      employmentStatus is on_leave or suspended, suppress it to no
 *      summary (null) rather than fabricate a status the frozen plan
 *      explicitly forbids.
 *
 * Two interpretive decisions the frozen plan does not spell out literally,
 * resolved here and flagged in this session's final report rather than
 * guessed silently:
 *   - "partial" (§3.3 lists it with no definition): an incomplete pair —
 *     a clock-in with no matching clock-out, or vice versa. "present"/
 *     "late" require a complete first-in/last-out pair; "late" is used
 *     instead of "present" only when lateMinutes > 0 (no separate status
 *     for an early departure alone — earlyDepartureMinutes is informational
 *     only, matching the enum's own lack of an "early" state).
 *   - excuse_absence has no literal enum match among the 7 frozen status
 *     values. Mapped to "on_leave" — the closest existing authorized-
 *     absence status — rather than inventing an 8th label, per the "use
 *     only the states the frozen plan defines" instruction.
 *
 * Never trusts a client-supplied timestamp/date/timezone. Civil-date
 * derivation always converts a stored UTC instant into the organization's
 * configured timezone server-side (Node's Intl.DateTimeFormat with a real
 * IANA `timeZone`, inherently DST-correct — no fixed-offset arithmetic, no
 * new dependency). Per Open Decision 2's own recommended default ("require
 * it explicitly... a silent UTC fallback risks systematically wrong 'late'
 * calculations"), a missing organization timezone is a hard error here, not
 * a silent UTC fallback.
 */
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  attendanceEventsTable,
  attendanceAdjustmentsTable,
  leaveRequestsTable,
  type Employee,
  type AttendanceAdjustment,
} from "@workspace/db";
import { getNamespaceConfig } from "../services/organizationConfig";
import { resolveHolidayDatesInRange } from "./publicHolidays";

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundError";
  }
}

export class OrganizationTimezoneNotConfiguredError extends Error {
  constructor() {
    super("Organization timezone is not configured — set general.timezone before requesting an Attendance summary");
    this.name = "OrganizationTimezoneNotConfiguredError";
  }
}

export class InvalidAttendanceSummaryRangeError extends Error {}

export type AttendanceSummaryStatus = "present" | "late" | "partial" | "absent" | "on_leave" | "holiday" | "non_working_day";

export interface DailyAttendanceSummary {
  organizationId: number;
  employeeId: number;
  date: string;
  status: AttendanceSummaryStatus | null;
  firstClockIn: Date | null;
  lastClockOut: Date | null;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Mirrors leaveCalendar.ts's own established range-safety convention
// (MAX_RANGE_DAYS = 100) rather than inventing a second limit for a
// comparable range-query shape.
const MAX_RANGE_DAYS = 100;

function emptySummary(organizationId: number, employeeId: number, date: string, status: AttendanceSummaryStatus | null): DailyAttendanceSummary {
  return {
    organizationId,
    employeeId,
    date,
    status,
    firstClockIn: null,
    lastClockOut: null,
    workedMinutes: null,
    lateMinutes: null,
    earlyDepartureMinutes: null,
  };
}

/** Organization-local civil date (YYYY-MM-DD) for a UTC instant — real IANA conversion, DST-correct. */
export function deriveCivilDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function localMinutesSinceMidnight(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
    instant,
  );
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  return hour * 60 + minute;
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const WORK_DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Whether `civilDate` falls on one of the organization's configured work days (W38, reused unchanged). */
export function isConfiguredWorkDay(civilDate: string, workDays: readonly string[]): boolean {
  const weekday = new Date(`${civilDate}T00:00:00Z`).getUTCDay();
  return workDays.includes(WORK_DAY_NAMES[weekday]);
}

function resolveWholeDayAdjustmentStatus(adjustmentType: AttendanceAdjustment["adjustmentType"]): AttendanceSummaryStatus {
  if (adjustmentType === "mark_present") return "present";
  if (adjustmentType === "mark_absent") return "absent";
  // excuse_absence: no literal enum match (see module doc) — closest
  // existing authorized-absence status.
  return "on_leave";
}

/** Pure event-derivation step (tier 4, before the person-level on_leave/suspended override) — no query, no side effect. */
export function computeEventDerivedStatus(params: {
  firstClockIn: Date | null;
  lastClockOut: Date | null;
  workStartTime: string;
  workEndTime: string;
  gracePeriodMinutes: number;
  timezone: string;
}): {
  status: Extract<AttendanceSummaryStatus, "present" | "late" | "partial" | "absent">;
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
} {
  const { firstClockIn, lastClockOut } = params;

  if (!firstClockIn && !lastClockOut) {
    return { status: "absent", workedMinutes: null, lateMinutes: null, earlyDepartureMinutes: null };
  }
  if (!firstClockIn || !lastClockOut) {
    return { status: "partial", workedMinutes: null, lateMinutes: null, earlyDepartureMinutes: null };
  }

  const lateMinutes = Math.max(
    0,
    localMinutesSinceMidnight(firstClockIn, params.timezone) - (minutesSinceMidnight(params.workStartTime) + params.gracePeriodMinutes),
  );
  const earlyDepartureMinutes = Math.max(0, minutesSinceMidnight(params.workEndTime) - localMinutesSinceMidnight(lastClockOut, params.timezone));
  const workedMinutes = Math.max(0, Math.round((lastClockOut.getTime() - firstClockIn.getTime()) / 60_000));

  return { status: lateMinutes > 0 ? "late" : "present", workedMinutes, lateMinutes, earlyDepartureMinutes };
}

interface DayContext {
  hireCivilDate: string | null;
  separationCivilDate: string | null;
  employmentStatus: Employee["employmentStatus"];
  holidayDates: ReadonlySet<string>;
  workDays: readonly string[];
  workStartTime: string;
  workEndTime: string;
  gracePeriodMinutes: number;
  timezone: string;
  approvedLeaveDates: ReadonlySet<string>;
  eventsByDate: ReadonlyMap<string, { firstClockIn: Date | null; lastClockOut: Date | null }>;
  wholeDayAdjustmentByDate: ReadonlyMap<string, AttendanceAdjustment>;
  manualClockInByDate: ReadonlyMap<string, AttendanceAdjustment>;
  manualClockOutByDate: ReadonlyMap<string, AttendanceAdjustment>;
}

/** The full precedence pipeline for one civil date — pure, deterministic, no query. */
function computeDailySummaryForDate(organizationId: number, employeeId: number, civilDate: string, ctx: DayContext): DailyAttendanceSummary {
  if (ctx.hireCivilDate && civilDate < ctx.hireCivilDate) return emptySummary(organizationId, employeeId, civilDate, null);
  if (ctx.separationCivilDate && civilDate >= ctx.separationCivilDate) return emptySummary(organizationId, employeeId, civilDate, null);

  if (ctx.holidayDates.has(civilDate)) return emptySummary(organizationId, employeeId, civilDate, "holiday");
  if (!isConfiguredWorkDay(civilDate, ctx.workDays)) return emptySummary(organizationId, employeeId, civilDate, "non_working_day");
  if (ctx.approvedLeaveDates.has(civilDate)) return emptySummary(organizationId, employeeId, civilDate, "on_leave");

  const wholeDayAdjustment = ctx.wholeDayAdjustmentByDate.get(civilDate);
  if (wholeDayAdjustment) {
    return emptySummary(organizationId, employeeId, civilDate, resolveWholeDayAdjustmentStatus(wholeDayAdjustment.adjustmentType));
  }

  const rawEvents = ctx.eventsByDate.get(civilDate) ?? { firstClockIn: null, lastClockOut: null };
  const manualIn = ctx.manualClockInByDate.get(civilDate);
  const manualOut = ctx.manualClockOutByDate.get(civilDate);
  const effectiveFirstClockIn = manualIn?.correctedClockIn ?? rawEvents.firstClockIn;
  const effectiveLastClockOut = manualOut?.correctedClockOut ?? rawEvents.lastClockOut;

  const derived = computeEventDerivedStatus({
    firstClockIn: effectiveFirstClockIn,
    lastClockOut: effectiveLastClockOut,
    workStartTime: ctx.workStartTime,
    workEndTime: ctx.workEndTime,
    gracePeriodMinutes: ctx.gracePeriodMinutes,
    timezone: ctx.timezone,
  });

  if (derived.status === "absent" && (ctx.employmentStatus === "on_leave" || ctx.employmentStatus === "suspended")) {
    return emptySummary(organizationId, employeeId, civilDate, null);
  }

  return {
    organizationId,
    employeeId,
    date: civilDate,
    status: derived.status,
    firstClockIn: effectiveFirstClockIn,
    lastClockOut: effectiveLastClockOut,
    workedMinutes: derived.workedMinutes,
    lateMinutes: derived.lateMinutes,
    earlyDepartureMinutes: derived.earlyDepartureMinutes,
  };
}

function civilDatesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.getTime() <= new Date(`${to}T00:00:00Z`).getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function validateRange(from: string, to: string): string[] {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new InvalidAttendanceSummaryRangeError("from and to must be in YYYY-MM-DD format");
  }
  if (from > to) {
    throw new InvalidAttendanceSummaryRangeError("from must not be after to");
  }
  const dates = civilDatesInRange(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    throw new InvalidAttendanceSummaryRangeError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  return dates;
}

export interface AttendanceRegisterRow {
  employeeId: number;
  summaries: DailyAttendanceSummary[];
}

/**
 * Batched multi-employee daily summary — the shared core both the
 * single-employee W66 route (`getAttendanceDailySummaryRange` below, a thin
 * wrapper over this) and the W69 register consume, per the frozen plan's
 * own "reuse/refactor W66 service carefully rather than copying its logic"
 * instruction. Fetches everything a [from, to] range needs in a fixed small
 * number of queries *regardless of how many employees are requested*
 * (employees, general config, attendance config, events, adjustments,
 * leave, holidays — 7 total, batched via `inArray` rather than one round
 * of queries per employee), then computes every (employee, date) pair
 * in-memory via the same pure `computeDailySummaryForDate` W66 already
 * established. Avoids both per-day and per-employee queries.
 *
 * `employeeIds` that don't resolve to a real employee in this organization
 * are silently dropped from the result (the caller — a route handler — is
 * expected to have already resolved a valid, authorized employee set;
 * `getAttendanceDailySummaryRange`'s own wrapper below restores a hard
 * "not found" error for its single-employee contract).
 */
export async function getAttendanceRegisterForEmployees(
  organizationId: number,
  employeeIds: number[],
  from: string,
  to: string,
): Promise<AttendanceRegisterRow[]> {
  const dates = validateRange(from, to);
  if (employeeIds.length === 0) return [];

  const employees = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.id, employeeIds)));
  if (employees.length === 0) return [];
  const resolvedEmployeeIds = employees.map((e) => e.id);

  const [generalConfig, attendanceConfig] = await Promise.all([
    getNamespaceConfig(organizationId, "general"),
    getNamespaceConfig(organizationId, "attendance"),
  ]);
  const timezone = generalConfig.data.timezone as string | undefined;
  if (!timezone) throw new OrganizationTimezoneNotConfiguredError();

  const workStartTime = attendanceConfig.data.workStartTime as string;
  const workEndTime = attendanceConfig.data.workEndTime as string;
  const gracePeriodMinutes = attendanceConfig.data.gracePeriodMinutes as number;
  const workDays = attendanceConfig.data.workDays as string[];

  // Padded by 1 day on each side so an event near the UTC boundary is never
  // missed regardless of the organization's UTC offset (max real-world
  // offset is well under 24h).
  const paddedFrom = new Date(`${from}T00:00:00Z`);
  paddedFrom.setUTCDate(paddedFrom.getUTCDate() - 1);
  const paddedTo = new Date(`${to}T00:00:00Z`);
  paddedTo.setUTCDate(paddedTo.getUTCDate() + 2);

  const [events, adjustments, leaveRequests, holidayDates] = await Promise.all([
    db
      .select()
      .from(attendanceEventsTable)
      .where(
        and(
          eq(attendanceEventsTable.organizationId, organizationId),
          inArray(attendanceEventsTable.employeeId, resolvedEmployeeIds),
          gte(attendanceEventsTable.occurredAt, paddedFrom),
          lte(attendanceEventsTable.occurredAt, paddedTo),
        ),
      ),
    db
      .select()
      .from(attendanceAdjustmentsTable)
      .where(
        and(
          eq(attendanceAdjustmentsTable.organizationId, organizationId),
          inArray(attendanceAdjustmentsTable.employeeId, resolvedEmployeeIds),
          eq(attendanceAdjustmentsTable.status, "approved"),
          gte(attendanceAdjustmentsTable.date, from),
          lte(attendanceAdjustmentsTable.date, to),
        ),
      ),
    db
      .select()
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.organizationId, organizationId),
          inArray(leaveRequestsTable.employeeId, resolvedEmployeeIds),
          eq(leaveRequestsTable.status, "approved"),
        ),
      ),
    resolveHolidayDatesInRange(organizationId, from, to),
  ]);

  const eventsByEmployeeDate = new Map<number, Map<string, { firstClockIn: Date | null; lastClockOut: Date | null }>>();
  for (const event of events) {
    const civilDate = deriveCivilDate(new Date(event.occurredAt), timezone);
    const eventsByDate = eventsByEmployeeDate.get(event.employeeId) ?? new Map();
    const bucket = eventsByDate.get(civilDate) ?? { firstClockIn: null, lastClockOut: null };
    const occurredAt = new Date(event.occurredAt);
    if (event.eventType === "clock_in" && (!bucket.firstClockIn || occurredAt < bucket.firstClockIn)) bucket.firstClockIn = occurredAt;
    if (event.eventType === "clock_out" && (!bucket.lastClockOut || occurredAt > bucket.lastClockOut)) bucket.lastClockOut = occurredAt;
    eventsByDate.set(civilDate, bucket);
    eventsByEmployeeDate.set(event.employeeId, eventsByDate);
  }

  // Most-recently-decided approved adjustment wins per (employee, date,
  // kind) when more than one exists for the same date.
  const wholeDayAdjustmentByEmployeeDate = new Map<number, Map<string, AttendanceAdjustment>>();
  const manualClockInByEmployeeDate = new Map<number, Map<string, AttendanceAdjustment>>();
  const manualClockOutByEmployeeDate = new Map<number, Map<string, AttendanceAdjustment>>();
  const isNewer = (a: AttendanceAdjustment, b?: AttendanceAdjustment) =>
    !b || (a.decidedAt && (!b.decidedAt || new Date(a.decidedAt) >= new Date(b.decidedAt)));
  const setLatest = (byEmployee: Map<number, Map<string, AttendanceAdjustment>>, adjustment: AttendanceAdjustment) => {
    const byDate = byEmployee.get(adjustment.employeeId) ?? new Map<string, AttendanceAdjustment>();
    if (isNewer(adjustment, byDate.get(adjustment.date))) byDate.set(adjustment.date, adjustment);
    byEmployee.set(adjustment.employeeId, byDate);
  };
  for (const adjustment of adjustments) {
    if (adjustment.adjustmentType === "manual_clock_in") setLatest(manualClockInByEmployeeDate, adjustment);
    else if (adjustment.adjustmentType === "manual_clock_out") setLatest(manualClockOutByEmployeeDate, adjustment);
    else setLatest(wholeDayAdjustmentByEmployeeDate, adjustment);
  }

  const approvedLeaveDatesByEmployee = new Map<number, Set<string>>();
  for (const request of leaveRequests) {
    if (request.startDate > to || request.endDate < from) continue;
    const leaveDates = approvedLeaveDatesByEmployee.get(request.employeeId) ?? new Set<string>();
    for (const civilDate of dates) {
      if (civilDate >= request.startDate && civilDate <= request.endDate) leaveDates.add(civilDate);
    }
    approvedLeaveDatesByEmployee.set(request.employeeId, leaveDates);
  }

  const emptyMap = new Map<string, never>();
  const emptySet = new Set<string>();

  return employees.map((employee) => {
    const hireCivilDate = employee.hireDate ? deriveCivilDate(new Date(employee.hireDate), timezone) : null;
    const separationCivilDate = employee.separationDate ? deriveCivilDate(new Date(employee.separationDate), timezone) : null;

    const ctx: DayContext = {
      hireCivilDate,
      separationCivilDate,
      employmentStatus: employee.employmentStatus,
      holidayDates,
      workDays,
      workStartTime,
      workEndTime,
      gracePeriodMinutes,
      timezone,
      approvedLeaveDates: approvedLeaveDatesByEmployee.get(employee.id) ?? emptySet,
      eventsByDate: eventsByEmployeeDate.get(employee.id) ?? emptyMap,
      wholeDayAdjustmentByDate: wholeDayAdjustmentByEmployeeDate.get(employee.id) ?? emptyMap,
      manualClockInByDate: manualClockInByEmployeeDate.get(employee.id) ?? emptyMap,
      manualClockOutByDate: manualClockOutByEmployeeDate.get(employee.id) ?? emptyMap,
    };

    return {
      employeeId: employee.id,
      summaries: dates.map((civilDate) => computeDailySummaryForDate(organizationId, employee.id, civilDate, ctx)),
    };
  });
}

export async function getAttendanceDailySummaryRange(
  organizationId: number,
  employeeId: number,
  from: string,
  to: string,
): Promise<DailyAttendanceSummary[]> {
  const [row] = await getAttendanceRegisterForEmployees(organizationId, [employeeId], from, to);
  if (!row) throw new EmployeeNotFoundError();
  return row.summaries;
}

export async function getAttendanceDailySummary(organizationId: number, employeeId: number, date: string): Promise<DailyAttendanceSummary> {
  if (!ISO_DATE.test(date)) throw new InvalidAttendanceSummaryRangeError("date must be in YYYY-MM-DD format");
  const [summary] = await getAttendanceDailySummaryRange(organizationId, employeeId, date, date);
  return summary;
}
