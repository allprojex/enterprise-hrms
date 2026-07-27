/**
 * Integration test for POST /api/auth/switch-organization, exercising the
 * real requireAuth middleware, membership.ts, and the route handler through
 * supertest. @workspace/db is mocked — no real database connection is made.
 * This is the tenant-isolation test for organization switching: a caller
 * must never be able to switch into an organization they have no active
 * membership in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, usersTable, sessionsTable, organizationMembershipsTable, auditEventsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      updatedSessions: [] as unknown[],
      auditInserts: [] as unknown[],
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: unknown) {
        const rows = table === organizationMembershipsTable ? fixtures.membershipRows : fixtures.sessionRows;
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
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return Promise.resolve(undefined);
      },
    }),
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: () => {
          if (table === sessionsTable) fixtures.updatedSessions.push(v);
          return Promise.resolve(undefined);
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
      invitedAt: null,
      joinedAt: new Date(),
      expiresAt: null,
      revokedAt: null,
      revokedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

describe("POST /api/auth/switch-organization", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.updatedSessions = [];
    fixtures.auditInserts = [];
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).post("/api/auth/switch-organization").send({ organizationId: 10 });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no active membership in the target organization", async () => {
    mockSession({ id: 1 });
    fixtures.membershipRows = [];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .send({ organizationId: 99 });

    expect(res.status).toBe(403);
    expect(fixtures.updatedSessions).toHaveLength(0);
  });

  it("switches successfully and records an audit event when the caller has an active membership", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .send({ organizationId: 10 });

    expect(res.status).toBe(200);
    expect(fixtures.updatedSessions).toHaveLength(1);
    expect(fixtures.updatedSessions[0]).toMatchObject({ activeOrganizationId: 10 });
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "session.org_switch", organizationId: 10 });
  });

  it("returns 400 for a malformed body", async () => {
    mockSession({ id: 1 });

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
  });
});
