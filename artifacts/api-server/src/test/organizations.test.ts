/**
 * Integration test for GET /api/organizations/:id, exercising the real
 * requireAuth middleware and route handler through supertest. @workspace/db
 * is mocked so the suite never opens a real database connection; the mock
 * resolves rows based on which table `.from()` was called with, mirroring
 * the shape drizzle-orm's query builder returns.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, organizationsTable, sessionsTable, usersTable, notificationsTable, auditEventsTable } =
  vi.hoisted(() => {
    return {
      fixtures: {
        sessionRows: [] as unknown[],
        orgRows: [] as Record<string, unknown>[],
        auditEvents: [] as Record<string, unknown>[],
        slugConflict: false,
      },
      organizationsTable: { __name: "organizations" },
      sessionsTable: { __name: "sessions" },
      usersTable: { __name: "users" },
      notificationsTable: { __name: "notifications" },
      auditEventsTable: { __name: "audit_events" },
    };
  });

vi.mock("@workspace/db", () => ({
  organizationsTable,
  sessionsTable,
  usersTable,
  notificationsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: unknown) {
        const rows = table === organizationsTable ? fixtures.orgRows : fixtures.sessionRows;
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
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (table !== organizationsTable) return Promise.resolve([]);
            if (fixtures.slugConflict) {
              return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
            }
            const updated = { ...fixtures.orgRows[0], ...patch };
            fixtures.orgRows = [updated];
            return Promise.resolve([updated]);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.auditEvents.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  gt: () => "gt",
}));

const { default: app } = await import("../app");

function mockSession(user: { id: number; role: string; organizationId: number }) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: user.id, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: user.id,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: user.role,
        organizationId: user.organizationId,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockOrganization(id: number) {
  fixtures.orgRows = [
    {
      id,
      name: `Org ${id}`,
      slug: `org-${id}`,
      type: "business",
      status: "active",
      logoUrl: null,
      industry: null,
      employeeCount: null,
      createdAt: new Date(),
    },
  ];
}

describe("GET /api/organizations/:id", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
    fixtures.auditEvents = [];
    fixtures.slugConflict = false;
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/api/organizations/1");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token does not match an active session", async () => {
    const res = await request(app)
      .get("/api/organizations/1")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 when a user requests their own organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .get("/api/organizations/10")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  it("returns 403 when a user requests a different organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .get("/api/organizations/99")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 200 when a super_admin requests a different organization", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .get("/api/organizations/99")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(99);
  });
});

describe("PATCH /api/organizations/:id", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
    fixtures.auditEvents = [];
    fixtures.slugConflict = false;
  });

  it("returns 403 when a non-admin member of the organization attempts to update it", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .patch("/api/organizations/10")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when an org_admin targets a different organization", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .patch("/api/organizations/99")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("updates the organization and records an audit event when the org_admin owns it", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .patch("/api/organizations/10")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Renamed Org" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Org");
    expect(fixtures.auditEvents).toHaveLength(1);
    expect(fixtures.auditEvents[0].eventType).toBe("organization.updated");
  });

  it("returns 409 when the new slug is already in use", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);
    fixtures.slugConflict = true;

    const res = await request(app)
      .patch("/api/organizations/99")
      .set("Authorization", "Bearer valid-token")
      .send({ slug: "taken-slug" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/organizations/:id/suspend and /reactivate", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
    fixtures.auditEvents = [];
    fixtures.slugConflict = false;
  });

  it("returns 403 when a non-admin member attempts to suspend the organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .post("/api/organizations/10/suspend")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("suspends the organization and records an audit event when the org_admin owns it", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .post("/api/organizations/10/suspend")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");
    expect(fixtures.auditEvents[0].eventType).toBe("organization.suspended");
  });

  it("reactivates a suspended organization for a super_admin", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .post("/api/organizations/99/reactivate")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(fixtures.auditEvents[0].eventType).toBe("organization.reactivated");
  });
});
