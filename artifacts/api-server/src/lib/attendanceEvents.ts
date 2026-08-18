/**
 * Attendance Event Capture (Phase 3B, W65 — Self-Service Clocking + HR
 * Manual Entry): the first real capture path over W64's `attendance_events`
 * table (docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §10 W65). Employee
 * identity is always server-derived via `resolveOwnEmployeeId` (W14/W33) —
 * never a client-supplied employeeId, mirroring every ESS precedent in this
 * codebase. `occurredAt` is always the server's own clock for a self-service
 * punch — never trusted from the client (§3.5).
 *
 * Sequencing (Open Decision 1, §11): the frozen plan explicitly resolves
 * this — "not blocked at the database level... accidental rapid double-taps
 * are a client UX concern, not a server integrity concern requiring a hard
 * reject" (§3.8). A genuine multi-segment day (clock_in, clock_out,
 * clock_in, clock_out, ...) is valid, and so is a raw duplicate clock-in
 * with no intervening clock-out — this function does not inspect prior
 * events or reject any ordering. First-in/last-out interpretation is the
 * daily summary's concern (W66), never this table's own constraint.
 *
 * Employment-status eligibility (§3.7 "Attendance capture eligibility"
 * column) applies to self-service clocking only — an employee on_leave,
 * suspended, terminated, or not yet at their hireDate cannot self-clock.
 * HR direct-entry (attendanceAdjustments.ts) is not subject to this check —
 * an HR user may need to correct/record attendance for an employee whose
 * status has since changed.
 */
import { and, eq, desc } from "drizzle-orm";
import { db, attendanceEventsTable, type AttendanceEvent, type Employee } from "@workspace/db";
import { getEmployeeById } from "./employees";

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundError";
  }
}

export class AttendanceCaptureNotEligibleError extends Error {
  constructor() {
    super("Employee is not eligible to record attendance");
    this.name = "AttendanceCaptureNotEligibleError";
  }
}

const ELIGIBLE_EMPLOYMENT_STATUSES = new Set(["active", "probation"]);

/** §3.7's "Attendance capture eligibility" column, literally applied — self-service clocking only. */
export function isEligibleForSelfServiceCapture(employee: Pick<Employee, "employmentStatus" | "hireDate">, now: Date = new Date()): boolean {
  if (!ELIGIBLE_EMPLOYMENT_STATUSES.has(employee.employmentStatus)) return false;
  if (employee.hireDate && new Date(employee.hireDate) > now) return false;
  return true;
}

export async function recordSelfServiceClockEvent(params: {
  organizationId: number;
  employeeId: number;
  eventType: "clock_in" | "clock_out";
}): Promise<AttendanceEvent> {
  const employee = await getEmployeeById(params.organizationId, params.employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  if (!isEligibleForSelfServiceCapture(employee)) throw new AttendanceCaptureNotEligibleError();

  const [event] = await db
    .insert(attendanceEventsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      eventType: params.eventType,
      occurredAt: new Date(),
      source: "self_service",
      recordedByMembershipId: null,
      branchId: null,
      deviceReference: null,
      notes: null,
    })
    .returning();

  return event;
}

export async function listAttendanceEvents(organizationId: number, employeeId: number): Promise<AttendanceEvent[]> {
  return db
    .select()
    .from(attendanceEventsTable)
    .where(and(eq(attendanceEventsTable.organizationId, organizationId), eq(attendanceEventsTable.employeeId, employeeId)))
    .orderBy(desc(attendanceEventsTable.occurredAt));
}
