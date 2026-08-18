import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { recordAuditEvent } from "../lib/auditLog";
import {
  recordHrAttendanceAdjustment,
  EmployeeNotFoundError,
  InvalidAttendanceAdjustmentError,
  type AttendanceAdjustmentType,
} from "../lib/attendanceAdjustments";

const router = Router();

const ADJUSTMENT_TYPES: readonly AttendanceAdjustmentType[] = [
  "manual_clock_in",
  "manual_clock_out",
  "mark_present",
  "mark_absent",
  "excuse_absence",
];

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function parseOptionalInstant(raw: unknown): Date | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// POST /organizations/:organizationId/attendance-adjustments
// HR direct-entry variant only (§3.4) — auto-decided (status: "approved")
// in the same operation it's created, since the actor already holds
// attendance.manage. The employee-initiated request->approve variant is
// W67, not built here. attendance.manage is this platform's existing
// org-wide tier (§4) — same as leave_request.manage, no additional
// per-target-employee authorization tier beyond organization membership.
router.post(
  "/organizations/:organizationId/attendance-adjustments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.body?.employeeId);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employeeId" });
      return;
    }

    const adjustmentType = req.body?.adjustmentType;
    if (!ADJUSTMENT_TYPES.includes(adjustmentType)) {
      res.status(400).json({ error: `adjustmentType must be one of ${ADJUSTMENT_TYPES.join(", ")}` });
      return;
    }

    const date = req.body?.date;
    if (typeof date !== "string") {
      res.status(400).json({ error: "date is required" });
      return;
    }

    const reason = req.body?.reason;
    if (typeof reason !== "string" || !reason.trim()) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const correctedClockIn = parseOptionalInstant(req.body?.correctedClockIn);
    const correctedClockOut = parseOptionalInstant(req.body?.correctedClockOut);
    if (correctedClockIn === null || correctedClockOut === null) {
      res.status(400).json({ error: "correctedClockIn/correctedClockOut must be valid timestamps when supplied" });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const adjustment = await recordHrAttendanceAdjustment({
        organizationId,
        employeeId,
        date,
        adjustmentType,
        correctedClockIn,
        correctedClockOut,
        reason,
        actorMembershipId: req.membership!.id,
      });

      // §8's Audit Plan names this event type for HR-manual attendance
      // entries — applied here to the W65 HR direct-entry mechanism the
      // frozen plan's own W65 section actually assigns (attendance_
      // adjustments, auto-approved), since no route in W65 ever writes an
      // attendance_events row with source "hr_manual" (see this
      // workstream's reconciliation note).
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "attendance_event.recorded",
        targetType: "attendance_adjustment",
        targetId: String(adjustment.id),
        afterState: {
          employeeId: adjustment.employeeId,
          date: adjustment.date,
          adjustmentType: adjustment.adjustmentType,
          status: adjustment.status,
        },
      });

      res.status(201).json(adjustment);
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidAttendanceAdjustmentError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
