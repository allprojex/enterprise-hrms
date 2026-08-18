/**
 * Integration tests for Attendance Adjustments — HR Direct-Entry (Phase 3B,
 * W65), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain through supertest.
 * @workspace/db is mocked, mirroring attendanceEvents.test.ts/
 * leaveRequests.test.ts's own pattern. No real database connection is made.
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
  attendanceAdjustmentsTable,
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
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    attendanceAdjustmentsTable: mockTable("attendance_adjustments", ["id", "organizationId", "employeeId", "date", "adjustmentType", "status"]),
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
  attendanceAdjustmentsTable,
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
const EMPLOYEE_ID = 42;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId,
        email: "hr@example.com",
        firstName: "HR",
        lastName: "User",
        role: "hr_manager",
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

function mockAttendanceModuleEnabled() {
  fixtures.moduleRows = [{ id: 1, key: "attendance", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }];
}

function mockTargetEmployee() {
  fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

const basePayload = {
  employeeId: EMPLOYEE_ID,
  date: "2030-06-10",
  adjustmentType: "mark_present",
  reason: "Forgot to clock in, confirmed present via manager",
};

describe("POST /api/organizations/:organizationId/attendance-adjustments", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(403);
  });

  it("returns 403 without attendance.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(403);
  });

  it("records an HR direct entry, auto-approved, and an audit event", async () => {
    mockSession();
    mockActiveMembership(7);
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("approved");
    expect(res.body.requestedByMembershipId).toBe(7);
    expect(res.body.decidedByMembershipId).toBe(7);
    expect(res.body.decidedAt).not.toBeNull();

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("attendance_event.recorded");
  });

  it("returns 404 when the target employee does not exist in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    // no employeeRows

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(404);
  });

  it("returns 400 when reason is missing", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, reason: "" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid adjustmentType", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, adjustmentType: "made_up_type" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when adjustmentType is manual_clock_in but correctedClockIn is missing", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, adjustmentType: "manual_clock_in" });

    expect(res.status).toBe(400);
  });

  it("records manual_clock_in with a valid correctedClockIn", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, adjustmentType: "manual_clock_in", correctedClockIn: "2030-06-10T08:05:00Z" });

    expect(res.status).toBe(201);
    expect(res.body.adjustmentType).toBe("manual_clock_in");
    expect(res.body.correctedClockIn).not.toBeNull();
    expect(res.body.correctedClockOut).toBeNull();
  });

  it("returns 400 for a malformed date", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.manage"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, date: "06/10/2030" });

    expect(res.status).toBe(400);
  });
});
