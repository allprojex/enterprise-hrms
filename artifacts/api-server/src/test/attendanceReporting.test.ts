/**
 * Integration tests for Attendance Dashboard & Reporting (Phase 3B, W70),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus scope resolution and aggregation through
 * supertest. Mock harness mirrors attendanceRegister.test.ts's own
 * field-based-filtering pattern exactly, extended with a departments table.
 * No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const COUNT_SENTINEL = "__COUNT__";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  attendanceEventsTable,
  attendanceAdjustmentsTable,
  leaveRequestsTable,
  publicHolidaysTable,
  organizationSettingsTable,
  reportsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      attendanceEventRows: [] as Record<string, unknown>[],
      attendanceAdjustmentRows: [] as Record<string, unknown>[],
      leaveRequestRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
      organizationSettingsRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", [
      "id",
      "organizationId",
      "firstName",
      "lastName",
      "employmentStatus",
      "hireDate",
      "separationDate",
      "reportingManagerId",
      "departmentId",
      "branchId",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    attendanceEventsTable: mockTable("attendance_events", ["id", "organizationId", "employeeId", "eventType", "occurredAt"]),
    attendanceAdjustmentsTable: mockTable("attendance_adjustments", ["id", "organizationId", "employeeId", "date", "status"]),
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "status", "startDate", "endDate"]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
  };
});

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | { __op: "inArray"; field: string; vals: unknown[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  attendanceEventsTable,
  attendanceAdjustmentsTable,
  leaveRequestsTable,
  publicHolidaysTable,
  organizationSettingsTable,
  reportsTable,
  db: {
    select: (selection?: { value: string }) => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const sessionBuilder = {
            innerJoin: () => sessionBuilder,
            where: () => sessionBuilder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return sessionBuilder;
        }

        const unfiltered =
          table === membershipRolesTable
            ? fixtures.membershipRoleRows
            : table === rolePermissionsTable
              ? fixtures.permissionRows
              : table === modulesTable
                ? fixtures.moduleRows
                : undefined;
        if (unfiltered !== undefined) {
          const rows = unfiltered as unknown[];
          const passthroughBuilder = {
            innerJoin: () => passthroughBuilder,
            where: () => passthroughBuilder,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return passthroughBuilder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows as Record<string, unknown>[];
        else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === attendanceEventsTable) rows = fixtures.attendanceEventRows;
        else if (table === attendanceAdjustmentsTable) rows = fixtures.attendanceAdjustmentRows;
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === publicHolidaysTable) rows = fixtures.publicHolidayRows;
        else if (table === organizationSettingsTable) rows = fixtures.organizationSettingsRows;
        else if (table === reportsTable) rows = fixtures.reportRows;

        let filtered = rows;
        const isCount = selection?.value === COUNT_SENTINEL;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            if (isCount) return Promise.resolve([{ value: filtered.length }]);
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => ({
            offset: (o: number) => Promise.resolve(filtered.slice(o, o + n)),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered.slice(0, n)).then(resolve, reject),
          }),
          offset: (n: number) => Promise.resolve(filtered.slice(n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  gte: () => undefined,
  lte: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => COUNT_SENTINEL,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const MANAGER_ID = 1;
const REPORT_ID = 2;
const UNRELATED_ID = 3;

function mockSession(userId = MANAGER_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: ORG_ID,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID, applicationUserId = MANAGER_ID) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockAttendanceModuleEnabled(organizationId = ORG_ID) {
  fixtures.moduleRows = [{ id: 1, key: "attendance", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId, moduleId: 1, enabled: true }];
}

function mockOwnEmployeeLinked() {
  fixtures.employeeUserLinkRows = [{ employeeId: MANAGER_ID, applicationUserId: MANAGER_ID }];
}

function mockEmployees() {
  fixtures.employeeRows = [
    { id: MANAGER_ID, organizationId: ORG_ID, firstName: "Mia", lastName: "Manager", employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null, departmentId: 1, branchId: 1 },
    { id: REPORT_ID, organizationId: ORG_ID, firstName: "Ray", lastName: "Report", employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: MANAGER_ID, departmentId: 1, branchId: 1 },
    { id: UNRELATED_ID, organizationId: ORG_ID, firstName: "Uma", lastName: "Unrelated", employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null, departmentId: 2, branchId: 2 },
  ];
  fixtures.departmentRows = [
    { id: 1, organizationId: ORG_ID, name: "Engineering" },
    { id: 2, organizationId: ORG_ID, name: "Sales" },
  ];
}

function mockTimezone(organizationId = ORG_ID) {
  fixtures.organizationSettingsRows = [
    ...fixtures.organizationSettingsRows.filter((r) => !(r.organizationId === organizationId && r.namespace === "general")),
    { id: 1, organizationId, namespace: "general", schemaVersion: 1, settings: { timezone: "UTC" }, updatedAt: new Date() },
  ];
}

function mockAttendanceConfig(organizationId = ORG_ID) {
  fixtures.organizationSettingsRows = [
    ...fixtures.organizationSettingsRows.filter((r) => !(r.organizationId === organizationId && r.namespace === "attendance")),
    {
      id: 2,
      organizationId,
      namespace: "attendance",
      schemaVersion: 1,
      settings: { workStartTime: "09:00", workEndTime: "17:00", gracePeriodMinutes: 15, workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
      updatedAt: new Date(),
    },
  ];
}

function mockReportDefinitions() {
  fixtures.reportRows = [
    { key: "headcount", label: "Headcount", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
    { key: "attendance_daily_register", label: "Daily Register", description: "d", category: "attendance", requiredPermissionKey: "attendance.read.own" },
    { key: "attendance_monthly_summary", label: "Monthly Summary", description: "d", category: "attendance", requiredPermissionKey: "attendance.read.own" },
    { key: "attendance_late_arrivals", label: "Late Arrivals", description: "d", category: "attendance", requiredPermissionKey: "attendance.read.own" },
    { key: "attendance_absenteeism", label: "Absenteeism", description: "d", category: "attendance", requiredPermissionKey: "attendance.read.own" },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.departmentRows = [];
  fixtures.attendanceEventRows = [];
  fixtures.attendanceAdjustmentRows = [];
  fixtures.leaveRequestRows = [];
  fixtures.publicHolidayRows = [];
  fixtures.organizationSettingsRows = [];
  fixtures.reportRows = [];

  mockSession();
  mockActiveMembership();
  mockAttendanceModuleEnabled();
  mockOwnEmployeeLinked();
  mockEmployees();
  mockTimezone();
  mockAttendanceConfig();
  mockReportDefinitions();
});

// 2026-03-02 is a Monday — a configured work day.
function dashboard(query: string) {
  return request(app).get(`/api/organizations/${ORG_ID}/attendance/dashboard?${query}`).set("Authorization", "Bearer valid-token");
}
function report(key: string, query: string) {
  return request(app).get(`/api/organizations/${ORG_ID}/attendance/reports/${key}?${query}`).set("Authorization", "Bearer valid-token");
}

describe("GET /api/organizations/:organizationId/attendance/dashboard", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await dashboard("date=2026-03-02");
    expect(res.status).toBe(403);
  });

  it("org-wide (attendance.manage) sees all 3 employees with a zero-filled status breakdown", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_in", occurredAt: new Date("2026-03-02T09:00:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_out", occurredAt: new Date("2026-03-02T17:00:00Z") },
    ];
    const res = await dashboard("date=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.totalEmployeesCount).toBe(3);
    expect(res.body.date).toBe("2026-03-02");
    const byStatus = Object.fromEntries(res.body.statusBreakdown.map((i: { status: string | null; count: number }) => [i.status ?? "null", i.count]));
    // MANAGER + UNRELATED have no events on a work day -> absent; REPORT clocked a full day -> present.
    expect(byStatus.present).toBe(1);
    expect(byStatus.absent).toBe(2);
    expect(byStatus.late).toBe(0);
    expect(byStatus.on_leave).toBe(0);
    // every bucket present, even at zero (never silently missing)
    expect(res.body.statusBreakdown).toHaveLength(8);
  });

  it("a manager sees a breakdown covering only themselves and their direct report", async () => {
    mockPermissions(["attendance.read.own"]);
    const res = await dashboard("date=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.totalEmployeesCount).toBe(2);
  });

  it("an employee with zero direct reports gets a valid self-only breakdown, not org-wide", async () => {
    mockSession(UNRELATED_ID);
    mockActiveMembership(9, ORG_ID, UNRELATED_ID);
    fixtures.employeeUserLinkRows = [{ employeeId: UNRELATED_ID, applicationUserId: UNRELATED_ID }];
    mockPermissions(["attendance.read.own"]);
    const res = await dashboard("date=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.totalEmployeesCount).toBe(1);
  });

  it("returns 409 when the organization timezone is not configured", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.organizationSettingsRows = fixtures.organizationSettingsRows.filter((r) => r.namespace !== "general");
    const res = await dashboard("date=2026-03-02");
    expect(res.status).toBe(409);
  });

  it("denies cross-organization membership entirely", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await request(app)
      .get(`/api/organizations/${OTHER_ORG_ID}/attendance/dashboard?date=2026-03-02`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("defaults to organization-local today when date is omitted", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await dashboard("");
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("GET /api/organizations/:organizationId/attendance/reports/:reportKey", () => {
  it("returns 404 for an unknown report key", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("not_a_real_report", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a real report key from a different category", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("headcount", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the attendance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("attendance_daily_register", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(403);
  });

  it("attendance_daily_register: org-wide flattens one row per employee per date", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("attendance_daily_register", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("attendance_daily_register");
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.rows.map((r: { employee: string }) => r.employee).sort()).toEqual(["Mia Manager", "Ray Report", "Uma Unrelated"]);
  });

  it("attendance_daily_register: a manager only sees their own scope's rows", async () => {
    mockPermissions(["attendance.read.own"]);
    const res = await report("attendance_daily_register", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.map((r: { employee: string }) => r.employee)).not.toContain("Uma Unrelated");
  });

  it("attendance_monthly_summary: raw status counts per employee, no rate column", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_in", occurredAt: new Date("2026-03-02T09:00:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_out", occurredAt: new Date("2026-03-02T17:00:00Z") },
    ];
    const res = await report("attendance_monthly_summary", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    const reportRow = res.body.rows.find((r: { employee: string }) => r.employee === "Ray Report");
    expect(reportRow).toMatchObject({ presentCount: 1, absentCount: 0 });
    const managerRow = res.body.rows.find((r: { employee: string }) => r.employee === "Mia Manager");
    expect(managerRow).toMatchObject({ presentCount: 0, absentCount: 1 });
    expect(reportRow.rate).toBeUndefined();
  });

  it("attendance_late_arrivals: only late instances appear", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_in", occurredAt: new Date("2026-03-02T09:30:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_out", occurredAt: new Date("2026-03-02T17:00:00Z") },
    ];
    const res = await report("attendance_late_arrivals", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ employee: "Ray Report", lateMinutes: 15 });
  });

  it("attendance_absenteeism: only true 'absent' instances appear, never on_leave", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_ID, status: "approved", startDate: "2026-03-02", endDate: "2026-03-02" },
    ];
    const res = await report("attendance_absenteeism", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    // MANAGER and UNRELATED are absent; REPORT is on approved leave -> excluded.
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.map((r: { employee: string }) => r.employee)).not.toContain("Ray Report");
  });

  it("supports ?format=csv with a text/csv content type", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("attendance_daily_register", "from=2026-03-02&to=2026-03-02&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain("Date,Employee,Department");
  });

  it("returns 400 for an inverted date range", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await report("attendance_daily_register", "from=2026-03-10&to=2026-03-01");
    expect(res.status).toBe(400);
  });

  it("returns 409 when the organization timezone is not configured", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.organizationSettingsRows = fixtures.organizationSettingsRows.filter((r) => r.namespace !== "general");
    const res = await report("attendance_daily_register", "from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(409);
  });

  it("denies cross-organization membership entirely", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await request(app)
      .get(`/api/organizations/${OTHER_ORG_ID}/attendance/reports/attendance_daily_register?from=2026-03-02&to=2026-03-02`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});
