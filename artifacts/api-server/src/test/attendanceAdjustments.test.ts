/**
 * Integration tests for Attendance Adjustments — HR Direct-Entry (Phase 3B,
 * W65) and Employee-Initiated Requests + Approval (Phase 3B, W67),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. @workspace/db is mocked,
 * mirroring attendanceEvents.test.ts/leaveRequests.test.ts's own pattern.
 * No real database connection is made.
 *
 * W67 widened the shared POST route's gate from attendance.manage alone to
 * attendance.read.own (the frozen plan's own W67 permission line) — org_
 * admin/hr_manager hold both in the real seed (lib/db/src/seed/
 * seed-roles-permissions.ts), so every existing W65 HR-direct-entry test
 * below now mocks both keys to match that real bundle, not just the one
 * the route used to check alone.
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
      employeeUserLinkRows: [] as Record<string, unknown>[],
      attendanceAdjustmentRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
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
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    attendanceAdjustmentsTable: mockTable("attendance_adjustments", [
      "id",
      "organizationId",
      "employeeId",
      "date",
      "adjustmentType",
      "status",
    ]),
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
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

        // organizationMembershipsTable is deliberately NOT here — see
        // attendanceEvents.test.ts's own comment on this same exclusion.
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
        else if (table === attendanceAdjustmentsTable) rows = fixtures.attendanceAdjustmentRows;

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
        if (table === attendanceAdjustmentsTable) fixtures.attendanceAdjustmentRows = [...fixtures.attendanceAdjustmentRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = table === attendanceAdjustmentsTable ? fixtures.attendanceAdjustmentRows : [];
          const matched = rows.filter((r) => matches(r, cond));
          if (matched.length === 0) return { returning: () => Promise.resolve([]) };
          const updatedRows = matched.map((r) => ({ ...r, ...v }));
          if (table === attendanceAdjustmentsTable) {
            fixtures.attendanceAdjustmentRows = fixtures.attendanceAdjustmentRows.map((r) => {
              const hit = updatedRows.find((u) => u.id === r.id);
              return hit ?? r;
            });
          }
          return { returning: () => Promise.resolve(updatedRows) };
        },
      }),
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
const HR_EMPLOYEE_ID = 43;

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

function mockTargetEmployee() {
  fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID }];
}

function mockOwnEmployeeLinked() {
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
  fixtures.employeeRows = [...fixtures.employeeRows.filter((r) => r.id !== EMPLOYEE_ID), { id: EMPLOYEE_ID, organizationId: ORG_ID }];
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
  fixtures.attendanceAdjustmentRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

const basePayload = {
  employeeId: EMPLOYEE_ID,
  date: "2030-06-10",
  adjustmentType: "mark_present",
  reason: "Forgot to clock in, confirmed present via manager",
};

describe("POST /api/organizations/:organizationId/attendance-adjustments — HR direct entry (W65)", () => {
  it("returns 403 when the attendance module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(403);
  });

  it("returns 403 with neither attendance.manage nor attendance.read.own", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions([]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
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
    mockPermissions(["attendance.manage", "attendance.read.own"]);
    mockTargetEmployee();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, date: "06/10/2030" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/attendance-adjustments — employee-initiated request (W67)", () => {
  it("creates a pending request with server-derived identity, ignoring a client-supplied employeeId", async () => {
    mockSession();
    mockActiveMembership(9);
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, employeeId: 999 });

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(EMPLOYEE_ID);
    expect(res.body.status).toBe("pending");
    expect(res.body.requestedByMembershipId).toBe(9);
    expect(res.body.decidedByMembershipId).toBeNull();
    expect(res.body.decidedAt).toBeNull();
  });

  it("never auto-approves itself", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.body.status).not.toBe("approved");
  });

  it("records an attendance_adjustment.requested audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();

    await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("attendance_adjustment.requested");
  });

  it("returns 403 when no employee record is linked to the account", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    // no employeeUserLinkRows

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send(basePayload);

    expect(res.status).toBe(403);
  });

  it("returns 400 when reason is missing (same validation as HR direct entry)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockOwnEmployeeLinked();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...basePayload, reason: "" });

    expect(res.status).toBe(400);
  });
});

function mockPendingAdjustment(overrides: Record<string, unknown> = {}) {
  fixtures.attendanceAdjustmentRows = [
    {
      id: 1,
      organizationId: ORG_ID,
      employeeId: EMPLOYEE_ID,
      date: "2030-06-10",
      adjustmentType: "mark_present",
      correctedClockIn: null,
      correctedClockOut: null,
      reason: "Forgot to clock in",
      status: "pending",
      requestedByMembershipId: 9,
      decidedByMembershipId: null,
      decidedAt: null,
      createdAt: new Date(),
      ...overrides,
    },
  ];
}

describe("POST /api/organizations/:organizationId/attendance-adjustments/:id/approve", () => {
  it("returns 403 without attendance.adjustment.approve", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.read.own"]);
    mockPendingAdjustment();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("approves a pending request, setting decidedByMembershipId/decidedAt, preserving the original request fields", async () => {
    mockSession();
    mockActiveMembership(12);
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.decidedByMembershipId).toBe(12);
    expect(res.body.decidedAt).not.toBeNull();
    // Original request fields untouched.
    expect(res.body.requestedByMembershipId).toBe(9);
    expect(res.body.reason).toBe("Forgot to clock in");
    expect(res.body.employeeId).toBe(EMPLOYEE_ID);
  });

  it("records an attendance_adjustment.approved audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();

    await request(app).post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`).set("Authorization", "Bearer valid-token");

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("attendance_adjustment.approved");
  });

  it("returns 404 for a nonexistent adjustment", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    fixtures.attendanceAdjustmentRows = [];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/999/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("returns 409 when the adjustment is already approved (terminal state)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment({ status: "approved", decidedByMembershipId: 3, decidedAt: new Date() });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("returns 409 when the adjustment is already rejected (terminal state, no reopening)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment({ status: "rejected", decidedByMembershipId: 3, decidedAt: new Date() });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("returns 403 when the attendance module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();
    // module not enabled

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("denies cross-organization approval (adjustment belongs to another org)", async () => {
    mockSession();
    mockActiveMembership(5, OTHER_ORG_ID);
    mockAttendanceModuleEnabled(OTHER_ORG_ID);
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment(); // organizationId: ORG_ID

    const res = await request(app)
      .post(`/api/organizations/${OTHER_ORG_ID}/attendance-adjustments/1/approve`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/attendance-adjustments/:id/reject", () => {
  it("rejects a pending request, setting decidedByMembershipId/decidedAt", async () => {
    mockSession();
    mockActiveMembership(12);
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/reject`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.decidedByMembershipId).toBe(12);
    expect(res.body.decidedAt).not.toBeNull();
  });

  it("records an attendance_adjustment.rejected audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();

    await request(app).post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/reject`).set("Authorization", "Bearer valid-token");

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("attendance_adjustment.rejected");
  });

  it("returns 409 when the adjustment is already rejected (cannot reject twice)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment({ status: "rejected", decidedByMembershipId: 3, decidedAt: new Date() });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/reject`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("returns 409 when the adjustment is already approved (cannot reject an approved one)", async () => {
    mockSession();
    mockActiveMembership();
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment({ status: "approved", decidedByMembershipId: 3, decidedAt: new Date() });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/reject`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("a concurrent second decision on the same pending request is rejected as a conflict, not double-applied", async () => {
    mockSession();
    mockActiveMembership(12);
    mockAttendanceModuleEnabled();
    mockPermissions(["attendance.adjustment.approve"]);
    mockPendingAdjustment();

    const [first, second] = await Promise.all([
      request(app).post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/approve`).set("Authorization", "Bearer valid-token"),
      request(app).post(`/api/organizations/${ORG_ID}/attendance-adjustments/1/reject`).set("Authorization", "Bearer valid-token"),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one of the two decisions wins (200); the other finds the row
    // no longer pending (409) — never both succeeding, never a 500.
    expect(statuses).toEqual([200, 409]);
    expect(["approved", "rejected"]).toContain(fixtures.attendanceAdjustmentRows[0].status);
  });
});
