/**
 * Attendance Adjustments — HR Direct-Entry (Phase 3B, W65): the
 * `attendance.manage`-gated half of §3.4's correction model. W65 owns only
 * the HR-privileged direct-entry path — auto-decided in the same
 * transaction it's created (`status: "approved"`, `decidedByMembershipId =
 * requestedByMembershipId`, immediately), per §3.4's own explicit rule.
 * The employee-initiated request→approve path (`status: "pending"`,
 * decided later by an `attendance.adjustment.approve` holder) is W67 — not
 * built here.
 *
 * `reason` is always required, never optional, per §3.4's explicit "reason
 * required" (never overridden by adjustment type). `correctedClockIn`/
 * `correctedClockOut` are required only for the matching clock-correction
 * type; other types (mark_present/mark_absent/excuse_absence) are whole-day
 * markers and carry neither.
 */
import { db, attendanceAdjustmentsTable, type AttendanceAdjustment } from "@workspace/db";
import { getEmployeeById } from "./employees";

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundError";
  }
}

export class InvalidAttendanceAdjustmentError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AttendanceAdjustmentType = "manual_clock_in" | "manual_clock_out" | "mark_present" | "mark_absent" | "excuse_absence";

export async function recordHrAttendanceAdjustment(params: {
  organizationId: number;
  employeeId: number;
  date: string;
  adjustmentType: AttendanceAdjustmentType;
  correctedClockIn?: Date | null;
  correctedClockOut?: Date | null;
  reason: string;
  actorMembershipId: number;
}): Promise<AttendanceAdjustment> {
  const employee = await getEmployeeById(params.organizationId, params.employeeId);
  if (!employee) throw new EmployeeNotFoundError();

  if (!ISO_DATE.test(params.date)) {
    throw new InvalidAttendanceAdjustmentError("date must be in YYYY-MM-DD format");
  }
  if (!params.reason || !params.reason.trim()) {
    throw new InvalidAttendanceAdjustmentError("reason is required");
  }
  if (params.adjustmentType === "manual_clock_in" && !params.correctedClockIn) {
    throw new InvalidAttendanceAdjustmentError("correctedClockIn is required for adjustmentType manual_clock_in");
  }
  if (params.adjustmentType === "manual_clock_out" && !params.correctedClockOut) {
    throw new InvalidAttendanceAdjustmentError("correctedClockOut is required for adjustmentType manual_clock_out");
  }

  const now = new Date();
  const [adjustment] = await db
    .insert(attendanceAdjustmentsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      date: params.date,
      adjustmentType: params.adjustmentType,
      correctedClockIn: params.adjustmentType === "manual_clock_in" ? (params.correctedClockIn ?? null) : null,
      correctedClockOut: params.adjustmentType === "manual_clock_out" ? (params.correctedClockOut ?? null) : null,
      reason: params.reason,
      status: "approved",
      requestedByMembershipId: params.actorMembershipId,
      decidedByMembershipId: params.actorMembershipId,
      decidedAt: now,
    })
    .returning();

  return adjustment;
}
