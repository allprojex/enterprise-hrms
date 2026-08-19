/**
 * Attendance Register (Phase 3B, W69): the internal HR/manager list view,
 * per docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md's own W69 scope — a
 * view over W66's read-model, never a second summary engine, never a
 * persisted register table. Authorization scope (own/team/organization-
 * wide) is resolved here exactly once per request via
 * attendanceAuthorization.ts's existing tiers; the actual day-by-day
 * status computation is 100% delegated to attendanceDailySummary.ts's
 * getAttendanceRegisterForEmployees, which this file never duplicates.
 *
 * Pagination is over *employees*, not (employee, date) rows — reuses
 * lib/employees.ts's own listEmployees pagination shape (`{items, total,
 * page, pageSize}`) exactly. Direct-report ("team") scope is resolved via
 * employees.reportingManagerId, the same service-layer mechanism
 * leaveCalendar.ts's own visibleEmployeeIds already established — no
 * attendance.read.team permission exists or is added (§4's own explicit
 * "no new key" rule).
 *
 * A `departmentId`/`branchId`/`employeeId` filter can only ever *narrow*
 * the caller's already-resolved authorized scope (SQL AND, never OR) — a
 * manager filtering by employeeId=<not-a-direct-report> yields zero rows,
 * never a broadened result, matching this codebase's "a filter must never
 * broaden access" convention already used throughout Leave/Recruitment.
 *
 * `status` filtering happens after summaries are computed for the current
 * page (a row is kept if at least one of its computed days matches) —
 * `total` reflects the employee-level scope/filter count only, before
 * status filtering, the same documented tradeoff a naive single-pass
 * pagination over a *computed* field always has; deeper status-aware
 * aggregation belongs to W70's reporting layer, not this first register
 * cut.
 */
import { and, eq, inArray, count } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import {
  getAttendanceRegisterForEmployees,
  type AttendanceRegisterRow,
  type AttendanceSummaryStatus,
} from "./attendanceDailySummary";

export class InvalidAttendanceRegisterFilterError extends Error {}

const ATTENDANCE_SUMMARY_STATUSES: readonly AttendanceSummaryStatus[] = [
  "present",
  "late",
  "partial",
  "absent",
  "on_leave",
  "holiday",
  "non_working_day",
];

export interface AttendanceRegisterResult {
  items: AttendanceRegisterRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAttendanceRegister(params: {
  organizationId: number;
  from: string;
  to: string;
  scope: "org_wide" | { allowedEmployeeIds: number[] };
  employeeId?: number;
  departmentId?: number;
  branchId?: number;
  status?: string;
  page: number;
  pageSize: number;
}): Promise<AttendanceRegisterResult> {
  if (params.status !== undefined && !ATTENDANCE_SUMMARY_STATUSES.includes(params.status as AttendanceSummaryStatus)) {
    throw new InvalidAttendanceRegisterFilterError(`status must be one of ${ATTENDANCE_SUMMARY_STATUSES.join(", ")}`);
  }

  if (params.scope !== "org_wide" && params.scope.allowedEmployeeIds.length === 0) {
    // A manager with zero direct reports (and no own-employee identity) has
    // a valid, empty authorized scope — not an error, not an org-wide
    // fallback.
    return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
  }

  const conditions = [eq(employeesTable.organizationId, params.organizationId)];
  if (params.scope !== "org_wide") conditions.push(inArray(employeesTable.id, params.scope.allowedEmployeeIds));
  if (params.departmentId != null) conditions.push(eq(employeesTable.departmentId, params.departmentId));
  if (params.branchId != null) conditions.push(eq(employeesTable.branchId, params.branchId));
  if (params.employeeId != null) conditions.push(eq(employeesTable.id, params.employeeId));
  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(employeesTable).where(where);
  const total = totalRow?.value ?? 0;

  const page = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(where)
    .orderBy(employeesTable.id)
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);

  if (page.length === 0) {
    return { items: [], total, page: params.page, pageSize: params.pageSize };
  }

  const rows = await getAttendanceRegisterForEmployees(
    params.organizationId,
    page.map((e) => e.id),
    params.from,
    params.to,
  );

  const items = params.status ? rows.filter((row) => row.summaries.some((s) => s.status === params.status)) : rows;

  return { items, total, page: params.page, pageSize: params.pageSize };
}
