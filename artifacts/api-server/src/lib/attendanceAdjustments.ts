/**
 * Attendance Adjustments — HR Direct-Entry (Phase 3B, W65) + Employee-
 * Initiated Requests & Approval (Phase 3B, W67): both halves of §3.4's
 * correction model over the single `attendance_adjustments` table — no
 * second correction table, no second workflow engine.
 *
 * HR direct-entry (`recordHrAttendanceAdjustment`, W65, unchanged by W67):
 * auto-decided in the same operation it's created (`status: "approved"`,
 * `decidedByMembershipId = requestedByMembershipId`), per §3.4's own
 * explicit rule for an actor who already holds `attendance.manage`.
 *
 * Employee-initiated requests (`recordEmployeeAttendanceAdjustmentRequest`,
 * W67): the same table, `status: "pending"`, decided later by a holder of
 * `attendance.adjustment.approve` via `decideAttendanceAdjustment` — never
 * auto-approves itself, per W67's own explicit testing requirement. Which
 * branch a given request took is always recoverable from its own row:
 * `status === "approved" && decidedAt.getTime() === createdAt.getTime()`-ish
 * timing is not the distinguishing signal — `requestedByMembershipId ===
 * decidedByMembershipId` at creation time is (HR direct-entry decides its
 * own request in the same call; an employee request's decidedByMembershipId
 * is null until someone else acts on it).
 *
 * `reason` is always required, never optional, per §3.4's explicit "reason
 * required" (never overridden by adjustment type, and identical for both
 * paths). `correctedClockIn`/`correctedClockOut` are required only for the
 * matching clock-correction type; other types (mark_present/mark_absent/
 * excuse_absence) are whole-day markers and carry neither.
 *
 * Decision concurrency (`decideAttendanceAdjustment`): a single conditional
 * `UPDATE ... WHERE status = 'pending'` takes the row atomically — mirrors
 * `leaveApprovals.ts`'s own approve/reject pattern (W35) exactly. A
 * concurrent second decision affects zero rows and throws
 * AttendanceAdjustmentNotPendingError rather than silently double-deciding;
 * no transaction wrapper is needed since, unlike Leave approval, there is no
 * secondary ledger write to coordinate.
 */
import { eq, and } from "drizzle-orm";
import { db, attendanceAdjustmentsTable, type AttendanceAdjustment } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getEmployeeById } from "./employees";

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundError";
  }
}

export class InvalidAttendanceAdjustmentError extends Error {}

export class AttendanceAdjustmentNotFoundError extends Error {
  constructor() {
    super("Attendance adjustment not found");
    this.name = "AttendanceAdjustmentNotFoundError";
  }
}

export class AttendanceAdjustmentNotPendingError extends Error {
  constructor() {
    super("Attendance adjustment is not pending — it may already have been decided");
    this.name = "AttendanceAdjustmentNotPendingError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AttendanceAdjustmentType = "manual_clock_in" | "manual_clock_out" | "mark_present" | "mark_absent" | "excuse_absence";

interface ValidatedAdjustmentInput {
  organizationId: number;
  employeeId: number;
  date: string;
  adjustmentType: AttendanceAdjustmentType;
  correctedClockIn: Date | null;
  correctedClockOut: Date | null;
  reason: string;
}

/** Shared validation for both the HR direct-entry and employee-request paths — the schema/reason/field rules never differ by who is submitting. */
async function validateAdjustmentInput(params: {
  organizationId: number;
  employeeId: number;
  date: string;
  adjustmentType: AttendanceAdjustmentType;
  correctedClockIn?: Date | null;
  correctedClockOut?: Date | null;
  reason: string;
}): Promise<ValidatedAdjustmentInput> {
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

  return {
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    date: params.date,
    adjustmentType: params.adjustmentType,
    correctedClockIn: params.adjustmentType === "manual_clock_in" ? (params.correctedClockIn ?? null) : null,
    correctedClockOut: params.adjustmentType === "manual_clock_out" ? (params.correctedClockOut ?? null) : null,
    reason: params.reason,
  };
}

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
  const validated = await validateAdjustmentInput(params);
  const now = new Date();

  const [adjustment] = await db
    .insert(attendanceAdjustmentsTable)
    .values({
      ...validated,
      status: "approved",
      requestedByMembershipId: params.actorMembershipId,
      decidedByMembershipId: params.actorMembershipId,
      decidedAt: now,
    })
    .returning();

  return adjustment;
}

/**
 * Employee-initiated correction request (W67) — always created `pending`,
 * never auto-approved. `employeeId` must already be the caller's own
 * server-derived identity by the time this is called (the route resolves
 * it, exactly like W65's self-service clock event path — never trusted
 * from the request body here).
 */
export async function recordEmployeeAttendanceAdjustmentRequest(params: {
  organizationId: number;
  employeeId: number;
  date: string;
  adjustmentType: AttendanceAdjustmentType;
  correctedClockIn?: Date | null;
  correctedClockOut?: Date | null;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<AttendanceAdjustment> {
  const validated = await validateAdjustmentInput(params);

  const [adjustment] = await db
    .insert(attendanceAdjustmentsTable)
    .values({
      ...validated,
      status: "pending",
      requestedByMembershipId: params.actorMembershipId,
      decidedByMembershipId: null,
      decidedAt: null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "attendance_adjustment.requested",
    targetType: "attendance_adjustment",
    targetId: String(adjustment.id),
    afterState: { employeeId: adjustment.employeeId, date: adjustment.date, adjustmentType: adjustment.adjustmentType, status: adjustment.status },
  });

  return adjustment;
}

async function decideAttendanceAdjustment(params: {
  organizationId: number;
  adjustmentId: number;
  decision: "approved" | "rejected";
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<AttendanceAdjustment> {
  const [before] = await db
    .select()
    .from(attendanceAdjustmentsTable)
    .where(and(eq(attendanceAdjustmentsTable.id, params.adjustmentId), eq(attendanceAdjustmentsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new AttendanceAdjustmentNotFoundError();

  const [updated] = await db
    .update(attendanceAdjustmentsTable)
    .set({ status: params.decision, decidedByMembershipId: params.actorMembershipId, decidedAt: new Date() })
    .where(
      and(
        eq(attendanceAdjustmentsTable.id, params.adjustmentId),
        eq(attendanceAdjustmentsTable.organizationId, params.organizationId),
        eq(attendanceAdjustmentsTable.status, "pending"),
      ),
    )
    .returning();
  if (!updated) throw new AttendanceAdjustmentNotPendingError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.decision === "approved" ? "attendance_adjustment.approved" : "attendance_adjustment.rejected",
    targetType: "attendance_adjustment",
    targetId: String(updated.id),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export async function approveAttendanceAdjustment(params: {
  organizationId: number;
  adjustmentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<AttendanceAdjustment> {
  return decideAttendanceAdjustment({ ...params, decision: "approved" });
}

export async function rejectAttendanceAdjustment(params: {
  organizationId: number;
  adjustmentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<AttendanceAdjustment> {
  return decideAttendanceAdjustment({ ...params, decision: "rejected" });
}
