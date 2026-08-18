import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { recordAuditEvent } from "../lib/auditLog";
import { hasOrgWideAttendanceAccess, resolveAttendanceActorEmployeeId } from "../lib/attendanceAuthorization";
import {
  recordHrAttendanceAdjustment,
  recordEmployeeAttendanceAdjustmentRequest,
  approveAttendanceAdjustment,
  rejectAttendanceAdjustment,
  EmployeeNotFoundError,
  InvalidAttendanceAdjustmentError,
  AttendanceAdjustmentNotFoundError,
  AttendanceAdjustmentNotPendingError,
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
// One shared route, two branches (§3.4, W65 + W67) — the frozen plan's own
// W67 scope literally reuses this exact path for employee-initiated
// requests rather than adding a second endpoint. Coarse gate is
// attendance.read.own (every role has it, per the frozen plan's own
// permission line for W67 — "no new write key needed"); which branch runs
// is decided inside the handler by whether the caller holds
// attendance.manage, exactly the coarse-gate-plus-fine-grained-branch shape
// every other dual-tier route in this codebase already uses.
//
// HR direct entry (attendance.manage holder): unchanged from W65 —
// employeeId is caller-supplied (the target employee), auto-decided
// (status: "approved") in the same operation.
//
// Employee-initiated request (no attendance.manage): employeeId is always
// server-derived via resolveAttendanceActorEmployeeId — a client-supplied
// employeeId in the body is never trusted, exactly like W65's self-service
// clock event path. Always created "pending" — never auto-approves itself.
router.post(
  "/organizations/:organizationId/attendance-adjustments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
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
    const isHrDirectEntry = await hasOrgWideAttendanceAccess(req.membership!.id, "attendance.manage");

    try {
      if (isHrDirectEntry) {
        const employeeId = parseId(req.body?.employeeId);
        if (isNaN(employeeId)) {
          res.status(400).json({ error: "Invalid employeeId" });
          return;
        }

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
        // adjustments, auto-approved), since no route ever writes an
        // attendance_events row with source "hr_manual" (see W65's own
        // reconciliation note).
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
        return;
      }

      const ownEmployeeId = await resolveAttendanceActorEmployeeId(organizationId, req.userId!);
      if (ownEmployeeId == null) {
        res.status(403).json({ error: "No employee record is linked to this account" });
        return;
      }

      const adjustment = await recordEmployeeAttendanceAdjustmentRequest({
        organizationId,
        employeeId: ownEmployeeId,
        date,
        adjustmentType,
        correctedClockIn,
        correctedClockOut,
        reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
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

// POST /organizations/:organizationId/attendance-adjustments/:id/approve
// POST /organizations/:organizationId/attendance-adjustments/:id/reject
// Org-wide only (Open Decision 3 — no delegated/manager-tier approval for
// W67); attendance.adjustment.approve is already seeded org_admin/
// hr_manager only, so holding it at all is the full authorization scope —
// no additional per-target-employee tier check, mirroring how
// requisition.approve's own org-wide-only precedent needs none either.
router.post(
  "/organizations/:organizationId/attendance-adjustments/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.adjustment.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const adjustmentId = parseId(req.params.id);
    if (isNaN(adjustmentId)) {
      res.status(400).json({ error: "Invalid adjustment ID" });
      return;
    }

    try {
      const adjustment = await approveAttendanceAdjustment({
        organizationId: req.membership!.organizationId,
        adjustmentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(adjustment);
    } catch (err) {
      if (err instanceof AttendanceAdjustmentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AttendanceAdjustmentNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/attendance-adjustments/:id/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.adjustment.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const adjustmentId = parseId(req.params.id);
    if (isNaN(adjustmentId)) {
      res.status(400).json({ error: "Invalid adjustment ID" });
      return;
    }

    try {
      const adjustment = await rejectAttendanceAdjustment({
        organizationId: req.membership!.organizationId,
        adjustmentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(adjustment);
    } catch (err) {
      if (err instanceof AttendanceAdjustmentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AttendanceAdjustmentNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
