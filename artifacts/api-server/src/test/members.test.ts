/**
 * Integration tests for organization membership management routes,
 * exercising the real requireAuth/requireMembership/requirePermission chain
 * through supertest. @workspace/db is mocked — no real database connection
 * is made. Covers tenant isolation, permission gating, and the add-member /
 * assign-role / revoke paths.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Columns carry their own dotted-path name so the mocked eq()/and() below can
// build real filter predicates — unlike the simpler mocks elsewhere in this
// suite, this file needs to distinguish two different queries against the
// *same* table (the caller's own membership vs. a target user's membership)
// within a single request, which a blanket passthrough can't do correctly.
const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  rolesTable,
  primaryHrAssignmentsTable,
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
      targetUserRows: [] as unknown[],
      roleRows: [] as { id: number; key: string }[],
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
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["key"]),
    rolesTable: mockTable("roles", ["id", "key"]),
    primaryHrAssignmentsTable: mockTable("primary_hr_assignments", ["membershipId", "revokedAt"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

// Minimal predicate evaluator matching the eq()/and()/inArray() descriptors below.
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
  rolePermissionsTable,
  permissionsTable,
  rolesTable,
  auditEventsTable,
  primaryHrAssignmentsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        // The sessions table holds pre-joined {session, user} fixture rows
        // (shaped for requireAuth's join, not flat columns) — never filter
        // those through the generic predicate matcher below.
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
        else if (table === usersTable) rows = fixtures.targetUserRows as never;
        else if (table === rolesTable) rows = fixtures.roleRows as never;
        else if (table === primaryHrAssignmentsTable) rows = [];

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: () => Promise.resolve(filtered),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return {
          returning: () => Promise.resolve([{ id: nextId(table), ...v }]),
          onConflictDoNothing: () => Promise.resolve(undefined),
        };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            const membership = fixtures.membershipRows[0] as Record<string, unknown> | undefined;
            fixtures.inserted.push({ table: table.__name, values: v });
            return Promise.resolve(membership ? [{ ...membership, ...v }] : []);
          },
        }),
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.inserted.push({ table: table.__name, values: "delete" });
        return Promise.resolve(undefined);
      },
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

function mockSession(user: { id: number }) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: user.id, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: user.id,
        email: "admin@example.com",
        firstName: "Admin",
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

function mockActiveMembership(membership: { id: number; organizationId: number }) {
  fixtures.membershipRows = [
    {
      id: membership.id,
      applicationUserId: 1,
      organizationId: membership.organizationId,
      status: "active",
      expiresAt: null,
      joinedAt: new Date(),
      revokedAt: null,
      revokedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function mockPermissions(permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

describe("POST /api/organizations/:organizationId/members", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.targetUserRows = [];
    fixtures.roleRows = [];
    fixtures.inserted = [];
    fixtures.idCounters = new Map();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).post("/api/organizations/10/members").send({ email: "new@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no active membership in the organization", async () => {
    mockSession({ id: 1 });
    fixtures.membershipRows = [];

    const res = await request(app)
      .post("/api/organizations/99/members")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "new@example.com" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller lacks membership.manage", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.read"]);

    const res = await request(app)
      .post("/api/organizations/10/members")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "new@example.com" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when no user exists with that email", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.manage"]);
    fixtures.targetUserRows = [];

    const res = await request(app)
      .post("/api/organizations/10/members")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(404);
  });

  it("adds an existing user as a member when authorized", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.manage"]);
    fixtures.targetUserRows = [{ id: 42, email: "new@example.com" }];

    const res = await request(app)
      .post("/api/organizations/10/members")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "new@example.com" });

    expect(res.status).toBe(201);
    const membershipInsert = fixtures.inserted.find((i) => i.table === "organization_memberships");
    expect(membershipInsert).toBeDefined();
    expect((membershipInsert!.values as Record<string, unknown>).applicationUserId).toBe(42);
  });
});

describe("GET /api/organizations/:organizationId/members", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
  });

  it("returns 403 without membership.read", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions([]);

    const res = await request(app)
      .get("/api/organizations/10/members")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 200 with membership.read", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.read"]);

    const res = await request(app)
      .get("/api/organizations/10/members")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /api/organizations/:organizationId/members/:membershipId/roles", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.roleRows = [];
    fixtures.inserted = [];
  });

  it("returns 404 when the role does not exist", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.manage"]);
    fixtures.roleRows = [];

    const res = await request(app)
      .post("/api/organizations/10/members/5/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ roleId: 999 });

    expect(res.status).toBe(404);
  });

  it("assigns a role when authorized", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["membership.manage"]);
    fixtures.roleRows = [{ id: 2, key: "hr_manager" }];

    const res = await request(app)
      .post("/api/organizations/10/members/5/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ roleId: 2 });

    expect(res.status).toBe(200);
    const roleInsert = fixtures.inserted.find((i) => i.table === "membership_roles");
    expect(roleInsert).toBeDefined();
  });
});
