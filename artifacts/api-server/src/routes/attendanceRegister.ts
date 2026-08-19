import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { resolveAttendanceActorEmployeeId, hasOrgWideAttendanceAccess } from "../lib/attendanceAuthorization";
import {
  getAttendanceRegister,
  InvalidAttendanceRegisterFilterError,
} from "../lib/attendanceRegister";
import { InvalidAttendanceSummaryRangeError, OrganizationTimezoneNotConfiguredError } from "../lib/attendanceDailySummary";

const router = Router();

function parseOptionalId(raw: string | string[] | undefined): number | undefined | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function parsePositiveInt(raw: string | string[] | undefined, fallback: number): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 1 ? null : parsed;
}

// GET /organizations/:organizationId/attendance?from=&to=&employeeId=&departmentId=&branchId=&status=&page=&pageSize=
// Coarse gate is attendance.read.own (every role has it, per the frozen
// plan's own W69 permission line: "own/team-scoped register") — the actual
// visible employee set is resolved below: organization-wide for
// attendance.manage holders, own + direct reports (employees.
// reportingManagerId) otherwise, mirroring leaveCalendar.ts's own
// visibleEmployeeIds pattern exactly. Built on W66's read-model — see
// lib/attendanceRegister.ts / lib/attendanceDailySummary.ts.
router.get(
  "/organizations/:organizationId/attendance",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("attendance"),
  requirePermission("attendance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (!from || !to) {
      res.status(400).json({ error: "from and to are required query parameters in YYYY-MM-DD format" });
      return;
    }

    const employeeId = parseOptionalId(req.query.employeeId as string | string[] | undefined);
    const departmentId = parseOptionalId(req.query.departmentId as string | string[] | undefined);
    const branchId = parseOptionalId(req.query.branchId as string | string[] | undefined);
    if (employeeId === null || departmentId === null || branchId === null) {
      res.status(400).json({ error: "Invalid employeeId, departmentId, or branchId" });
      return;
    }

    const page = parsePositiveInt(req.query.page as string | string[] | undefined, 1);
    const pageSize = parsePositiveInt(req.query.pageSize as string | string[] | undefined, 20);
    if (page === null || pageSize === null || pageSize > 200) {
      res.status(400).json({ error: "Invalid page or pageSize (pageSize max 200)" });
      return;
    }

    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const organizationId = req.membership!.organizationId;
    const isOrgWide = await hasOrgWideAttendanceAccess(req.membership!.id, "attendance.manage");

    let scope: "org_wide" | { allowedEmployeeIds: number[] };
    if (isOrgWide) {
      scope = "org_wide";
    } else {
      const ownEmployeeId = await resolveAttendanceActorEmployeeId(organizationId, req.userId!);
      const managed = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, ownEmployeeId ?? -1)));
      scope = { allowedEmployeeIds: [...(ownEmployeeId != null ? [ownEmployeeId] : []), ...managed.map((e) => e.id)] };
    }

    try {
      const result = await getAttendanceRegister({
        organizationId,
        from,
        to,
        scope,
        employeeId,
        departmentId,
        branchId,
        status,
        page,
        pageSize,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof InvalidAttendanceRegisterFilterError || err instanceof InvalidAttendanceSummaryRangeError) {
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
