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
  employeeUserLinksTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      departmentRows: [] as { organizationId: number }[],
      employeeRows: [{ value: 0 }] as unknown[],
      linkRows: [] as { employeeId: number; applicationUserId: number }[],
      inserted: [] as { table: string; values: unknown }[],
      deleted: [] as { table: string }[],
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
    employeeUserLinksTable: { __name: "employee_user_links" },
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
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.linkRows;
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
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.deleted.push({ table: table.__name });
        return Promise.resolve(undefined);
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          if (table === employeesTable) {
            const current = (fixtures.employeeRows[0] as Record<string, unknown>) ?? {};
            const updated = { ...current, ...v };
            fixtures.employeeRows = [updated];
            return { returning: () => Promise.resolve([updated]) };
          }
          return { returning: () => Promise.resolve([]) };
        },
      }),
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

describe("GET /api/organizations/:organizationId/employees/:employeeId (link status)", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.linkRows = [];
  });

  it("returns linkedApplicationUserId null when the employee has no link", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [];

    const res = await request(app)
      .get("/api/organizations/10/employees/42")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.linkedApplicationUserId).toBeNull();
  });

  it("returns linkedApplicationUserId when the employee is linked", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .get("/api/organizations/10/employees/42")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.linkedApplicationUserId).toBe(7);
  });
});

describe("DELETE /api/organizations/:organizationId/employees/:employeeId/link-user", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.linkRows = [];
    fixtures.deleted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee is not linked", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("unlinks the employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.some((d) => d.table === "employee_user_links")).toBe(true);
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/separate", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("separates an active employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01", separationReason: "resigned" });

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("terminated");
    expect(res.body.separationReason).toBe("resigned");
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });

  it("returns 400 when the employee is already separated", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/rehire", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(403);
  });

  it("rehires a separated employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [
      { id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", separationDate: new Date(), separationReason: "resigned" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("active");
    expect(res.body.separationDate).toBeNull();
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });

  it("returns 400 when the employee is not currently separated", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
  });
});
