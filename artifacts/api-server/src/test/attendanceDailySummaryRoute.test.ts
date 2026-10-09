/**
 * Integration tests for the Attendance Daily Summary route (Phase 3B, W66),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus the full read-model precedence pipeline
 * through supertest. @workspace/db is mocked with real field-based
 * filtering, mirroring attendanceEvents.test.ts's own pattern. No real
 * database connection is made. Organization timezone is UTC throughout
 * (kept simple here — DST/non-UTC timezone correctness is already covered
 * by attendanceDailySummary.test.ts's pure-function tests).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
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
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
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
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    attendanceEventsTable: mockTable("attendance_events", ["id", "organizationId", "employeeId", "eventType", "occurredAt"]),
    attendanceAdjustmentsTable: mockTable("attendance_adjustments", ["id", "organizationId", "employeeId", "date", "status"]),
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "status", "startDate", "endDate"]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace"]),
  };
});

function nextId(table: { __name: string }): number {
  return Math.floor(Math.random() * 1_000_000);
}

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
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
    select: () => ({
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
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => Promise.resolve(filtered),
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
  inArray: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const EMPLOYEE_ID = 42;
const OTHER_EMPLOYEE_ID = 43;

function mockSession(userId = 1) {
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

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
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
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
}

function mockTimezone(organizationId = ORG_ID, timezone = "UTC") {
  fixtures.organizationSettingsRows = [
    ...fixtures.organizationSettingsRows.filter((r) => !(r.organizationId === organizationId && r.namespace === "general")),
    { id: nextId(organizationSettingsTable), organizationId, namespace: "general", schemaVersion: 1, settings: { timezone }, updatedAt: new Date() },
  ];
}

function mockAttendanceConfig(organizationId = ORG_ID, overrides: Record<string, unknown> = {}) {
  fixtures.organizationSettingsRows = [
    ...fixtures.organizationSettingsRows.filter((r) => !(r.organizationId === organizationId && r.namespace === "attendance")),
    {
      id: nextId(organizationSettingsTable),
      organizationId,
      namespace: "attendance",
      schemaVersion: 1,
      settings: {
        workStartTime: "09:00",
        workEndTime: "17:00",
        gracePeriodMinutes: 15,
        workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        ...overrides,
      },
      updatedAt: new Date(),
    },
  ];
}

function mockEmployee(overrides: Record<string, unknown> = {}) {
  fixtures.employeeRows = [
    {
      id: EMPLOYEE_ID,
      organizationId: ORG_ID,
      employmentStatus: "active",
      hireDate: new Date("2020-01-01"),
      separationDate: null,
      reportingManagerId: null,
      ...overrides,
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
  mockPermissions(["attendance.read.own"]);
  mockOwnEmployeeLinked();
  mockEmployee();
  mockTimezone();
  mockAttendanceConfig();
});

function getSummary(date: string, employeeId = EMPLOYEE_ID, orgId = ORG_ID) {
  return request(app)
    .get(`/api/organizations/${orgId}/employees/${employeeId}/attendance/summary?date=${date}`)
    .set("Authorization", "Bearer valid-token");
}

describe("GET /api/organizations/:organizationId/employees/:employeeId/attendance/summary", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(403);
  });

  it("returns present for a normal workday with an on-time complete clock pair", async () => {
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:05:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_out", occurredAt: new Date("2026-03-05T17:00:00Z") },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("present");
    expect(res.body.workedMinutes).toBe(475);
  });

  it("returns absent for a workday with no events", async () => {
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("absent");
  });

  it("returns holiday, beating an approved leave request and any events on the same date", async () => {
    fixtures.publicHolidayRows = [{ id: 1, organizationId: ORG_ID, status: "active", recurring: false, date: "2026-03-05", observedDate: null, name: "Test Holiday" }];
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "approved", startDate: "2026-03-05", endDate: "2026-03-05" }];
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:00:00Z") },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("holiday");
  });

  it("returns non_working_day for a date outside the configured work days", async () => {
    // 2026-03-07 is a Saturday.
    const res = await getSummary("2026-03-07");
    expect(res.body.status).toBe("non_working_day");
  });

  it("returns on_leave for an approved leave request covering the date, beating event-derived absent", async () => {
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "approved", startDate: "2026-03-05", endDate: "2026-03-05" }];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("on_leave");
  });

  it("does not treat a pending leave request as approved", async () => {
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "pending", startDate: "2026-03-05", endDate: "2026-03-05" }];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("absent");
  });

  it("returns null status before hireDate (no summary generated)", async () => {
    mockEmployee({ hireDate: new Date("2026-06-01") });
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeNull();
  });

  it("returns null status on/after separationDate (no summary generated)", async () => {
    mockEmployee({ employmentStatus: "terminated", separationDate: new Date("2026-03-01") });
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBeNull();
  });

  it("returns partial for an incomplete clock pair (clock-in with no clock-out)", async () => {
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:00:00Z") },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("partial");
  });

  it("uses first-clock-in/last-clock-out for a repeated clock-in sequence (Open Decision 1)", async () => {
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:00:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:30:00Z") },
      { id: 3, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_out", occurredAt: new Date("2026-03-05T17:00:00Z") },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(200);
    expect(new Date(res.body.firstClockIn).toISOString()).toBe("2026-03-05T09:00:00.000Z");
    expect(res.body.status).toBe("present");
  });

  it("an approved manual_clock_in adjustment overrides the raw effective clock-in", async () => {
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date("2026-03-05T09:30:00Z") },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_out", occurredAt: new Date("2026-03-05T17:00:00Z") },
    ];
    fixtures.attendanceAdjustmentRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        date: "2026-03-05",
        adjustmentType: "manual_clock_in",
        correctedClockIn: new Date("2026-03-05T09:00:00Z"),
        correctedClockOut: null,
        status: "approved",
        decidedAt: new Date("2026-03-06T00:00:00Z"),
      },
    ];
    const res = await getSummary("2026-03-05");
    expect(new Date(res.body.firstClockIn).toISOString()).toBe("2026-03-05T09:00:00.000Z");
    expect(res.body.status).toBe("present");
  });

  it("a pending adjustment does not affect the effective summary", async () => {
    fixtures.attendanceAdjustmentRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        date: "2026-03-05",
        adjustmentType: "mark_present",
        status: "pending",
        decidedAt: null,
      },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("absent");
  });

  it("a rejected adjustment does not affect the effective summary", async () => {
    fixtures.attendanceAdjustmentRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        date: "2026-03-05",
        adjustmentType: "mark_present",
        status: "rejected",
        decidedAt: new Date(),
      },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("absent");
  });

  it("an approved mark_present adjustment overrides absent", async () => {
    fixtures.attendanceAdjustmentRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, date: "2026-03-05", adjustmentType: "mark_present", status: "approved", decidedAt: new Date() },
    ];
    const res = await getSummary("2026-03-05");
    expect(res.body.status).toBe("present");
  });

  it("returns 409 when the organization timezone is not configured", async () => {
    fixtures.organizationSettingsRows = fixtures.organizationSettingsRows.filter((r) => r.namespace !== "general");
    const res = await getSummary("2026-03-05");
    expect(res.status).toBe(409);
  });

  it("returns 400 for an inverted date range", async () => {
    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/attendance/summary?from=2026-03-10&to=2026-03-01`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 for a range exceeding the maximum", async () => {
    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/attendance/summary?from=2026-01-01&to=2026-12-31`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns a dense array for a valid range", async () => {
    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/attendance/summary?from=2026-03-02&to=2026-03-08`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
  });

  it("returns 403 viewing another employee's summary without manager or org-wide authority", async () => {
    fixtures.employeeRows.push({ id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null });
    const res = await getSummary("2026-03-05", OTHER_EMPLOYEE_ID);
    expect(res.status).toBe(403);
  });

  it("allows a manager to view a direct report's summary", async () => {
    fixtures.employeeRows.push({ id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: EMPLOYEE_ID });
    const res = await getSummary("2026-03-05", OTHER_EMPLOYEE_ID);
    expect(res.status).toBe(200);
  });

  it("allows HR with attendance.manage to view any employee's summary", async () => {
    mockPermissions(["attendance.read.own", "attendance.manage"]);
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows.push({ id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, separationDate: null, reportingManagerId: null });
    const res = await getSummary("2026-03-05", OTHER_EMPLOYEE_ID);
    expect(res.status).toBe(200);
  });

  it("denies cross-organization membership entirely", async () => {
    const res = await getSummary("2026-03-05", EMPLOYEE_ID, OTHER_ORG_ID);
    expect(res.status).toBe(403);
  });
});
