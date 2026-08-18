import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { getEmployeeById } from "../lib/employees";
import {
  resolveAttendanceActorEmployeeId,
  hasOrgWideAttendanceAccess,
  isOwnAttendanceRecord,
  isReportingManagerOf,
  resolveAttendanceVisibilityScope,
} from "../lib/attendanceAuthorization";
import {
  recordSelfServiceClockEvent,
  listAttendanceEvents,
  EmployeeNotFoundError,
  AttendanceCaptureNotEligibleError,
} from "../lib/attendanceEvents";

const router = Router();

function parseOptionalId(raw: string | string[] | undefined): number | undefined | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

// POST /organizations/:organizationId/attendance-events
// Self-service only — the caller always clocks themselves. employeeId is
// never accepted from the client; it is resolved server-side via
// resolveAttendanceActorEmployeeId (employee_user_links), the same chain
// every other ESS-shaped endpoint in this codebase already reuses.
router.post(
  "/organizations/:organizationId/attendance-events",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.clock.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const eventType = req.body?.eventType;
    if (eventType !== "clock_in" && eventType !== "clock_out") {
      res.status(400).json({ error: "eventType must be clock_in or clock_out" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveAttendanceActorEmployeeId(organizationId, req.userId!);
    if (ownEmployeeId == null) {
      res.status(403).json({ error: "No employee record is linked to this account" });
      return;
    }

    try {
      const event = await recordSelfServiceClockEvent({ organizationId, employeeId: ownEmployeeId, eventType });
      res.status(201).json(event);
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AttendanceCaptureNotEligibleError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/attendance-events?employeeId=
// employeeId omitted -> caller's own history. employeeId supplied -> own,
// team (reportingManagerId), or organization-wide (attendance.manage) per
// §4 — the coarse route gate is attendance.read.own (every role has it),
// the actual visible set is refined below, mirroring leaveRequests.ts's
// own/manager/org-wide pattern exactly.
router.get(
  "/organizations/:organizationId/attendance-events",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const requestedEmployeeId = parseOptionalId(req.query.employeeId as string | string[] | undefined);
    if (requestedEmployeeId === null) {
      res.status(400).json({ error: "Invalid employeeId" });
      return;
    }

    const ownEmployeeId = await resolveAttendanceActorEmployeeId(organizationId, req.userId!);
    const targetEmployeeId = requestedEmployeeId ?? ownEmployeeId;
    if (targetEmployeeId == null) {
      res.status(403).json({ error: "No employee record is linked to this account" });
      return;
    }

    const target = await getEmployeeById(organizationId, targetEmployeeId);
    if (!target) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const isOrgWide = await hasOrgWideAttendanceAccess(req.membership!.id, "attendance.manage");
    const scope = resolveAttendanceVisibilityScope({
      isOrgWide,
      isOwn: isOwnAttendanceRecord(ownEmployeeId, targetEmployeeId),
      isManagerOfTarget: isReportingManagerOf(ownEmployeeId, target.reportingManagerId),
    });
    if (!scope) {
      res.status(403).json({ error: "Not authorized to view this employee's attendance events" });
      return;
    }

    const events = await listAttendanceEvents(organizationId, targetEmployeeId);
    res.json(events);
  },
);

export default router;
