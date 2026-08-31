/**
 * Attendance Dashboard & Reporting (Phase 3B, W70):
 * docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md's own W70 frozen API line
 * (`GET .../attendance/dashboard`, `GET .../attendance/reports/:reportKey`).
 * Mirrors recruitmentReporting.ts's own route shape exactly — a dedicated,
 * visibility-scoped route rather than the generic GET .../reports/:key/run,
 * for the identical reason §7 gives for Recruitment: organization-wide vs.
 * own/team tiers the generic runner can't express. See
 * lib/attendanceReporting.ts for the full scope/aggregation logic.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { ATTENDANCE_MODULE_KEY } from "../lib/attendanceAuthorization";
import { getReportDefinition, toCsv } from "../lib/reporting";
import { InvalidAttendanceSummaryRangeError, OrganizationTimezoneNotConfiguredError } from "../lib/attendanceDailySummary";
import {
  resolveAttendanceReportScope,
  buildAttendanceReportContext,
  resolveOrganizationTodayCivilDate,
  getAttendanceDashboard,
  runAttendanceReport,
  isKnownAttendanceReportKey,
  AttendanceReportNotFoundError,
} from "../lib/attendanceReporting";

const router = Router();

// toCsv (formula-injection-safe) is now the shared lib/reporting.ts primitive
// (WS-1) — this file's own local, unhardened copy was removed.

// GET /organizations/:organizationId/attendance/dashboard?date=YYYY-MM-DD
router.get(
  "/organizations/:organizationId/attendance/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ATTENDANCE_MODULE_KEY),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;

    try {
      const date = typeof req.query.date === "string" ? req.query.date : await resolveOrganizationTodayCivilDate(organizationId);

      const scope = await resolveAttendanceReportScope({
        organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const ctx = await buildAttendanceReportContext(organizationId, scope);
      const dashboard = await getAttendanceDashboard(ctx, date);
      res.json(dashboard);
    } catch (err) {
      if (err instanceof InvalidAttendanceSummaryRangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OrganizationTimezoneNotConfiguredError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/attendance/reports/:reportKey?from=&to=&format=csv
router.get(
  "/organizations/:organizationId/attendance/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ATTENDANCE_MODULE_KEY),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only,
    // guarded to this route's own "attendance" category — mirrors
    // recruitmentReporting.ts's identical guard: an attendance key can never
    // be executed through the generic, non-scope-aware
    // GET .../reports/:reportKey/run (that route's RUNNERS map has no
    // entries for these keys and safely 404s instead).
    // WS-15 P3 (§31.30) UPDATE: this key IS now also executable through the
    // generic GET .../reports/:reportKey/run. That path delegates to this
    // module's own reporting service and resolves this module's own scope
    // resolver first, so it is no longer non-scope-aware and enforces the
    // same permission. This route is unchanged and remains authoritative for
    // its own contract; the two paths converge on the same source logic.
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "attendance" || !isKnownAttendanceReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown attendance report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const today = await resolveOrganizationTodayCivilDate(organizationId);
      const from = typeof req.query.from === "string" ? req.query.from : today;
      const to = typeof req.query.to === "string" ? req.query.to : today;

      const scope = await resolveAttendanceReportScope({
        organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const ctx = await buildAttendanceReportContext(organizationId, scope);

      const result = await runAttendanceReport({ key: definition.key, label: definition.label, description: definition.description, ctx, from, to });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof AttendanceReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidAttendanceSummaryRangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OrganizationTimezoneNotConfiguredError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
