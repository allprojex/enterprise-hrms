/**
 * Integration tests for the Organization Structure Service (W12, ADR-012):
 * hierarchy validation on create, and the restructure endpoints for
 * departments/positions. @workspace/db is mocked — no real database
 * connection is made. Mirrors members.test.ts's harness shape.
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
  branchesTable,
  departmentsTable,
  positionsTable,
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
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number; membershipId?: number }[],
      permissionRows: [] as { key: string }[],
      branchRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
    ]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["key"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "name", "code", "status"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "branchId", "parentDepartmentId", "name", "code"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title", "departmentId"]),
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
  | { __op: "in"; field: string; vals: unknown[] }
  | { __op: "and"; conds: Cond[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
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
  branchesTable,
  departmentsTable,
  positionsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;
        else if (table === branchesTable) rows = fixtures.branchRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === positionsTable) rows = fixtures.positionRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return { returning: () => Promise.resolve([{ id: nextId(table), ...v }]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            fixtures.inserted.push({ table: table.__name, values: v });
            const base =
              table === departmentsTable
                ? fixtures.departmentRows[0]
                : table === positionsTable
                  ? fixtures.positionRows[0]
                  : fixtures.branchRows[0];
            return Promise.resolve(base ? [{ ...base, ...v }] : []);
          },
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: col.split(".").pop(), vals }),
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
        role: "org_admin",
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
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.branchRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/departments (hierarchy validation)", () => {
  it("rejects a branchId belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 99, name: "Other Org Branch", code: "OOB", status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/departments")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Sales", code: "SALES", branchId: 1 });

    expect(res.status).toBe(400);
  });

  it("creates the department when branchId/parentDepartmentId belong to the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ", code: "HQ", status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/departments")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Sales", code: "SALES", branchId: 1 });

    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/organizations/:organizationId/departments/:id/restructure", () => {
  it("returns 404 when the department is not in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/departments/1/restructure")
      .set("Authorization", "Bearer valid-token")
      .send({ branchId: null });

    expect(res.status).toBe(404);
  });

  it("rejects a move that would make the department its own ancestor", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    // Department 1 is department 2's parent; moving 1 under 2 is a cycle.
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Parent", code: "P" },
      { id: 2, organizationId: 10, branchId: null, parentDepartmentId: 1, name: "Child", code: "C" },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/departments/1/restructure")
      .set("Authorization", "Bearer valid-token")
      .send({ parentDepartmentId: 2 });

    expect(res.status).toBe(400);
  });

  it("moves the department and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Sales", code: "SALES" },
    ];
    fixtures.branchRows = [{ id: 2, organizationId: 10, name: "Branch B", code: "BB", status: "active" }];

    const res = await request(app)
      .patch("/api/organizations/10/departments/1/restructure")
      .set("Authorization", "Bearer valid-token")
      .send({ branchId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.branchId).toBe(2);
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });
});

describe("PATCH /api/organizations/:organizationId/positions/:id/restructure", () => {
  it("returns 404 when the position is not in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["position.manage"]);
    fixtures.positionRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/positions/1/restructure")
      .set("Authorization", "Bearer valid-token")
      .send({ departmentId: null });

    expect(res.status).toBe(404);
  });

  it("moves the position to a different department", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["position.manage"]);
    fixtures.positionRows = [{ id: 1, organizationId: 10, title: "Engineer", departmentId: null }];
    fixtures.departmentRows = [{ id: 3, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Eng", code: "ENG" }];

    const res = await request(app)
      .patch("/api/organizations/10/positions/1/restructure")
      .set("Authorization", "Bearer valid-token")
      .send({ departmentId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBe(3);
  });
});

describe("PATCH /api/organizations/:organizationId/branches/:id", () => {
  it("returns 404 when the branch is not in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["branch.manage"]);
    fixtures.branchRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/branches/1")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "HQ Renamed" });

    expect(res.status).toBe(404);
  });

  it("updates the branch's name/code", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["branch.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ", code: "HQ", status: "active" }];

    const res = await request(app)
      .patch("/api/organizations/10/branches/1")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Headquarters" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Headquarters");
  });
});

describe("POST /api/organizations/:organizationId/branches/:id/archive and /reactivate", () => {
  it("rejects archiving a branch that still has departments", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["branch.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ", code: "HQ", status: "active" }];
    fixtures.departmentRows = [
      { id: 5, organizationId: 10, branchId: 1, parentDepartmentId: null, name: "Sales", code: "SALES" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/branches/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
  });

  it("archives a branch with no dependents and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["branch.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ", code: "HQ", status: "active" }];
    fixtures.departmentRows = [];

    const res = await request(app)
      .post("/api/organizations/10/branches/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inactive");
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });

  it("reactivates an archived branch", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["branch.manage"]);
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ", code: "HQ", status: "inactive" }];

    const res = await request(app)
      .post("/api/organizations/10/branches/1/reactivate")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});

describe("PATCH /api/organizations/:organizationId/departments/:id", () => {
  it("updates the department's name/code", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Sales", code: "SALES", status: "active" },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/departments/1")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Sales & Marketing" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Sales & Marketing");
  });
});

describe("POST /api/organizations/:organizationId/departments/:id/archive and /reactivate", () => {
  it("rejects archiving a department that still has positions", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Sales", code: "SALES", status: "active" },
    ];
    fixtures.positionRows = [{ id: 9, organizationId: 10, title: "Rep", departmentId: 1, status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/departments/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
  });

  it("archives a department with no dependents", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Sales", code: "SALES", status: "active" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/departments/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inactive");
  });

  it("reactivates an archived department", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["department.manage"]);
    fixtures.departmentRows = [
      { id: 1, organizationId: 10, branchId: null, parentDepartmentId: null, name: "Sales", code: "SALES", status: "inactive" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/departments/1/reactivate")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});

describe("PATCH /api/organizations/:organizationId/positions/:id", () => {
  it("updates the position's title", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["position.manage"]);
    fixtures.positionRows = [{ id: 1, organizationId: 10, title: "Engineer", departmentId: null, status: "active" }];

    const res = await request(app)
      .patch("/api/organizations/10/positions/1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Senior Engineer" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Senior Engineer");
  });
});

describe("POST /api/organizations/:organizationId/positions/:id/archive and /reactivate", () => {
  it("archives a position", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["position.manage"]);
    fixtures.positionRows = [{ id: 1, organizationId: 10, title: "Engineer", departmentId: null, status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/positions/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inactive");
  });

  it("reactivates an archived position", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["position.manage"]);
    fixtures.positionRows = [{ id: 1, organizationId: 10, title: "Engineer", departmentId: null, status: "inactive" }];

    const res = await request(app)
      .post("/api/organizations/10/positions/1/reactivate")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});
