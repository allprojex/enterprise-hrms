/**
 * Integration tests for Disciplinary Records (Phase 2A, W28), exercising the
 * real requireAuth/requireMembership/requirePermission chain and route
 * handlers through supertest, mirroring employeeDocuments.test.ts's harness
 * shape. @workspace/db is mocked — no real database connection is made.
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
  employeesTable,
  employeeDisciplinaryRecordsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as { id: number; organizationId: number; firstName: string; lastName: string }[],
      recordRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolesTable: { __name: "roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    employeeDisciplinaryRecordsTable: { __name: "employee_disciplinary_records" },
    auditEventsTable: { __name: "audit_events" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeDisciplinaryRecordsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeDisciplinaryRecordsTable) rows = fixtures.recordRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return { returning: () => Promise.resolve([{ id: nextId(table), createdAt: new Date(), ...v }]) };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  desc: () => "desc",
  inArray: () => "inArray",
}));

const { default: app } = await import("../app");

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
        organizationId: 10,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = 10) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.recordRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("GET /api/organizations/:organizationId/employees/:employeeId/disciplinary-records", () => {
  it("returns 403 when the membership's role lacks employee.disciplinary.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read", "employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.disciplinary.read"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("lists disciplinary records for the employee", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.disciplinary.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.recordRows = [
      {
        id: 1,
        organizationId: 10,
        employeeId: 42,
        actionType: "written_warning",
        description: "Late to work repeatedly",
        actionDate: new Date(),
        recordedBy: 1,
        createdAt: new Date(),
      },
    ];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].actionType).toBe("written_warning");
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/disciplinary-records", () => {
  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.disciplinary.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token")
      .send({ actionType: "verbal_warning", description: "Missed deadline", actionDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token")
      .send({ actionType: "verbal_warning", description: "Missed deadline", actionDate: "2026-01-01" });

    expect(res.status).toBe(404);
  });

  it("adds a disciplinary record and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/disciplinary-records")
      .set("Authorization", "Bearer valid-token")
      .send({ actionType: "verbal_warning", description: "Missed deadline", actionDate: "2026-01-01" });

    expect(res.status).toBe(201);
    expect(res.body.actionType).toBe("verbal_warning");
    const recordInsert = fixtures.inserted.find((i) => i.table === "employee_disciplinary_records");
    expect(recordInsert).toBeDefined();
    expect((recordInsert!.values as Record<string, unknown>).organizationId).toBe(10);
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_disciplinary_record.added");
  });
});
