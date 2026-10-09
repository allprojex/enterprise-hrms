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
  organizationSettingsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      userRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      domainRows: [] as Record<string, unknown>[],
      orgRows: [] as Record<string, unknown>[],
      settingsRows: [] as Record<string, unknown>[],
      insertedSessions: [] as Record<string, unknown>[],
      updatedSessions: [] as Record<string, unknown>[],
      auditInserts: [] as Record<string, unknown>[],
      // Simulates a genuine tenant-resolution infrastructure failure (a real
      // query throwing against a properly mocked, properly exported table)
      // — distinct from a test file simply not knowing about
      // organization_domains at all, which resolves to "no tenant" safely
      // rather than an error (see organizationDomains.ts's own
      // resolveTenantByHostname guard and resolveTenantHostFailOpen.test.ts).
      forceDomainQueryError: false,
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
    organizationSettingsTable: { __name: "organization_settings", organizationId: "organizationId", namespace: "namespace" },
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
  organizationSettingsTable,
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
                  : table === organizationSettingsTable
                    ? fixtures.settingsRows
                    : [];

        if (table === organizationDomainsTable && fixtures.forceDomainQueryError) {
          const failingBuilder = {
            innerJoin: () => failingBuilder,
            where: () => failingBuilder,
            limit: () => Promise.reject(new Error("simulated tenant-domain lookup failure")),
            then: (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.reject(new Error("simulated tenant-domain lookup failure")).catch((e) => reject?.(e)),
          };
          return failingBuilder;
        }

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
const { default: express } = await import("express");
const { resolveTenantHost } = await import("../middlewares/resolveTenantHost");
const { requireMembership } = await import("../middlewares/requireMembership");

/**
 * A minimal app exercising exactly resolveTenantHost -> requireMembership,
 * bypassing requireAuth/requirePermission entirely (req.userId is injected
 * directly) so the tenant-resolution fail-closed behavior can be tested in
 * isolation from unrelated permission-grant plumbing this file doesn't mock.
 */
function buildMinimalTenantApp() {
  const minimalApp = express();
  minimalApp.use((req, _res, next) => {
    // Mirrors what requireAuth always attaches: the id and the user row. An
    // ordinary (non-super_admin) account, so requireMembership's break-glass
    // branch is evaluated exactly as in production rather than dereferencing
    // an undefined user.
    (req as { userId?: number }).userId = 1;
    (req as { user?: { id: number; role: string } }).user = { id: 1, role: "employee" };
    next();
  });
  minimalApp.use(resolveTenantHost as any);
  minimalApp.get(
    "/organizations/:organizationId/probe",
    requireMembership("organizationId") as any,
    (_req, res) => res.json({ ok: true }),
  );
  // Echoes what resolveTenantHost bound to the request, so tests can assert
  // the internal identity/status split directly.
  minimalApp.get("/host-binding", (req, res) => {
    const r = req as { resolvedTenantOrganizationId?: number | null; resolvedTenantStatus?: string | null };
    res.json({ organizationId: r.resolvedTenantOrganizationId, status: r.resolvedTenantStatus });
  });
  return minimalApp;
}

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
  fixtures.forceDomainQueryError = false;
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
    fixtures.settingsRows = [];
    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resolved: true,
      organizationId: 3,
      organizationName: "wwm",
      organizationSlug: "wwm",
      organizationType: "church",
      logoUrl: null,
      systemDisplayName: null,
      theme: null,
    });
    expect(res.body.employees).toBeUndefined();
    expect(res.body.adminEmail).toBeUndefined();
  });

  it("includes the resolved organization's own branding.systemDisplayName, scoped to that organization only", async () => {
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    fixtures.orgRows = [{ id: 3, name: "Worldwide Word Ministries", slug: "wwm", type: "church", status: "active", logoUrl: null }];
    fixtures.settingsRows = [
      { organizationId: 3, namespace: "branding", settings: { systemDisplayName: "Human Resource Management System" } },
      // A different organization's branding row must never leak onto org 3's response.
      { organizationId: 4, namespace: "branding", settings: { systemDisplayName: "Someone Else's System Name" } },
    ];
    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body.systemDisplayName).toBe("Human Resource Management System");
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

// Suspending an organization must not turn its hostname into an unpinned,
// tenant-neutral host. Before this fix the resolver returned null for a
// suspended tenant, so every assertion below except the tenant-context ones
// would have observed the permissive "no tenant resolved" behaviour instead.
describe("Suspended tenant hostname stays pinned — identity, not availability", () => {
  const SUSPENDED_WWM_DOMAIN = { hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "suspended" };

  it("binds the suspended organization's id and status to the request (never the tenant-neutral null)", async () => {
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];

    const res = await request(buildMinimalTenantApp()).get("/host-binding").set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organizationId: 3, status: "suspended" });
  });

  it("binds active and trial organizations with their status, and nothing for an unmapped host", async () => {
    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "active" }];
    const active = await request(buildMinimalTenantApp()).get("/host-binding").set("X-Tenant-Hostname", "wwm.localhost");
    expect(active.body).toEqual({ organizationId: 3, status: "active" });

    fixtures.domainRows = [{ hostname: "wwm.localhost", status: "active", organizationId: 3, orgStatus: "trial" }];
    const trial = await request(buildMinimalTenantApp()).get("/host-binding").set("X-Tenant-Hostname", "wwm.localhost");
    expect(trial.body).toEqual({ organizationId: 3, status: "trial" });

    fixtures.domainRows = [];
    const unmapped = await request(buildMinimalTenantApp()).get("/host-binding").set("X-Tenant-Hostname", "nobody.localhost");
    expect(unmapped.body).toEqual({ organizationId: null, status: null });
  });

  it("denies an authenticated member of another organization reaching their own organization through the suspended tenant's hostname", async () => {
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    // Caller is a genuine, active member of org 4 only.
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(buildMinimalTenantApp())
      .get("/organizations/4/probe")
      .set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(403);
  });

  it("denies a member of another organization reaching the suspended organization's resources (no membership there)", async () => {
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(buildMinimalTenantApp())
      .get("/organizations/3/probe")
      .set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(403);
  });

  it("GET /tenant-context still reports resolved:false with no branding for the suspended tenant", async () => {
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    fixtures.orgRows = [{ id: 3, name: "Worldwide Word Ministries", slug: "wwm", type: "church", status: "suspended", logoUrl: "https://x/logo.png" }];
    fixtures.settingsRows = [{ organizationId: 3, namespace: "branding", settings: { systemDisplayName: "Suspended HR" } }];

    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resolved: false });
  });

  it("denies login to a non-member, non-super_admin account through the suspended tenant's hostname", async () => {
    fixtures.userRows = [user({ organizationId: 4 })];
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }]; // none in org 3

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/does not have access/i);
    expect(fixtures.insertedSessions).toHaveLength(0);
  });

  it("keeps the existing super_admin login exemption on the suspended tenant's hostname", async () => {
    fixtures.userRows = [user({ role: "super_admin", organizationId: 1 })];
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    fixtures.membershipRows = [];

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
  });

  it("denies switching into another organization while browsing the suspended tenant's hostname", async () => {
    mockSession({ organizationId: 3 });
    fixtures.domainRows = [SUSPENDED_WWM_DOMAIN];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 4, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ organizationId: 4 });

    expect(res.status).toBe(403);
    expect(fixtures.updatedSessions).toHaveLength(0);
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

describe("Tenant resolution infrastructure failure — fails closed, never silently open", () => {
  it("requireMembership denies (503) when the tenant hostname lookup itself throws, even for a caller with a real membership", async () => {
    fixtures.forceDomainQueryError = true;
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(buildMinimalTenantApp())
      .get("/organizations/3/probe")
      .set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(503);
  });

  it("requireMembership still succeeds normally once resolution is healthy again (regression guard, not a permanent lockout)", async () => {
    fixtures.forceDomainQueryError = false;
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(buildMinimalTenantApp())
      .get("/organizations/3/probe")
      .set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(200);
  });

  it("an ordinary user cannot benefit from a resolution failure to reach an organization they have no membership in", async () => {
    fixtures.forceDomainQueryError = true;
    // The caller has no membership row anywhere — if the failure were
    // silently treated as "no tenant restriction," this would still 403 on
    // membership; the point of this test is that the response is the
    // fail-closed 503, not an information leak about which layer denied it,
    // and specifically not a 200.
    fixtures.membershipRows = [];

    const res = await request(buildMinimalTenantApp())
      .get("/organizations/3/probe")
      .set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(200);
  });

  it("POST /auth/login denies (503) an ordinary user when tenant resolution throws, even with fully correct credentials", async () => {
    fixtures.forceDomainQueryError = true;
    fixtures.userRows = [user({ organizationId: 3 })];
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(503);
    expect(fixtures.insertedSessions).toHaveLength(0);
  });

  it("POST /auth/login still exempts super_admin during a resolution failure (legitimate platform administration preserved)", async () => {
    fixtures.forceDomainQueryError = true;
    fixtures.userRows = [user({ role: "super_admin", organizationId: 3 })];

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ email: "admin@wwm.test", password: REAL_PASSWORD });

    expect(res.status).toBe(200);
  });

  it("POST /auth/switch-organization denies (503) an ordinary user when tenant resolution throws", async () => {
    fixtures.forceDomainQueryError = true;
    mockSession({ organizationId: 3 });
    fixtures.membershipRows = [{ applicationUserId: 1, organizationId: 3, status: "active" }];

    const res = await request(app)
      .post("/api/auth/switch-organization")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ organizationId: 3 });

    expect(res.status).toBe(503);
    expect(fixtures.updatedSessions).toHaveLength(0);
  });

  it("GET /tenant-context is explicitly tenant-neutral: reports resolved:false, does not fail closed, on the same resolution failure", async () => {
    fixtures.forceDomainQueryError = true;

    const res = await request(app).get("/api/tenant-context").set("X-Tenant-Hostname", "wwm.localhost");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resolved: false });
  });

  it("platform-admin domain routes are not coupled to resolveTenantHost's fail-closed contract (they were never conditioned on tenantResolutionFailed)", async () => {
    // The request's own hostname lookup (resolveTenantHost, global) fails
    // here too, but GET /organizations/:id/domains never reads
    // req.tenantResolutionFailed at all — it is gated purely by
    // requireSuperAdmin, independent of hostname resolution entirely, per
    // "platform-admin routes remain intentionally platform-scoped." It
    // therefore never returns resolveTenantHost's specific 503 contract —
    // whatever it returns here is a consequence of its own list query
    // (which happens to touch the same table), not of tenant-consistency
    // enforcement.
    fixtures.forceDomainQueryError = true;
    mockSession({ role: "super_admin" });

    const res = await request(app)
      .get("/api/organizations/3/domains")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).not.toBe(503);
  });
});
