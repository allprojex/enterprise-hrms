/**
 * Attendance Dashboard & Reporting (Phase 3B, W70):
 * docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §7/§10 (W70 row). Purely
 * read-only aggregation over W66's existing daily-summary read-model
 * (attendanceDailySummary.ts) — no second business-rules engine, no
 * persisted dashboard/report table, nothing mutated by any function here.
 *
 * Visibility mirrors W69's Register exactly (own/team/organization-wide via
 * attendanceAuthorization.ts, no new permission key): organization-wide
 * reach is signaled by `attendance.manage`; otherwise the caller sees only
 * themselves plus their direct reports (employees.reportingManagerId),
 * resolved the identical way attendanceRegister.ts's route already does.
 * That resolution is intentionally re-implemented here rather than imported
 * from routes/attendanceRegister.ts, so this new workstream never risks
 * altering W69's existing route/behavior (the master prompt's own "preserve
 * W69's API contract unless explicitly approved" instruction) — the ~10
 * lines of duplication is the deliberate cost of that isolation.
 *
 * Aggregate privacy: a manager's dashboard/report context is built from
 * only their own authorized employee scope — the same rows W69's Register
 * would show them, never more. There is no "aggregate-only" bypass that
 * reaches beyond row-level visibility.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, employeesTable, departmentsTable } from "@workspace/db";
import { resolveAttendanceActorEmployeeId, hasOrgWideAttendanceAccess } from "./attendanceAuthorization";
import { listLiveDirectReportEmployeeIds } from "./directReports";
import { getNamespaceConfig } from "../services/organizationConfig";
import {
  getAttendanceRegisterForEmployees,
  deriveCivilDate,
  OrganizationTimezoneNotConfiguredError,
  type AttendanceSummaryStatus,
} from "./attendanceDailySummary";
import { ATTENDANCE_SUMMARY_STATUSES } from "./attendanceRegister";

export class AttendanceReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown attendance report "${key}"`);
    this.name = "AttendanceReportNotFoundError";
  }
}

// --- Visibility scope (mirrors attendanceRegister.ts's route-level resolution) ---

export interface AttendanceReportScope {
  isOrgWide: boolean;
  allowedEmployeeIds: number[];
}

export async function resolveAttendanceReportScope(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<AttendanceReportScope> {
  const isOrgWide = await hasOrgWideAttendanceAccess(params.membershipId, "attendance.manage");
  if (isOrgWide) return { isOrgWide: true, allowedEmployeeIds: [] };

  const ownEmployeeId = await resolveAttendanceActorEmployeeId(params.organizationId, params.applicationUserId);
  // WS-16 Pass 2A (§32.9 #3): the shared live helper replaces the inline
  // query, including the old `?? -1` sentinel — a null actor now yields an
  // empty set through the helper's own contract rather than through an id
  // that happens to match no row. Self-inclusion stays here, where it
  // belongs: the caller decides its own scope, the helper only reports the
  // relationship.
  const managed = await listLiveDirectReportEmployeeIds(params.organizationId, ownEmployeeId);
  return {
    isOrgWide: false,
    allowedEmployeeIds: [...(ownEmployeeId != null ? [ownEmployeeId] : []), ...managed],
  };
}

// --- Scoped report context (employees resolved once, reused by dashboard + every report) ---

interface ScopedEmployee {
  id: number;
  firstName: string;
  lastName: string;
  departmentId: number | null;
}

export interface AttendanceReportContext {
  organizationId: number;
  scope: AttendanceReportScope;
  employees: ScopedEmployee[];
  employeeNameById: Map<number, string>;
  departmentNameById: Map<number, string>;
}

export async function buildAttendanceReportContext(organizationId: number, scope: AttendanceReportScope): Promise<AttendanceReportContext> {
  let employees: ScopedEmployee[];
  if (scope.isOrgWide) {
    employees = await db
      .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, departmentId: employeesTable.departmentId })
      .from(employeesTable)
      .where(eq(employeesTable.organizationId, organizationId));
  } else if (scope.allowedEmployeeIds.length === 0) {
    // A manager with zero direct reports (and no own-employee identity) has
    // a valid, empty authorized scope — not an error, not an org-wide
    // fallback, matching W69's Register precedent exactly.
    employees = [];
  } else {
    employees = await db
      .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, departmentId: employeesTable.departmentId })
      .from(employeesTable)
      .where(and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.id, scope.allowedEmployeeIds)));
  }

  const departmentIds = [...new Set(employees.map((e) => e.departmentId).filter((id): id is number => id != null))];
  const departments = departmentIds.length
    ? await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds))
    : [];

  return {
    organizationId,
    scope,
    employees,
    employeeNameById: new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])),
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
  };
}

/** Organization-local "today" (never browser-local) — resolved from the same general.timezone W66/W69 already require. */
export async function resolveOrganizationTodayCivilDate(organizationId: number): Promise<string> {
  const generalConfig = await getNamespaceConfig(organizationId, "general");
  const timezone = generalConfig.data.timezone as string | undefined;
  if (!timezone) throw new OrganizationTimezoneNotConfiguredError();
  return deriveCivilDate(new Date(), timezone);
}

// --- Dashboard (GET .../attendance/dashboard) ---

/**
 * All 7 W66 statuses plus the null ("not applicable") bucket, in a fixed,
 * deterministic display order — zero-filled so a bucket with no matches
 * still appears at 0, never silently missing.
 */
const DASHBOARD_STATUS_ORDER: readonly (AttendanceSummaryStatus | null)[] = [...ATTENDANCE_SUMMARY_STATUSES, null];

export interface AttendanceDashboardBreakdownItem {
  status: AttendanceSummaryStatus | null;
  count: number;
}

export interface AttendanceDashboard {
  date: string;
  totalEmployeesCount: number;
  statusBreakdown: AttendanceDashboardBreakdownItem[];
}

export async function getAttendanceDashboard(ctx: AttendanceReportContext, date: string): Promise<AttendanceDashboard> {
  if (ctx.employees.length === 0) {
    return { date, totalEmployeesCount: 0, statusBreakdown: DASHBOARD_STATUS_ORDER.map((status) => ({ status, count: 0 })) };
  }

  const rows = await getAttendanceRegisterForEmployees(ctx.organizationId, ctx.employees.map((e) => e.id), date, date);
  const counts = new Map<AttendanceSummaryStatus | null, number>();
  for (const row of rows) {
    const status = row.summaries[0]?.status ?? null;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return {
    date,
    totalEmployeesCount: ctx.employees.length,
    statusBreakdown: DASHBOARD_STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 })),
  };
}

// --- Reports (GET .../attendance/reports/:reportKey) ---

export interface AttendanceReportColumn {
  key: string;
  label: string;
}

export type AttendanceReportRow = Record<string, string | number | null>;

export interface AttendanceReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: AttendanceReportColumn[];
  rows: AttendanceReportRow[];
}

function employeeLabel(ctx: AttendanceReportContext, employeeId: number): string {
  return ctx.employeeNameById.get(employeeId) ?? "Unknown employee";
}

function departmentLabel(ctx: AttendanceReportContext, employeeId: number): string {
  const employee = ctx.employees.find((e) => e.id === employeeId);
  if (!employee || employee.departmentId == null) return "Unassigned";
  return ctx.departmentNameById.get(employee.departmentId) ?? "Unassigned";
}

function isoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

/** A per-(employee, date) snapshot for the range — the report analog of W69's live Register, exported as a flat, CSV-friendly row list rather than the Register's own employee-paginated shape. */
async function runDailyRegister(ctx: AttendanceReportContext, from: string, to: string): Promise<{ columns: AttendanceReportColumn[]; rows: AttendanceReportRow[] }> {
  const columns: AttendanceReportColumn[] = [
    { key: "date", label: "Date" },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "status", label: "Status" },
    { key: "clockIn", label: "Clock In" },
    { key: "clockOut", label: "Clock Out" },
    { key: "workedMinutes", label: "Worked (min)" },
  ];
  if (ctx.employees.length === 0) return { columns, rows: [] };

  const registerRows = await getAttendanceRegisterForEmployees(ctx.organizationId, ctx.employees.map((e) => e.id), from, to);
  const rows: AttendanceReportRow[] = [];
  for (const row of registerRows) {
    for (const summary of row.summaries) {
      rows.push({
        date: summary.date,
        employee: employeeLabel(ctx, row.employeeId),
        department: departmentLabel(ctx, row.employeeId),
        status: summary.status ?? "not_applicable",
        clockIn: isoOrNull(summary.firstClockIn),
        clockOut: isoOrNull(summary.lastClockOut),
        workedMinutes: summary.workedMinutes,
      });
    }
  }
  return { columns, rows };
}

/** One row per employee: raw counts per W66 status across the range. No rate/percentage column — the frozen W70 scope defines no attendance-rate metric or denominator, so none is invented here. */
async function runMonthlySummary(ctx: AttendanceReportContext, from: string, to: string): Promise<{ columns: AttendanceReportColumn[]; rows: AttendanceReportRow[] }> {
  const columns: AttendanceReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "presentCount", label: "Present" },
    { key: "lateCount", label: "Late" },
    { key: "partialCount", label: "Partial" },
    { key: "absentCount", label: "Absent" },
    { key: "onLeaveCount", label: "On Leave" },
    { key: "holidayCount", label: "Holiday" },
    { key: "nonWorkingDayCount", label: "Non-Working Day" },
  ];
  if (ctx.employees.length === 0) return { columns, rows: [] };

  const registerRows = await getAttendanceRegisterForEmployees(ctx.organizationId, ctx.employees.map((e) => e.id), from, to);
  const rows: AttendanceReportRow[] = registerRows.map((row) => {
    const counts: Record<AttendanceSummaryStatus, number> = {
      present: 0,
      late: 0,
      partial: 0,
      absent: 0,
      on_leave: 0,
      holiday: 0,
      non_working_day: 0,
    };
    for (const summary of row.summaries) {
      if (summary.status != null) counts[summary.status] += 1;
    }
    return {
      employee: employeeLabel(ctx, row.employeeId),
      department: departmentLabel(ctx, row.employeeId),
      presentCount: counts.present,
      lateCount: counts.late,
      partialCount: counts.partial,
      absentCount: counts.absent,
      onLeaveCount: counts.on_leave,
      holidayCount: counts.holiday,
      nonWorkingDayCount: counts.non_working_day,
    };
  });
  return { columns, rows };
}

/** One row per late instance (status === "late") in the range — never every day, only the exceptions. */
async function runLateArrivals(ctx: AttendanceReportContext, from: string, to: string): Promise<{ columns: AttendanceReportColumn[]; rows: AttendanceReportRow[] }> {
  const columns: AttendanceReportColumn[] = [
    { key: "date", label: "Date" },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "clockIn", label: "Clock In" },
    { key: "lateMinutes", label: "Late (min)" },
  ];
  if (ctx.employees.length === 0) return { columns, rows: [] };

  const registerRows = await getAttendanceRegisterForEmployees(ctx.organizationId, ctx.employees.map((e) => e.id), from, to);
  const rows: AttendanceReportRow[] = [];
  for (const row of registerRows) {
    for (const summary of row.summaries) {
      if (summary.status !== "late") continue;
      rows.push({
        date: summary.date,
        employee: employeeLabel(ctx, row.employeeId),
        department: departmentLabel(ctx, row.employeeId),
        clockIn: isoOrNull(summary.firstClockIn),
        lateMinutes: summary.lateMinutes,
      });
    }
  }
  return { columns, rows };
}

/**
 * One row per absent instance (status === "absent" only) in the range.
 * Deliberately excludes on_leave/holiday/non_working_day/null — those are
 * distinct, non-culpable W66 statuses, not absenteeism, per §3.7/§3.3's own
 * precedence semantics (an on_leave day is never also "absent").
 */
async function runAbsenteeism(ctx: AttendanceReportContext, from: string, to: string): Promise<{ columns: AttendanceReportColumn[]; rows: AttendanceReportRow[] }> {
  const columns: AttendanceReportColumn[] = [
    { key: "date", label: "Date" },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
  ];
  if (ctx.employees.length === 0) return { columns, rows: [] };

  const registerRows = await getAttendanceRegisterForEmployees(ctx.organizationId, ctx.employees.map((e) => e.id), from, to);
  const rows: AttendanceReportRow[] = [];
  for (const row of registerRows) {
    for (const summary of row.summaries) {
      if (summary.status !== "absent") continue;
      rows.push({ date: summary.date, employee: employeeLabel(ctx, row.employeeId), department: departmentLabel(ctx, row.employeeId) });
    }
  }
  return { columns, rows };
}

const RUNNERS: Record<string, (ctx: AttendanceReportContext, from: string, to: string) => Promise<{ columns: AttendanceReportColumn[]; rows: AttendanceReportRow[] }>> = {
  attendance_daily_register: runDailyRegister,
  attendance_monthly_summary: runMonthlySummary,
  attendance_late_arrivals: runLateArrivals,
  attendance_absenteeism: runAbsenteeism,
};

export function isKnownAttendanceReportKey(key: string): boolean {
  return key in RUNNERS;
}

export async function runAttendanceReport(params: {
  key: string;
  label: string;
  description: string;
  ctx: AttendanceReportContext;
  from: string;
  to: string;
}): Promise<AttendanceReportResult> {
  const runner = RUNNERS[params.key];
  if (!runner) throw new AttendanceReportNotFoundError(params.key);

  const { columns, rows } = await runner(params.ctx, params.from, params.to);
  return {
    key: params.key,
    label: params.label,
    description: params.description,
    generatedAt: new Date(),
    columns,
    rows,
  };
}
