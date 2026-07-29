import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { listLeaveCalendar, InvalidCalendarRangeError } from "../lib/leaveCalendar";

const router = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseOptionalId(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? NaN : parsed;
}

// GET /organizations/:organizationId/leave-calendar?from=&to=&departmentId=&branchId=
// Coarse gate is leave_request.read.own (every role has it, including plain
// "employee") — the actual visible set is derived per-caller below, mirroring
// W33/W35's own/manager/org-wide pattern rather than a single blanket check.
router.get(
  "/organizations/:organizationId/leave-calendar",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_request.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      res.status(400).json({ error: "from and to are required query parameters in YYYY-MM-DD format" });
      return;
    }

    const departmentId = parseOptionalId(req.query.departmentId as string | string[] | undefined);
    const branchId = parseOptionalId(req.query.branchId as string | string[] | undefined);
    if (Number.isNaN(departmentId) || Number.isNaN(branchId)) {
      res.status(400).json({ error: "Invalid departmentId or branchId" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const isOrgWide = await hasPermission(req.membership!.id, "leave_request.manage");

    let visibleEmployeeIds: number[] | null = null;
    if (!isOrgWide) {
      const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
      const managed = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, ownEmployeeId ?? -1)));
      visibleEmployeeIds = [...(ownEmployeeId != null ? [ownEmployeeId] : []), ...managed.map((e) => e.id)];
    }

    try {
      const entries = await listLeaveCalendar({
        organizationId,
        from,
        to,
        departmentId,
        branchId,
        visibleEmployeeIds,
      });
      res.json(entries);
    } catch (err) {
      if (err instanceof InvalidCalendarRangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
