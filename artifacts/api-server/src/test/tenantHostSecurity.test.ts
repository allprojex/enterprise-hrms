/**
 * Route-level security tests for the Multi-Organization Tenant
 * Infrastructure: hostname-resolved tenant context denying login and
 * switch-organization across a mismatched hostname, platform-admin-only
 * domain management, and the safe public tenant-context endpoint. Exercises
 * the real app/middleware chain through supertest; @workspace/db is mocked
 * with a condition-evaluating select (same convention as
 * active-organization.test.ts) so different organizationId/hostname inputs
 * genuinely resolve to different fixture rows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationDomainsTable,
  organizationsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      userRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      domainRows: [] as Record<string, unknown>[],
      orgRows: [] as Record<string, unknown>[],
      insertedSessions: [] as Record<string, unknown>[],
      updatedSessions: [] as Record<string, unknown>[],
      auditInserts: [] as Record<string, unknown>[],
    },
    usersTable: { __name: "users", email: "email" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: {
      __name: "organization_memberships",
      applicationUserId: "applicationUserId",
      organizationId: "organizationId",
      status: "status",
      expiresAt: "expiresAt",
    },
    organizationDomainsTable: {
      __name: "organization_domains",
      hostname: "hostname",
      status: "status",
      organizationId: "organizationId",
    },
    organizationsTable: { __name: "organizations", id: "id" },
    auditEventsTable: { __name: "audit_events" },
  };
});

type Condition =
  | { op: "eq"; field: string; value: unknown }
  | { op: "and" | "or"; conditions: Condition[] }
  | { op: "gt"; field: string; value: unknown }
  | { op: "isNull"; field: string }
  | null
  | undefined;

function evalCondition(cond: Condition, row: Record<string, unknown>): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "eq":
      return row[cond.field] === cond.value;
    case "and":
      return cond.conditions.every((c) => evalCondition(c, row));
    case "or":
      return cond.conditions.some((c) => evalCondition(c, row));
    case "isNull":
      return row[cond.field] == null;
    case "gt":
      return true;
    default:
      return true;
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (field: string, value: unknown) => ({ op: "eq", field, value }),
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  gt: (field: string, value: unknown) => ({ op: "gt", field, value }),
  isNull: (field: string) => ({ op: "isNull", field }),
  ne: () => ({ op: "eq", field: "__never__", value: "__never__" }),
}));

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationDomainsTable,
  organizationsTable,
  auditEventsTable,
  db: {
    select: (_cols?: unknown) => ({
      from(table: unknown) {
        // requireAuth's session+user innerJoin — unfiltered, matching the
        // convention every other auth-focused test file already uses.
        if (table === sessionsTable) {
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(fixtures.sessionRows),
            then: (resolve: (v: unknown) => void) => resolve(fixtures.sessionRows),
          };
          return builder;
        }

        const rows: Record<string, unknown>[] =
          table === usersTable
            ? fixtures.userRows
            : table === organizationMembershipsTable
              ? fixtures.membershipRows
              : table === organizationDomainsTable
                ? fixtures.domainRows
                : table === organizationsTable
                  ? fixtures.orgRows
                  : [];

        let condition: Condition = null;
        const builder = {
          innerJoin: () => builder,
          where: (cond: Condition) => {
            condition = cond;
            return builder;
          },
          limit: (n: number) => Promise.resolve(rows.filter((r) => evalCondition(condition, r)).slice(0, n)),
          then: (resolve: (v: unknown) => void) =>
            resolve(rows.filter((r) => evalCondition(condition, r))),
        };
        return builder;
      },
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === sessionsTable) fixtures.insertedSessions.push(v);
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return {
          returning: () => Promise.resolve([{ id: 1, ...v }]),
          then: (resolve: (x: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          if (table === sessionsTable) fixtures.updatedSessions.push(v);
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

const { default: app } = await import("../app");
const { hashPassword } = await import("../lib/auth");

const REAL_PASSWORD = "correct-horse-battery";
const REAL_PASSWORD_HASH = await hashPassword(REAL_PASSWORD);

function user(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: "admin@wwm.test",
    firstName: "WWM",
    lastName: "Admin",
    role: "org_admin",
    organizationId: 3,
    avatarUrl: null,
    jobTitle: null,
    department: null,
    phoneNumber: null,
    createdAt: new Date(),
    passwordHash: REAL_PASSWORD_HASH,
    ...overrides,
  };
}

function mockSession(overrides: Partial<Record<string, unknown>> = {}) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: 1, expiresAt: new Date(Date.now() + 100000), activeOrganizationId: 3 },
      user: user(overrides),
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.userRows = [];
  fixtures.membershipRows = [];
  fixtures.domainRows = [];
  fixtures.orgRows = [];
  fixtures.insertedSessions = [];
  fixtures.updatedSessions = [];
  fixtures.auditInserts = [];
});

describe("GET /api/tenant-context", () => {
  it("returns resolved:false for an unmapped hostname", async () => {
    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "nobody.localhost");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resolved: false });
  });

  it("returns resolved:false for a suspended organization even with an active domain (fails safely)", async () => {
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "suspended" }];
    fixtures.orgRows = [{ id: 3, name: "wwm", slug: "wwm", type: "church", status: "suspended", logoUrl: null }];
    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resolved: false });
  });

  it("returns the safe DTO for a resolved, active tenant — no sensitive fields", async () => {
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "trial" }];
    fixtures.orgRows = [{ id: 3, name: "wwm", slug: "wwm", type: "church", status: "trial", logoUrl: null }];
    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resolved: true,
      organizationId: 3,
      organizationName: "wwm",
      organizationSlug: "wwm",
      organizationType: "church",
      logoUrl: null,
    });
    expect(res.body.employees).toBeUndefined();
    expect(res.body.adminEmail).toBeUndefined();
  });
});

describe("POST /api/auth/login — hostname/organization consistency", () => {
  it("logs in normally when no tenant hostname is resolved", async () => {
    fixtures.userRows = [user()];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];
    const res = await request(app).post("/api/auth/login").send({ email: "admin@wwm.test", password: REAL_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("denies login with valid credentials when the resolved tenant hostname names an organization the account has no membership in", async () => {
    fixtures.userRows = [user({ organizationId: 3 })];
    fixtures.domainRows = [{ hostname: "acme.localhost", status: "active", organizationId: 4, orgStatus: "active" }];
    fixtures.membershipRows = []; // no active membership in org 4

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "acme.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not have access/i);
    expect(fixtures.insertedSessions).toHaveLength(0);
  });

  it("allows login with valid credentials when the resolved tenant hostname matches the account's own membership", async () => {
    fixtures.userRows = [user({ organizationId: 3 })];
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
    expect(fixtures.insertedSessions).toHaveLength(1);
    expect(fixtures.insertedSessions[0]).toMatchObject({ activeOrganizationId: 3 });
  });

  it("exempts super_admin from the hostname/membership check", async () => {
    fixtures.userRows = [user({ role: "super_admin", organizationId: 3 })];
    fixtures.domainRows = [{ hostname: "acme.localhost", status: "active", organizationId: 4, orgStatus: "active" }];
    fixtures.membershipRows = []; // no membership anywhere — irrelevant for super_admin

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "acme.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
  });

  it("still returns 401 for wrong credentials regardless of hostname", async () => {
    fixtures.userRows = [user()];
    const res = await request(app).post("/api/auth/login").send({ email: "admin@wwm.test", password: "wrong-password" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/switch-organization — hostname/organization consistency", () => {
  it("denies switching into an organization that mismatches the resolved tenant hostname", async () => {
    mockSession({ organizationId: 3 });
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ organizationId: 4 });

    expect(res.status).toBe(403);
    expect(fixtures.updatedSessions).toHaveLength(0);
  });

  it("allows switching when the target organization matches the resolved tenant hostname", async () => {
    mockSession({ organizationId: 3 });
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ organizationId: 3 });

    expect(res.status).toBe(200);
  });

  it("allows a super_admin to switch across a hostname that resolves to a different organization", async () => {
    mockSession({ role: "super_admin", organizationId: 3 });
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ organizationId: 4 });

    expect(res.status).toBe(200);
  });

  it("has no resolved-tenant restriction when the hostname is unmapped", async () => {
    mockSession({ organizationId: 3 });
    fixtures.domainRows = [];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "nobody.localhost")
      .send({ organizationId: 4 });

    expect(res.status).toBe(200);
  });
});

describe("Platform-admin domain management — super_admin only", () => {
  it("returns 403 for an authenticated non-super_admin", async () => {
    mockSession({ role: "org_admin" });
    const res = await request(app)
      .get("/api/organizations/3/domains")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/organizations/3/domains");
    expect(res.status).toBe(401);
  });

  it("returns 200 with the domain list for a super_admin", async () => {
    mockSession({ role: "super_admin" });
    fixtures.domainRows = [
      { id: 1, organizationId: 3, hostname: "wwm.localhost", domainType: "platform_subdomain", status: "active", isPrimary: true, verifiedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app)
      .get("/api/organizations/3/domains")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].hostname).toBe("wwm.localhost");
    // The internal verification token must never reach the client.
    expect(res.body[0].verificationToken).toBeUndefined();
  });

  it("a super_admin creating a domain records an audit event", async () => {
    mockSession({ role: "super_admin" });
    const res = await request(app)
      .post("/api/organizations/3/domains")
      .set("Authorization", "Bearer valid-token")
      .send({ hostname: "wwm.localhost", domainType: "platform_subdomain" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "organization_domain.created", organizationId: 3 });
  });
});
