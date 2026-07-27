/**
 * Integration test for POST /api/organizations (onboarding), exercising the
 * real requireAuth middleware and onboardOrganization() through supertest.
 * @workspace/db is mocked — no real database connection is made. The mock's
 * `transaction()` runs the callback against a mock `tx` with the same
 * insert/select surface as `db`, so the whole onboarding transaction body
 * actually executes against the mock.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationsTable,
  organizationMembershipsTable,
  rolesTable,
  membershipRolesTable,
  primaryHrAssignmentsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      roleRows: [] as { id: number; key: string }[],
      forceSlugConflict: false,
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationsTable: { __name: "organizations" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    rolesTable: { __name: "roles" },
    membershipRolesTable: { __name: "membership_roles" },
    primaryHrAssignmentsTable: { __name: "primary_hr_assignments" },
    auditEventsTable: { __name: "audit_events" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function makeTx() {
  return {
    select: () => ({
      from(table: { __name: string }) {
        const rows = table === rolesTable ? fixtures.roleRows : [];
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return {
          returning: () => {
            if (table === organizationsTable && fixtures.forceSlugConflict) {
              return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
            }
            return Promise.resolve([{ id: nextId(table), ...v }]);
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(undefined).then(resolve, reject),
        };
      },
    }),
  };
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationsTable,
  organizationMembershipsTable,
  rolesTable,
  membershipRolesTable,
  primaryHrAssignmentsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(_table: unknown) {
        const rows = fixtures.sessionRows;
        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return Promise.resolve(undefined);
      },
    }),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
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

describe("POST /api/organizations (onboarding)", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.roleRows = [{ id: 1, key: "org_admin" }];
    fixtures.forceSlugConflict = false;
    fixtures.inserted = [];
    fixtures.idCounters = new Map();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app)
      .post("/api/organizations")
      .send({ name: "Acme", slug: "acme", type: "business" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a malformed body", async () => {
    mockSession({ id: 1 });

    const res = await request(app)
      .post("/api/organizations")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "" });

    expect(res.status).toBe(400);
  });

  it("creates the organization, the creator's membership, org_admin role, and Primary HR", async () => {
    mockSession({ id: 1 });

    const res = await request(app)
      .post("/api/organizations")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Acme", slug: "acme", type: "business" });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("acme");

    const tables = fixtures.inserted.map((i) => i.table);
    expect(tables).toContain("organizations");
    expect(tables).toContain("organization_memberships");
    expect(tables).toContain("membership_roles");
    expect(tables).toContain("primary_hr_assignments");
    expect(tables).toContain("audit_events");
  });

  it("returns 409 when the slug is already in use", async () => {
    mockSession({ id: 1 });
    fixtures.forceSlugConflict = true;

    const res = await request(app)
      .post("/api/organizations")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Acme", slug: "acme", type: "business" });

    expect(res.status).toBe(409);
  });
});
