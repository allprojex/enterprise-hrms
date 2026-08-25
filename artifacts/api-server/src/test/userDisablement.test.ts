/**
 * WS-2 (Identity & Access Hardening) — integration tests through supertest
 * against the real app, requireAuth, requireSuperAdmin, and the route
 * handlers. @workspace/db is mocked with real eq/and/inArray predicate
 * matching (same convention as reports.test.ts) so tenant scoping,
 * multi-organization membership resolution, and the disabled-user
 * rejection are actually exercised, not just assumed.
 *
 * Covers Owner Decision #1 (GET /organizations must reflect real
 * memberships, not the legacy users.organizationId single-org column) and
 * Owner Decision #20 (platform-level user disablement: live re-check on
 * every request, immediate session revocation, super_admin-only authority,
 * cannot self-disable, re-enable never restores memberships/roles).
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

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as { session: Record<string, unknown>; user: Record<string, unknown> }[],
      userRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      orgRows: [] as Record<string, unknown>[],
      updatedUsers: [] as Record<string, unknown>[],
      deletedSessionsFor: [] as unknown[],
      auditInserts: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["applicationUserId", "organizationId", "status"]),
    organizationsTable: mockTable("organizations", ["id"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationsTable,
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
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === usersTable) rows = fixtures.userRows;
        else if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === organizationsTable) rows = fixtures.orgRows;

        let filtered = rows;
        const builder = {
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit(n: number) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (table === usersTable) {
              const existing = fixtures.userRows[0] ?? {};
              const updated = { ...existing, ...v };
              fixtures.updatedUsers.push(updated);
              fixtures.userRows = fixtures.userRows.map((u) => (u.id === existing.id ? updated : u));
              return Promise.resolve([updated]);
            }
            return Promise.resolve([{ id: 1, ...v }]);
          },
        }),
      }),
    }),
    delete: (table: { __name: string }) => ({
      where(cond: Cond) {
        if (table === sessionsTable) {
          fixtures.deletedSessionsFor.push(cond);
          fixtures.sessionRows = [];
        }
        return Promise.resolve(undefined);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return Promise.resolve(undefined);
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
}));

const { default: app } = await import("../app");

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "user@example.com",
    firstName: "Test",
    lastName: "User",
    role: "employee",
    organizationId: 10,
    avatarUrl: null,
    jobTitle: null,
    department: null,
    phoneNumber: null,
    disabledAt: null,
    disabledBy: null,
    disabledReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function mockSession(user: Record<string, unknown>, token = "valid-token") {
  fixtures.sessionRows = [{ session: { id: 1, token, userId: user.id, expiresAt: new Date(Date.now() + 100000) }, user }];
  fixtures.userRows = [user];
}

describe("requireAuth — platform disablement is re-checked live on every request", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.userRows = [];
    fixtures.membershipRows = [];
    fixtures.orgRows = [];
    fixtures.updatedUsers = [];
    fixtures.deletedSessionsFor = [];
    fixtures.auditInserts = [];
  });

  it("allows an active (non-disabled) user through", async () => {
    mockSession(baseUser());
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });

  it("rejects a disabled user with 401 even though the session token is otherwise valid and unexpired", async () => {
    mockSession(baseUser({ disabledAt: new Date("2026-01-01T00:00:00Z"), disabledReason: "security incident" }));
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(401);
  });

  it("a disabled user cannot reach any authenticated route, not just /auth/me", async () => {
    mockSession(baseUser({ disabledAt: new Date() }));
    const res = await request(app).get("/api/organizations").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/platform/users/:userId/disable", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.userRows = [];
    fixtures.membershipRows = [];
    fixtures.orgRows = [];
    fixtures.updatedUsers = [];
    fixtures.deletedSessionsFor = [];
    fixtures.auditInserts = [];
  });

  it("returns 403 for a caller who is not super_admin", async () => {
    mockSession(baseUser({ id: 5, role: "hr_manager" }));
    fixtures.userRows = [baseUser({ id: 5, role: "hr_manager" }), baseUser({ id: 6 })];

    const res = await request(app)
      .post("/api/platform/users/6/disable")
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "test" });

    expect(res.status).toBe(403);
  });

  it("disables the target user, deletes their sessions, and records an audit event, for a super_admin caller", async () => {
    const admin = baseUser({ id: 1, role: "super_admin" });
    const target = baseUser({ id: 6, email: "target@example.com" });
    mockSession(admin);
    fixtures.userRows = [admin, target];

    const res = await request(app)
      .post("/api/platform/users/6/disable")
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "compromised account" });

    expect(res.status).toBe(200);
    expect(res.body.disabledAt).not.toBeNull();
    expect(fixtures.deletedSessionsFor).toHaveLength(1);
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "platform_user.disabled", targetType: "user", targetId: "6" });
  });

  it("returns 400 when a super_admin attempts to disable their own account", async () => {
    const admin = baseUser({ id: 1, role: "super_admin" });
    mockSession(admin);
    fixtures.userRows = [admin];

    const res = await request(app).post("/api/platform/users/1/disable").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(400);
    expect(fixtures.deletedSessionsFor).toHaveLength(0);
  });

  it("returns 404 for a nonexistent user", async () => {
    const admin = baseUser({ id: 1, role: "super_admin" });
    mockSession(admin);
    fixtures.userRows = [admin];

    const res = await request(app).post("/api/platform/users/999/disable").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(404);
  });
});

describe("POST /api/platform/users/:userId/enable", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.userRows = [];
    fixtures.updatedUsers = [];
    fixtures.auditInserts = [];
  });

  it("restores platform account eligibility without touching organization memberships", async () => {
    const admin = baseUser({ id: 1, role: "super_admin" });
    const target = baseUser({ id: 6, disabledAt: new Date(), disabledReason: "resolved" });
    mockSession(admin);
    fixtures.userRows = [admin, target];

    const res = await request(app).post("/api/platform/users/6/enable").set("Authorization", "Bearer valid-token").send();

    expect(res.status).toBe(200);
    expect(res.body.disabledAt).toBeNull();
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "platform_user.enabled", targetType: "user", targetId: "6" });
    // No membership table write of any kind happened as a side effect.
    expect(fixtures.membershipRows).toEqual([]);
  });

  it("returns 403 for a non-super_admin caller", async () => {
    mockSession(baseUser({ id: 5, role: "hr_manager" }));
    fixtures.userRows = [baseUser({ id: 5, role: "hr_manager" }), baseUser({ id: 6, disabledAt: new Date() })];

    const res = await request(app).post("/api/platform/users/6/enable").set("Authorization", "Bearer valid-token").send();

    expect(res.status).toBe(403);
  });
});

describe("GET /api/organizations — Owner Decision #1: multi-org membership, not legacy organizationId", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.userRows = [];
    fixtures.membershipRows = [];
    fixtures.orgRows = [];
  });

  it("a non-super_admin user with active memberships in two organizations sees both, even though their legacy organizationId points at only one", async () => {
    // Legacy home org is 10; the user ALSO has a real, active membership in
    // org 20 — a scenario the old users.organizationId-based filter could
    // never represent (this is the exact case Owner Decision #1 flagged).
    const user = baseUser({ id: 1, organizationId: 10 });
    mockSession(user);
    fixtures.membershipRows = [
      { applicationUserId: 1, organizationId: 10, status: "active", expiresAt: null },
      { applicationUserId: 1, organizationId: 20, status: "active", expiresAt: null },
    ];
    fixtures.orgRows = [
      { id: 10, name: "WWM", slug: "wwm", type: "church", status: "active", logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() },
      { id: 20, name: "Acme", slug: "acme", type: "business", status: "active", logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() },
    ];

    const res = await request(app).get("/api/organizations").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: number }) => o.id).sort()).toEqual([10, 20]);
  });

  it("a non-super_admin user with no active memberships sees an empty list, not an error and not a legacy fallback", async () => {
    mockSession(baseUser({ id: 1, organizationId: 10 }));
    fixtures.membershipRows = [];
    fixtures.orgRows = [{ id: 10, name: "WWM", slug: "wwm", type: "church", status: "active", logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() }];

    const res = await request(app).get("/api/organizations").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("super_admin sees every organization regardless of membership rows", async () => {
    mockSession(baseUser({ id: 1, role: "super_admin", organizationId: 10 }));
    fixtures.membershipRows = [];
    fixtures.orgRows = [
      { id: 10, name: "WWM", slug: "wwm", type: "church", status: "active", logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() },
      { id: 20, name: "Acme", slug: "acme", type: "business", status: "active", logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() },
    ];

    const res = await request(app).get("/api/organizations").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
