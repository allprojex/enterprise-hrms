/**
 * Tenant identity hardening — Phase 7 (Super Admin safety) and Phase 9 test 8
 * ("a tenant-specific Super Admin operation records the correct tenant").
 *
 * Routes under test: GET /platform/organizations/:id/identity and
 * PUT /platform/organizations/:id/feature-flags/:key, through the real
 * requireAuth + requireSuperAdmin chain via supertest. @workspace/db and the
 * read-side libs are mocked; the flag service is the REAL service bound to an
 * in-memory config store so the audit event reflects a real state change.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, organizationsTable, sessionsTable, usersTable, auditEventsTable, flagStore } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      orgRows: [] as Record<string, unknown>[],
      auditEvents: [] as Record<string, unknown>[],
    },
    flagStore: new Map<string, Record<string, unknown>>(),
    organizationsTable: mockTable("organizations", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    usersTable: mockTable("users", ["id", "email"]),
    auditEventsTable: mockTable("audit_events", ["organizationId"]),
  };
});

vi.mock("@workspace/db", () => ({
  organizationsTable,
  sessionsTable,
  usersTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(fixtures.sessionRows),
          };
          return builder;
        }
        let filtered = table === organizationsTable ? fixtures.orgRows : [];
        const builder = {
          innerJoin: () => builder,
          where(cond: { field?: string; val?: unknown } | undefined) {
            if (cond?.field) filtered = filtered.filter((r) => r[cond.field!] === cond.val);
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
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
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  gt: () => undefined,
  isNull: () => undefined,
  inArray: () => undefined,
}));

// Read-side libs the identity card composes — each is its own tested module.
vi.mock("../lib/installations", () => ({
  listInstallationsForOrganization: async (organizationId: number) =>
    organizationId === 10
      ? [
          {
            id: 1,
            installationKey: "prod-shared-1",
            name: "Shared production",
            environmentType: "production",
            hostingModel: "shared",
            hostingProvider: "vps",
            primaryDomain: "hrms.example.test",
            applicationVersion: "1.4.0",
            gitCommit: "abc1234",
            migrationVersion: "0075",
            deployedAt: null,
            status: "active",
            linkedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ]
      : [],
}));
vi.mock("../lib/organizationDomains", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveTenantByHostname: async () => null,
    listDomainsForOrganization: async (organizationId: number) =>
      organizationId === 10
        ? [{ id: 5, hostname: "org10.example.test", domainType: "platform_subdomain", status: "active", isPrimary: true }]
        : [],
  };
});
vi.mock("../lib/organizationModules", () => ({
  listOrganizationModules: async () => [
    { key: "core_hr", name: "Core HR", status: "active", enabled: true },
    { key: "payroll", name: "Payroll", status: "active", enabled: false },
  ],
}));

// A REAL flag service with a test registry over an in-memory per-org store —
// the production wiring differs only in where the row lives.
vi.mock("../lib/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/featureFlags")>();
  const registry = [
    { key: "reports.early_access", level: "feature" as const, description: "Early access to the new reports" },
  ];
  const service = actual.createFeatureFlagService({
    registry,
    getConfig: async (organizationId, namespace) => ({
      organizationId,
      namespace,
      schemaVersion: 1,
      data: flagStore.get(`${organizationId}`) ?? { flags: {} },
      updatedAt: null,
    }),
    updateConfig: async (organizationId, namespace, patch) => {
      const existing = (flagStore.get(`${organizationId}`) ?? { flags: {} }) as { flags: Record<string, boolean> };
      const merged = { flags: { ...existing.flags, ...((patch.flags as Record<string, boolean>) ?? {}) } };
      flagStore.set(`${organizationId}`, merged);
      return { organizationId, namespace, schemaVersion: 1, data: merged, updatedAt: null };
    },
  });
  return { ...actual, featureFlags: service, isFeatureEnabled: (o: number, k: string) => service.isEnabled(o, k) };
});

const { default: app } = await import("../app");

function mockSession(user: { id: number; role: string }) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: user.id, expiresAt: new Date(Date.now() + 100000) },
      user: { id: user.id, email: "user@example.com", role: user.role, organizationId: null, disabledAt: null },
    },
  ];
}

function mockOrganization(id: number) {
  fixtures.orgRows.push({
    id,
    tenantUuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    name: `Org ${id}`,
    slug: `org-${id}`,
    type: "business",
    status: "active",
    logoUrl: null,
    industry: null,
    employeeCount: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.orgRows = [];
  fixtures.auditEvents = [];
  flagStore.clear();
  mockOrganization(10);
  mockOrganization(20);
});

describe("GET /api/platform/organizations/:id/identity", () => {
  it("requires the platform super_admin role — a tenant admin cannot read another tenant's identity card", async () => {
    mockSession({ id: 1, role: "org_admin" });
    const res = await request(app).get("/api/platform/organizations/10/identity").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns the full operational identity of exactly the requested tenant", async () => {
    mockSession({ id: 1, role: "super_admin" });
    const res = await request(app).get("/api/platform/organizations/10/identity").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({
      id: 10,
      tenantUuid: "00000000-0000-4000-8000-000000000010",
      slug: "org-10",
      name: "Org 10",
      status: "active",
    });
    expect(res.body.runtime).toMatchObject({ environment: expect.any(String), appVersion: expect.any(String) });
    expect(res.body.installations).toEqual([
      expect.objectContaining({ installationKey: "prod-shared-1", environmentType: "production", applicationVersion: "1.4.0" }),
    ]);
    expect(res.body.domains).toEqual([expect.objectContaining({ hostname: "org10.example.test", isPrimary: true })]);
    expect(res.body.modules).toEqual([
      { key: "core_hr", name: "Core HR", status: "active", enabled: true },
      { key: "payroll", name: "Payroll", status: "active", enabled: false },
    ]);
    expect(res.body.featureFlags).toEqual([expect.objectContaining({ key: "reports.early_access", enabled: false })]);
    // Nothing HR-shaped leaves this endpoint.
    expect(JSON.stringify(res.body)).not.toMatch(/employee|salary|payslip|email/i);
  });

  it("is 404 for a tenant that does not exist and 400 for a malformed id", async () => {
    mockSession({ id: 1, role: "super_admin" });
    expect((await request(app).get("/api/platform/organizations/999/identity").set("Authorization", "Bearer valid-token")).status).toBe(404);
    expect((await request(app).get("/api/platform/organizations/abc/identity").set("Authorization", "Bearer valid-token")).status).toBe(400);
  });
});

describe("PUT /api/platform/organizations/:id/feature-flags/:key", () => {
  it("records WHO enabled WHAT for WHICH tenant, WHY, with blast radius and result", async () => {
    mockSession({ id: 42, role: "super_admin" });
    const res = await request(app)
      .put("/api/platform/organizations/10/feature-flags/reports.early_access")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true, reason: "Pilot agreed with customer, ticket #77" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: "reports.early_access", enabled: true });

    expect(fixtures.auditEvents).toHaveLength(1);
    expect(fixtures.auditEvents[0]).toMatchObject({
      actorApplicationUserId: 42,
      organizationId: 10,
      eventType: "feature_flag.enabled",
      targetType: "feature_flag",
      targetId: "reports.early_access",
      beforeState: { enabled: false },
      afterState: { enabled: true, level: "feature" },
      outcome: "success",
      metadata: {
        reason: "Pilot agreed with customer, ticket #77",
        tenantSlug: "org-10",
        tenantUuid: "00000000-0000-4000-8000-000000000010",
        blastRadius: "tenant_scoped",
        operation: "organization.feature_flag.set",
        targetOrganizationId: 10,
      },
    });
  });

  it("enabling for tenant 10 leaves tenant 20 off (test 2 at the HTTP boundary)", async () => {
    mockSession({ id: 42, role: "super_admin" });
    await request(app)
      .put("/api/platform/organizations/10/feature-flags/reports.early_access")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true, reason: "pilot" });

    const other = await request(app).get("/api/platform/organizations/20/feature-flags").set("Authorization", "Bearer valid-token");
    expect(other.status).toBe(200);
    expect(other.body).toEqual([expect.objectContaining({ key: "reports.early_access", enabled: false })]);
  });

  it("refuses without a reason, refuses unknown flags, and writes no audit event in either case", async () => {
    mockSession({ id: 42, role: "super_admin" });
    const noReason = await request(app)
      .put("/api/platform/organizations/10/feature-flags/reports.early_access")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });
    expect(noReason.status).toBe(400);

    const unknown = await request(app)
      .put("/api/platform/organizations/10/feature-flags/not.registered")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true, reason: "x" });
    expect(unknown.status).toBe(404);

    expect(fixtures.auditEvents).toHaveLength(0);
    expect(flagStore.size).toBe(0);
  });

  it("is not reachable by a tenant admin", async () => {
    mockSession({ id: 1, role: "org_admin" });
    const res = await request(app)
      .put("/api/platform/organizations/10/feature-flags/reports.early_access")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true, reason: "x" });
    expect(res.status).toBe(403);
    expect(flagStore.size).toBe(0);
  });
});
