/**
 * Integration tests for the Attendance Register (Phase 3B, W69),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus the authorization-scope resolution and
 * pagination through supertest. @workspace/db is mocked with real
 * field-based filtering, mirroring attendanceDailySummaryRoute.test.ts's
 * own pattern, extended with a `count()`-aware select for pagination
 * totals. No real database connection is made. Timezone is UTC throughout
 * — timezone/DST correctness is already covered by
 * attendanceDailySummary.test.ts's pure-function tests.
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
  attendanceEventsTable,
  attendanceAdjustmentsTable,
  leaveRequestsTable,
  publicHolidaysTable,
  organizationSettingsTable,
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
      attendanceEventRows: [] as Record<string, unknown>[],
      attendanceAdjustmentRows: [] as Record<string, unknown>[],
      leaveRequestRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
      organizationSettingsRows: [] as Record<string, unknown>[],
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
      "employmentStatus",
      "hireDate",
      "separationDate",
      "reportingManagerId",
      "departmentId",
      "branchId",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    attendanceEventsTable: mockTable("attendance_events", ["id", "organizationId", "employeeId", "eventType", "occurredAt"]),
    attendanceAdjustmentsTable: mockTable("attendance_adjustments", ["id", "organizationId", "employeeId", "date", "status"]),
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "status", "startDate", "endDate"]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace"]),
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
  attendanceEventsTable,
  attendanceAdjustmentsTable,
  leaveRequestsTable,
  publicHolidaysTable,
  organizationSettingsTable,
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
        else if (table === attendanceEventsTable) rows = fixtures.attendanceEventRows;
        else if (table === attendanceAdjustmentsTable) rows = fixtures.attendanceAdjustmentRows;
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === publicHolidaysTable) rows = fixtures.publicHolidayRows;
        else if (table === organizationSettingsTable) rows = fixtures.organizationSettingsRows;

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
    { id: MANAGER_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null, departmentId: 1, branchId: 1 },
    { id: REPORT_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: MANAGER_ID, departmentId: 1, branchId: 1 },
    { id: UNRELATED_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null, departmentId: 2, branchId: 2 },
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

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.attendanceEventRows = [];
  fixtures.attendanceAdjustmentRows = [];
  fixtures.leaveRequestRows = [];
  fixtures.publicHolidayRows = [];
  fixtures.organizationSettingsRows = [];

  mockSession();
  mockActiveMembership();
  mockAttendanceModuleEnabled();
  mockOwnEmployeeLinked();
  mockEmployees();
  mockTimezone();
  mockAttendanceConfig();
});

// 2026-03-02 is a Monday — a configured work day, so a no-events employee
// resolves to "absent" rather than "non_working_day" (keeps status-filter
// tests unambiguous).
function register(query: string) {
  return request(app).get(`/api/organizations/${ORG_ID}/attendance?${query}`).set("Authorization", "Bearer valid-token");
}

describe("GET /api/organizations/:organizationId/attendance", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(403);
  });

  it("returns 400 when from/to are missing", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an inverted date range", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-10&to=2026-03-01");
    expect(res.status).toBe(400);
  });

  it("org-wide (attendance.manage) sees every employee in the organization", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    const ids = res.body.items.map((i: { employeeId: number }) => i.employeeId).sort();
    expect(ids).toEqual([MANAGER_ID, REPORT_ID, UNRELATED_ID]);
  });

  it("a manager (no attendance.manage) sees only themselves and their direct reports", async () => {
    mockPermissions(["attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = res.body.items.map((i: { employeeId: number }) => i.employeeId).sort();
    expect(ids).toEqual([MANAGER_ID, REPORT_ID]);
    expect(ids).not.toContain(UNRELATED_ID);
  });

  it("an employeeId filter cannot broaden a manager's scope to an unrelated employee", async () => {
    mockPermissions(["attendance.read.own"]);
    const res = await register(`from=2026-03-02&to=2026-03-02&employeeId=${UNRELATED_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("an employee with zero direct reports gets a valid empty-scope result, not org-wide fallback", async () => {
    mockSession(UNRELATED_ID);
    mockActiveMembership(9, ORG_ID, UNRELATED_ID);
    fixtures.employeeUserLinkRows = [{ employeeId: UNRELATED_ID, applicationUserId: UNRELATED_ID }];
    mockPermissions(["attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((i: { employeeId: number }) => i.employeeId)).toEqual([UNRELATED_ID]);
  });

  it("a department filter narrows the org-wide register", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02&departmentId=2");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].employeeId).toBe(UNRELATED_ID);
  });

  it("returns 400 for an invalid status filter value", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02&status=made_up_status");
    expect(res.status).toBe(400);
  });

  it("a status filter keeps only rows with at least one matching day", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_in", occurredAt: new Date("2026-03-02T09:00:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: REPORT_ID, eventType: "clock_out", occurredAt: new Date("2026-03-02T17:00:00Z") },
    ];
    const res = await register("from=2026-03-02&to=2026-03-02&status=present");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].employeeId).toBe(REPORT_ID);
    // total is the unfiltered (by status) scope count, per the documented tradeoff.
    expect(res.body.total).toBe(3);
  });

  it("respects page/pageSize for pagination", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register("from=2026-03-02&to=2026-03-02&page=1&pageSize=2");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(2);
  });

  it("each register row exposes the full W66 summary shape", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await register(`from=2026-03-02&to=2026-03-02&employeeId=${REPORT_ID}`);
    expect(res.status).toBe(200);
    const row = res.body.items[0];
    expect(row.summaries).toHaveLength(1);
    expect(row.summaries[0]).toMatchObject({ date: "2026-03-02", status: "absent" });
  });

  it("returns 409 when the organization timezone is not configured", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    fixtures.organizationSettingsRows = fixtures.organizationSettingsRows.filter((r) => r.namespace !== "general");
    const res = await register("from=2026-03-02&to=2026-03-02");
    expect(res.status).toBe(409);
  });

  it("denies cross-organization membership entirely", async () => {
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    const res = await request(app)
      .get(`/api/organizations/${OTHER_ORG_ID}/attendance?from=2026-03-02&to=2026-03-02`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});
