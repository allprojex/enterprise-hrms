/**
 * Integration tests for Attendance Event Capture (Phase 3B, W65 — Self-
 * Service Clocking), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain through supertest.
 * @workspace/db is mocked with real field-based filtering, mirroring
 * leaveRequests.test.ts's own Cond-matcher pattern. No real database
 * connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  auditEventsTable,
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
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
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
      "reportingManagerId",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    attendanceEventsTable: mockTable("attendance_events", ["id", "organizationId", "employeeId", "eventType", "occurredAt", "source"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

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
  auditEventsTable,
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
          table === organizationMembershipsTable
            ? fixtures.membershipRows
            : table === membershipRolesTable
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
        if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === attendanceEventsTable) rows = fixtures.attendanceEventRows;

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
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        const row = { id: nextId(table), createdAt: new Date(), ...v };
        if (table === attendanceEventsTable) fixtures.attendanceEventRows = [...fixtures.attendanceEventRows, row];
        return { returning: () => Promise.resolve([row]) };
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
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
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

function mockEligibleEmployee(overrides: Record<string, unknown> = {}) {
  fixtures.employeeRows = [
    {
      id: EMPLOYEE_ID,
      organizationId: ORG_ID,
      employmentStatus: "active",
      hireDate: new Date("2020-01-01"),
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
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/attendance-events", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(403);
  });

  it("returns 403 without attendance.clock.own", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions([]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid eventType", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "lunch_break" });

    expect(res.status).toBe(400);
  });

  it("returns 403 when no employee record is linked to the account", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    // no employeeUserLinkRows

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(403);
  });

  it("records a self-service clock-in with server-derived identity and server timestamp, no audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const before = Date.now();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });
    const after = Date.now();

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(EMPLOYEE_ID);
    expect(res.body.organizationId).toBe(ORG_ID);
    expect(res.body.source).toBe("self_service");
    expect(res.body.recordedByMembershipId).toBeNull();
    const occurredAt = new Date(res.body.occurredAt).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before);
    expect(occurredAt).toBeLessThanOrEqual(after);
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(false);
  });

  it("ignores a client-supplied employeeId and always uses the server-resolved own employee", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in", employeeId: OTHER_EMPLOYEE_ID });

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(EMPLOYEE_ID);
  });

  it("allows a genuine multi-segment day: repeated clock-in with no intervening clock-out is not rejected (Open Decision 1)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const first = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });
    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(fixtures.attendanceEventRows).toHaveLength(2);
  });

  for (const status of ["on_leave", "suspended", "terminated"]) {
    it(`returns 403 when the employee's status is ${status} (not eligible to self-clock)`, async () => {
      mockSession();
      mockActiveMembership();
      mockAttendanceModuleEnabled();
      mockPermissions(["attendance.clock.own"]);
      mockOwnEmployeeLinked();
      mockEligibleEmployee({ employmentStatus: status });

      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/attendance-events`)
        .set("Authorization", "Bearer valid-token")
        .send({ eventType: "clock_in" });

      expect(res.status).toBe(403);
    });
  }

  it("returns 403 when hireDate is in the future", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee({ hireDate: new Date("2999-01-01") });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(403);
  });

  it("allows an employee on probation to self-clock", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee({ employmentStatus: "probation" });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(201);
  });

  it("denies cross-organization membership entirely (no membership row for the other org)", async () => {
    mockSession();
    mockActiveMembership(5, ORG_ID);
    mockAttendanceModuleEnabled(OTHER_ORG_ID);
    mockPermissions(["attendance.clock.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .post(`/api/organizations/${OTHER_ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token")
      .send({ eventType: "clock_in" });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/attendance-events", () => {
  it("returns the caller's own events by default", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date(), source: "self_service" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 403 viewing another employee's events without manager or org-wide authority", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, reportingManagerId: null },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/attendance-events?employeeId=${OTHER_EMPLOYEE_ID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows a manager to view a direct report's events (team tier)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, reportingManagerId: EMPLOYEE_ID },
    ];
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date(), source: "self_service" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/attendance-events?employeeId=${OTHER_EMPLOYEE_ID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("allows HR with attendance.manage to view any employee's events (organization-wide tier)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own", "attendance.manage"]);
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [{ id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, employmentStatus: "active", hireDate: null, reportingManagerId: null }];
    fixtures.attendanceEventRows = [
      { id: 1, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, eventType: "clock_in", occurredAt: new Date(), source: "self_service" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/attendance-events?employeeId=${OTHER_EMPLOYEE_ID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("returns 403 when the attendance module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/attendance-events`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});
