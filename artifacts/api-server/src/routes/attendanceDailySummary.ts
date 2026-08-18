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
  getAttendanceDailySummary,
  getAttendanceDailySummaryRange,
  EmployeeNotFoundError,
  OrganizationTimezoneNotConfiguredError,
  InvalidAttendanceSummaryRangeError,
} from "../lib/attendanceDailySummary";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/employees/:employeeId/attendance/summary?date=
//   or  ?from=&to=
// Single-date and range modes share one route (a design choice within the
// frozen plan's own "GET .../summary (single date) and a date-range
// variant" line — both modes reuse the identical auth/module/scope gate,
// so composing them as one route avoids duplicating that gate across two
// near-identical handlers). Coarse gate is attendance.read.own (every role
// has it), the actual own/team/organization-wide visibility is refined
// below, mirroring attendanceEvents.ts's own GET route exactly.
router.get(
  "/organizations/:organizationId/employees/:employeeId/attendance/summary",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const target = await getEmployeeById(organizationId, employeeId);
    if (!target) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const ownEmployeeId = await resolveAttendanceActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWideAttendanceAccess(req.membership!.id, "attendance.manage");
    const scope = resolveAttendanceVisibilityScope({
      isOrgWide,
      isOwn: isOwnAttendanceRecord(ownEmployeeId, employeeId),
      isManagerOfTarget: isReportingManagerOf(ownEmployeeId, target.reportingManagerId),
    });
    if (!scope) {
      res.status(403).json({ error: "Not authorized to view this employee's attendance summary" });
      return;
    }

    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    try {
      if (date) {
        const summary = await getAttendanceDailySummary(organizationId, employeeId, date);
        res.json(summary);
        return;
      }
      if (from && to) {
        const summaries = await getAttendanceDailySummaryRange(organizationId, employeeId, from, to);
        res.json(summaries);
        return;
      }
      res.status(400).json({ error: "Provide either date, or both from and to, as YYYY-MM-DD" });
    } catch (err) {
      if (err instanceof InvalidAttendanceSummaryRangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OrganizationTimezoneNotConfiguredError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
