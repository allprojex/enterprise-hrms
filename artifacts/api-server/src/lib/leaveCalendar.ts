/**
 * Leave Calendar (Phase 2B, W36): a read model over W33's leave_requests —
 * never a second source of truth. No new table, no cache, nothing written
 * here; every field returned is derived live from requests already filtered
 * to status "approved". Mirrors W17's Reporting Foundation approach
 * (computed in application code from existing tables) rather than inventing
 * a calendar-specific query engine. Overlap is computed the same way W33's
 * own overlap check already does — plain "YYYY-MM-DD" string comparison,
 * safe because ISO date strings sort lexicographically in chronological
 * order (no gte/lte needed, no timezone conversion possible since these
 * columns have no time-of-day component).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, leaveRequestsTable, leaveTypesTable, employeesTable } from "@workspace/db";

export class InvalidCalendarRangeError extends Error {}

const MAX_RANGE_DAYS = 100;

export interface LeaveCalendarEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  leaveTypeId: number;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  daysRequested: string;
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

/**
 * Requests employed by `visibleEmployeeIds` (own + direct reports) if given,
 * or every employee in the organization when null (org-wide authority) —
 * caller resolves that tier, not this function (Architecture Principle 5:
 * authorization is re-derived at the route, not assumed from the module).
 * Only the minimum identity fields the calendar UI needs are returned —
 * never `reason`, `attachmentDocumentId`, ledger, or approval comments.
 */
export async function listLeaveCalendar(params: {
  organizationId: number;
  from: string;
  to: string;
  departmentId?: number;
  branchId?: number;
  visibleEmployeeIds: number[] | null;
}): Promise<LeaveCalendarEntry[]> {
  if (params.from > params.to) {
    throw new InvalidCalendarRangeError("from must not be after to");
  }
  if (daysBetween(params.from, params.to) > MAX_RANGE_DAYS) {
    throw new InvalidCalendarRangeError(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }

  let allowedEmployeeIds = params.visibleEmployeeIds;
  if (params.departmentId != null || params.branchId != null) {
    const conditions = [eq(employeesTable.organizationId, params.organizationId)];
    if (params.departmentId != null) conditions.push(eq(employeesTable.departmentId, params.departmentId));
    if (params.branchId != null) conditions.push(eq(employeesTable.branchId, params.branchId));
    const matched = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(...conditions));
    const matchedIds = matched.map((e) => e.id);
    allowedEmployeeIds = allowedEmployeeIds == null ? matchedIds : allowedEmployeeIds.filter((id) => matchedIds.includes(id));
  }
  if (allowedEmployeeIds != null && allowedEmployeeIds.length === 0) return [];

  const conditions = [eq(leaveRequestsTable.organizationId, params.organizationId), eq(leaveRequestsTable.status, "approved")];
  if (allowedEmployeeIds != null) conditions.push(inArray(leaveRequestsTable.employeeId, allowedEmployeeIds));

  const candidates = await db.select().from(leaveRequestsTable).where(and(...conditions));
  const overlapping = candidates.filter((r) => r.startDate <= params.to && r.endDate >= params.from);
  if (overlapping.length === 0) return [];

  const employeeIds = [...new Set(overlapping.map((r) => r.employeeId))];
  const leaveTypeIds = [...new Set(overlapping.map((r) => r.leaveTypeId))];
  const [employees, leaveTypes] = await Promise.all([
    db
      .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
      .from(employeesTable)
      .where(inArray(employeesTable.id, employeeIds)),
    db.select({ id: leaveTypesTable.id, name: leaveTypesTable.name }).from(leaveTypesTable).where(inArray(leaveTypesTable.id, leaveTypeIds)),
  ]);
  const employeeNameById = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const leaveTypeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));

  return overlapping
    .map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: employeeNameById.get(r.employeeId) ?? `Employee #${r.employeeId}`,
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: leaveTypeNameById.get(r.leaveTypeId) ?? `Type #${r.leaveTypeId}`,
      startDate: r.startDate,
      endDate: r.endDate,
      daysRequested: r.daysRequested,
    }))
    .sort((a, b) => (a.startDate === b.startDate ? a.employeeName.localeCompare(b.employeeName) : a.startDate < b.startDate ? -1 : 1));
}
