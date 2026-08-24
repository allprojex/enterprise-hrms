/**
 * Unit tests for lib/organizationDomains.ts — hostname normalization,
 * hostname/organization mismatch detection, and the domain service
 * functions against a mocked @workspace/db (no real database connection).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, organizationDomainsTable, organizationsTable, organizationSettingsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      domainRows: [] as unknown[],
      domainOrgJoinRows: [] as unknown[],
      orgRows: [] as unknown[],
      settingsRows: [] as unknown[],
      inserted: [] as { table: string; values: unknown }[],
      updated: [] as { table: string; values: unknown }[],
      insertShouldConflict: false,
    },
    organizationDomainsTable: { __name: "organization_domains" },
    organizationsTable: { __name: "organizations" },
    organizationSettingsTable: { __name: "organization_settings" },
  };
});

function makeTx() {
  return {
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          fixtures.updated.push({ table: table.__name, values: v });
          return {
            returning: () => Promise.resolve([{ id: 1, organizationId: 1, ...v }]),
            then: (resolve: (x: unknown) => void) => resolve(undefined),
          };
        },
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  organizationDomainsTable,
  organizationsTable,
  organizationSettingsTable,
  db: {
    select: (_cols?: unknown) => ({
      from(table: { __name: string }) {
        const rowsByTable = (t: { __name: string }) => {
          if (t === organizationDomainsTable) return fixtures.domainRows;
          if (t === organizationSettingsTable) return fixtures.settingsRows;
          return fixtures.orgRows;
        };
        const rows = table === organizationDomainsTable ? fixtures.domainOrgJoinRows : rowsByTable(table);
        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rowsByTable(table)),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          if (fixtures.insertShouldConflict) {
            return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
          }
          fixtures.inserted.push({ table: table.__name, values: v });
          return Promise.resolve([{ id: 1, organizationId: v.organizationId, ...v }]);
        },
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            fixtures.updated.push({ table: table.__name, values: v });
            return Promise.resolve([{ id: 1, organizationId: 1, hostname: "wwm.localhost", ...v }]);
          },
        }),
      }),
    }),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  ne: () => "ne",
}));

const {
  normalizeHostname,
  hostnameOrganizationMismatch,
  createDomain,
  resolveTenantByHostname,
  activateDomain,
  disableDomain,
  setPrimaryDomain,
  getPublicTenantContext,
  InvalidHostnameError,
  DomainNotFoundError,
  DomainNotActiveError,
} = await import("../lib/organizationDomains");

describe("normalizeHostname", () => {
  it("lowercases and trims", () => {
    expect(normalizeHostname("  WWM.Localhost  ")).toBe("wwm.localhost");
  });

  it("strips a leading scheme", () => {
    expect(normalizeHostname("https://wwm.localhost")).toBe("wwm.localhost");
    expect(normalizeHostname("http://wwm.localhost")).toBe("wwm.localhost");
  });

  it("strips a trailing path and query", () => {
    expect(normalizeHostname("wwm.localhost/login?x=1")).toBe("wwm.localhost");
  });

  it("strips a port", () => {
    expect(normalizeHostname("wwm.localhost:5173")).toBe("wwm.localhost");
  });

  it("accepts a bare single-label host", () => {
    expect(normalizeHostname("localhost")).toBe("localhost");
  });

  it("accepts a real custom domain", () => {
    expect(normalizeHostname("hr.worldwidewordministries.org")).toBe("hr.worldwidewordministries.org");
  });

  it("throws InvalidHostnameError for an empty string", () => {
    expect(() => normalizeHostname("   ")).toThrow(InvalidHostnameError);
  });

  it("throws InvalidHostnameError for garbage input", () => {
    expect(() => normalizeHostname("not a hostname!!")).toThrow(InvalidHostnameError);
    expect(() => normalizeHostname("/")).toThrow(InvalidHostnameError);
  });
});

describe("hostnameOrganizationMismatch", () => {
  it("is false when no tenant was resolved", () => {
    expect(hostnameOrganizationMismatch(null, 5)).toBe(false);
    expect(hostnameOrganizationMismatch(undefined, 5)).toBe(false);
  });

  it("is false when the resolved tenant matches", () => {
    expect(hostnameOrganizationMismatch(5, 5)).toBe(false);
  });

  it("is true when the resolved tenant differs — this is the entire cross-tenant guard", () => {
    expect(hostnameOrganizationMismatch(5, 6)).toBe(true);
  });
});

describe("organizationDomains service", () => {
  beforeEach(() => {
    fixtures.domainRows = [];
    fixtures.domainOrgJoinRows = [];
    fixtures.orgRows = [];
    fixtures.inserted = [];
    fixtures.updated = [];
    fixtures.insertShouldConflict = false;
  });

  it("createDomain makes a platform_subdomain immediately active with no verification token", async () => {
    const domain = await createDomain({ organizationId: 3, hostname: "WWM.Localhost", domainType: "platform_subdomain" });
    expect(domain.status).toBe("active");
    expect(fixtures.inserted[0].values).toMatchObject({
      hostname: "wwm.localhost",
      status: "active",
      verificationToken: null,
    });
  });

  it("createDomain makes a custom_domain pending with a generated verification token", async () => {
    await createDomain({ organizationId: 3, hostname: "hr.example.org", domainType: "custom_domain" });
    const values = fixtures.inserted[0].values as Record<string, unknown>;
    expect(values.status).toBe("pending");
    expect(typeof values.verificationToken).toBe("string");
    expect((values.verificationToken as string).length).toBeGreaterThan(0);
  });

  it("createDomain surfaces a duplicate hostname as InvalidHostnameError, not a raw DB error", async () => {
    fixtures.insertShouldConflict = true;
    await expect(
      createDomain({ organizationId: 3, hostname: "wwm.localhost", domainType: "platform_subdomain" }),
    ).rejects.toThrow(InvalidHostnameError);
  });

  it("resolveTenantByHostname returns null for an unmapped hostname", async () => {
    fixtures.domainRows = [];
    const result = await resolveTenantByHostname("nobody.localhost");
    expect(result).toBeNull();
  });

  it("resolveTenantByHostname returns null (fails safely) for a garbage hostname instead of throwing", async () => {
    await expect(resolveTenantByHostname("not a hostname!!")).resolves.toBeNull();
  });

  it("resolveTenantByHostname returns null when the organization is suspended", async () => {
    fixtures.domainRows = [{ organizationId: 3, orgStatus: "suspended" }];
    const result = await resolveTenantByHostname("wwm.localhost");
    expect(result).toBeNull();
  });

  it("resolveTenantByHostname resolves when active domain + non-suspended org", async () => {
    fixtures.domainRows = [{ organizationId: 3, orgStatus: "active" }];
    const result = await resolveTenantByHostname("wwm.localhost");
    expect(result).toEqual({ organizationId: 3 });
  });

  it("activateDomain 404s (DomainNotFoundError) when the domain doesn't belong to the organization", async () => {
    fixtures.domainRows = [];
    await expect(activateDomain(3, 999)).rejects.toThrow(DomainNotFoundError);
  });

  it("disableDomain clears the primary flag", async () => {
    fixtures.domainRows = [{ id: 1, organizationId: 3, status: "active", isPrimary: true }];
    const updated = await disableDomain(3, 1);
    expect(updated.status).toBe("disabled");
    expect(fixtures.updated[0].values).toMatchObject({ status: "disabled", isPrimary: false });
  });

  it("setPrimaryDomain refuses a non-active domain", async () => {
    fixtures.domainRows = [{ id: 1, organizationId: 3, status: "pending", isPrimary: false }];
    await expect(setPrimaryDomain(3, 1)).rejects.toThrow(DomainNotActiveError);
  });

  it("setPrimaryDomain succeeds for an active domain and clears any prior primary first", async () => {
    fixtures.domainRows = [{ id: 1, organizationId: 3, status: "active", isPrimary: false }];
    const updated = await setPrimaryDomain(3, 1);
    expect(updated.isPrimary).toBe(true);
    // Two transaction updates: clear-others, then set-this-one.
    expect(fixtures.updated).toHaveLength(2);
    expect(fixtures.updated[0].values).toMatchObject({ isPrimary: false });
    expect(fixtures.updated[1].values).toMatchObject({ isPrimary: true });
  });

  it("getPublicTenantContext returns null for a suspended organization", async () => {
    fixtures.orgRows = [{ id: 3, name: "wwm", slug: "wwm", type: "church", status: "suspended", logoUrl: null }];
    await expect(getPublicTenantContext(3)).resolves.toBeNull();
  });

  it("getPublicTenantContext returns the safe DTO only — no employee/membership fields", async () => {
    fixtures.orgRows = [
      { id: 3, name: "wwm", slug: "wwm", type: "church", status: "trial", logoUrl: "https://x/y.png", industry: "secret" },
    ];
    fixtures.settingsRows = [];
    const context = await getPublicTenantContext(3);
    expect(context).toEqual({
      organizationId: 3,
      organizationName: "wwm",
      organizationSlug: "wwm",
      organizationType: "church",
      logoUrl: "https://x/y.png",
      systemDisplayName: null,
      theme: null,
    });
  });

  it("getPublicTenantContext includes the organization's own branding.systemDisplayName when configured", async () => {
    fixtures.orgRows = [{ id: 3, name: "Worldwide Word Ministries", slug: "wwm", type: "church", status: "active", logoUrl: null }];
    fixtures.settingsRows = [
      { organizationId: 3, namespace: "branding", schemaVersion: 1, settings: { systemDisplayName: "Human Resource Management System" }, updatedAt: new Date() },
    ];
    const context = await getPublicTenantContext(3);
    expect(context?.systemDisplayName).toBe("Human Resource Management System");
  });

  it("getPublicTenantContext never leaks one organization's branding onto another's response shape (isolation smoke check)", async () => {
    fixtures.orgRows = [{ id: 4, name: "Acme", slug: "acme", type: "business", status: "active", logoUrl: null }];
    fixtures.settingsRows = [];
    const context = await getPublicTenantContext(4);
    expect(context?.organizationId).toBe(4);
    expect(context?.systemDisplayName).toBeNull();
  });
});
