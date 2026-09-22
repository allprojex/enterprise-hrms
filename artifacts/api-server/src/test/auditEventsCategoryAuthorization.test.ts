/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #17) —
 * integration tests through supertest against the real app, requireAuth,
 * requireMembership, and the real permission-resolution chain
 * (getEffectivePermissions/resolveAllowedAuditCategories). @workspace/db is
 * mocked with real eq/and/inArray predicate matching (same convention as
 * reports.test.ts) so category filtering is actually exercised server-side,
 * not just assumed from the route's own code.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  function mockTableInner(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as { session: Record<string, unknown>; user: Record<string, unknown> }[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      auditRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTableInner("users", ["id"]),
    sessionsTable: mockTableInner("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTableInner("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTableInner("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTableInner("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTableInner("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTableInner("permissions", ["id", "key"]),
    auditEventsTable: mockTableInner("audit_events", ["organizationId", "category", "eventType", "targetType"]),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  auditEventsTable,
  db: {
    select: (cols?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;
        else if (table === auditEventsTable) rows = fixtures.auditRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => builder,
          limit: () => builder,
          offset: () => Promise.resolve(filtered),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            // GET /audit-events issues a plain count() select with no
            // .offset() in the count branch — resolve directly there too.
            if (cols && "value" in cols) {
              return Promise.resolve([{ value: filtered.length }]).then(resolve, reject);
            }
            return Promise.resolve(filtered).then(resolve, reject);
          },
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }) as Cond,
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }) as Cond,
  or: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }) as Cond,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: col.split(".").pop(), vals }) as Cond,
  desc: () => undefined,
  count: () => ({ value: "count" }),
}));

const { default: app } = await import("../app");

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: 10, disabledAt: null, createdAt: new Date() },
    },
  ];
}

function mockMembership(membershipId = 5, organizationId = 10) {
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
  fixtures.auditRows = [
    { id: 1, organizationId: 10, category: "hr", eventType: "employee.separated", targetType: "employee" },
    { id: 2, organizationId: 10, category: "payroll", eventType: "payroll_banking.read", targetType: "employee_banking_detail" },
    { id: 3, organizationId: 10, category: "security", eventType: "platform_user.disabled", targetType: "user" },
    { id: 4, organizationId: 99, category: "hr", eventType: "employee.separated", targetType: "employee" }, // different org
  ];
});

describe("GET /api/organizations/:organizationId/audit-events — category authorization", () => {
  it("403s a caller with none of the audit.read* permissions", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["employee.read"]);

    const res = await request(app).get("/api/organizations/10/audit-events").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("an HR-only audit reader sees only HR-category events, never Payroll or Security", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["audit.read.hr"]);

    const res = await request(app).get("/api/organizations/10/audit-events").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe("hr");
    expect(res.body.allowedCategories).toEqual(["hr"]);
  });

  it("a Payroll-only audit reader cannot read Security audit even by explicit category filter", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["audit.read.payroll"]);

    const res = await request(app)
      .get("/api/organizations/10/audit-events?category=security")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("a Payroll-only audit reader can explicitly filter to Payroll", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["audit.read.payroll"]);

    const res = await request(app)
      .get("/api/organizations/10/audit-events?category=payroll")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].category).toBe("payroll");
  });

  it("the broad legacy audit.read permission still sees every category (backward compatible)", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["audit.read"]);

    const res = await request(app).get("/api/organizations/10/audit-events").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3); // hr + payroll + security, all in org 10
    expect(res.body.allowedCategories).toBe("all");
  });

  it("an unknown category value is rejected with 400, not silently ignored", async () => {
    mockSession();
    mockMembership();
    mockPermissions(["audit.read"]);

    const res = await request(app)
      .get("/api/organizations/10/audit-events?category=not_a_real_category")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("never returns another organization's audit rows regardless of category permissions (tenant isolation preserved)", async () => {
    mockSession();
    mockMembership(5, 10);
    mockPermissions(["audit.read"]);

    const res = await request(app).get("/api/organizations/10/audit-events").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items.every((e: { organizationId: number }) => e.organizationId === 10)).toBe(true);
  });

  it("403s without any active membership in the target organization (unchanged pre-existing behavior)", async () => {
    mockSession();
    fixtures.membershipRows = [];

    const res = await request(app).get("/api/organizations/10/audit-events").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});
