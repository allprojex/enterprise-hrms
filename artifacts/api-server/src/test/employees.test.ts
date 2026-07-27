/**
 * Integration tests for the employee directory routes, exercising the real
 * requireAuth/requireMembership/requirePermission chain and route handlers
 * through supertest. @workspace/db is mocked — no real database connection
 * is made. Covers the security-critical paths: unauthenticated, no active
 * membership (tenant isolation), a role without the required permission,
 * a successful create, and a cross-organization reference being rejected
 * (the same class of bug already found and fixed on GET /organizations/:id).
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
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      departmentRows: [] as { organizationId: number }[],
      employeeRows: [{ value: 0 }] as unknown[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    departmentsTable: { __name: "departments" },
    branchesTable: { __name: "branches" },
    positionsTable: { __name: "positions" },
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
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable: { __name: "employee_user_links" },
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => builder,
          offset: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return {
          returning: () => Promise.resolve([{ id: nextId(table), ...v }]),
        };
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
  ilike: () => "ilike",
  inArray: () => "inArray",
  desc: () => "desc",
  count: () => "count",
}));

const { default: app } = await import("../app");

function mockSession(user: { id: number }) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: user.id, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: user.id,
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

function mockActiveMembership(membership: { id: number; organizationId: number }) {
  fixtures.membershipRows = [
    {
      id: membership.id,
      applicationUserId: 1,
      organizationId: membership.organizationId,
      status: "active",
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

describe("POST /api/organizations/:organizationId/employees", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.departmentRows = [];
    fixtures.inserted = [];
    fixtures.idCounters = new Map();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app)
      .post("/api/organizations/10/employees")
      .send({ firstName: "Ada", lastName: "Lovelace" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no active membership in the organization (tenant isolation)", async () => {
    mockSession({ id: 1 });
    fixtures.membershipRows = [];

    const res = await request(app)
      .post("/api/organizations/99/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("creates an employee with an auto-generated employee number when authorized", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe("Ada");
    expect(res.body.employeeNumber).toBe("EMP-0001");
    const employeeInsert = fixtures.inserted.find((i) => i.table === "employees");
    expect(employeeInsert).toBeDefined();
    expect((employeeInsert!.values as Record<string, unknown>).organizationId).toBe(10);
  });

  it("rejects a department reference that belongs to a different organization", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.departmentRows = [{ organizationId: 999 }];

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace", departmentId: 3 });

    expect(res.status).toBe(400);
    expect(fixtures.inserted.find((i) => i.table === "employees")).toBeUndefined();
  });
});
