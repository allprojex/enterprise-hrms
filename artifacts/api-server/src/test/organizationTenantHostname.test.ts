/**
 * Regression coverage for the tenant-hostname consistency gap found in
 * GET/PATCH /organizations/:id, /suspend, /reactivate (routes/organizations.ts):
 * unlike every route composing requireMembership, these four route via
 * authorizeOrganizationAction and had never inherited requireMembership's
 * own hostname-consistency guard (773bdb5). Fixed by reusing
 * hostnameOrganizationMismatch/shouldFailClosedForTenantResolution
 * directly (organizations.ts's tenantHostnameAllowsOrganization) rather
 * than duplicating the rule. Mock convention combines organizations.test.ts's
 * permission-condition mock with tenantHostSecurity.test.ts's hostname
 * fixture.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = col;
  return table;
}

const {
  fixtures,
  organizationsTable,
  sessionsTable,
  usersTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationDomainsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = col;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      orgRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      domainRows: [] as Record<string, unknown>[],
      auditEvents: [] as Record<string, unknown>[],
    },
    organizationsTable: mockTable("organizations", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    usersTable: mockTable("users", ["id", "email"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    organizationDomainsTable: mockTable("organization_domains", ["hostname", "status", "organizationId"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (field: string, val: unknown) => ({ __op: "eq", field, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (field: string, vals: unknown[]) => ({ __op: "eq", field, val: vals[0] }),
}));

vi.mock("@workspace/db", () => ({
  organizationsTable,
  sessionsTable,
  usersTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationDomainsTable,
  auditEventsTable: mockTable("audit_events", ["organizationId"]),
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationsTable) rows = fixtures.orgRows;
        else if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;
        else if (table === organizationDomainsTable) rows = fixtures.domainRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit(n: number) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          orderBy: () => Promise.resolve(filtered),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            const updated = { ...fixtures.orgRows[0], ...patch };
            fixtures.orgRows = [updated];
            return Promise.resolve([updated]);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.auditEvents.push({ table, v });
        return Promise.resolve();
      },
    }),
  },
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

function mockOrganization(id: number, status: "active" | "suspended" = "active") {
  const existing = fixtures.orgRows.filter((o) => o.id !== id);
  fixtures.orgRows = [
    ...existing,
    { id, name: `Org ${id}`, slug: `org-${id}`, type: "business", status, logoUrl: null, industry: null, employeeCount: null, createdAt: new Date() },
  ];
}

function mockMembership(applicationUserId: number, organizationId: number, permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId, organizationId, status: "active" }];
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

function mockDomain(hostname: string, organizationId: number) {
  fixtures.domainRows = [{ hostname, status: "active", organizationId }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.orgRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.domainRows = [];
  fixtures.auditEvents = [];
});

describe("Organization-route tenant-hostname consistency", () => {
  // 1. GET matching hostname + authorized org -> allowed
  it("1. GET allowed when hostname matches the target organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.read"]);
    mockDomain("wwm.localhost", 3);

    const res = await request(app).get("/api/organizations/3").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
  });

  // 2. GET mismatched hostname -> denied
  it("2. GET denied when hostname resolves to a different organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.read"]);
    mockDomain("acme.localhost", 4); // hostname resolves to org 4, target is org 3

    const res = await request(app).get("/api/organizations/3").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "acme.localhost");
    expect(res.status).toBe(403);
  });

  // 3. PATCH matching hostname + permission -> allowed
  it("3. PATCH allowed when hostname matches and permission is held", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("wwm.localhost", 3);

    const res = await request(app)
      .patch("/api/organizations/3")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ name: "New Name" });
    expect(res.status).toBe(200);
  });

  // 4. PATCH mismatched hostname -> denied
  it("4. PATCH denied when hostname resolves to a different organization, even with real permission", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("acme.localhost", 4);

    const res = await request(app)
      .patch("/api/organizations/3")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "acme.localhost")
      .send({ name: "New Name" });
    expect(res.status).toBe(403);
  });

  // 5. suspend matching tenant context + required authority -> allowed
  it("5. suspend allowed when hostname matches and authority is held", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("wwm.localhost", 3);

    const res = await request(app).post("/api/organizations/3/suspend").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");
  });

  // 6. suspend mismatched tenant context -> denied
  it("6. suspend denied when tenant context mismatches", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("acme.localhost", 4);

    const res = await request(app).post("/api/organizations/3/suspend").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "acme.localhost");
    expect(res.status).toBe(403);
  });

  // 7. reactivate matching tenant context + required authority -> allowed
  it("7. reactivate allowed when hostname matches and authority is held", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3, "suspended");
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("wwm.localhost", 3);

    const res = await request(app).post("/api/organizations/3/reactivate").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  // 8. reactivate mismatched tenant context -> denied
  it("8. reactivate denied when tenant context mismatches", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3, "suspended");
    mockMembership(1, 3, ["organization.update"]);
    mockDomain("acme.localhost", 4);

    const res = await request(app).post("/api/organizations/3/reactivate").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "acme.localhost");
    expect(res.status).toBe(403);
  });

  // 9. unrelated organization member remains denied by membership/permission checks
  it("9. denied by ordinary membership/permission rules regardless of hostname (no hostname header at all)", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 3 });
    mockOrganization(4); // target org 4; caller has no membership there
    // no membership fixture for org 4

    const res = await request(app).get("/api/organizations/4").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  // 10. hostname consistency never grants membership
  it("10. a matching hostname never substitutes for a real membership/permission grant", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 3 });
    mockOrganization(3);
    // deliberately no membership fixture at all, despite the hostname matching org 3
    mockDomain("wwm.localhost", 3);

    const res = await request(app).get("/api/organizations/3").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(403);
  });

  // 11. tenant-resolution failure remains fail-closed where applicable
  it("11. fails closed (503) when tenant resolution itself errors, even for an otherwise-authorized caller", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 3 });
    mockOrganization(3);
    mockMembership(1, 3, ["organization.update"]);
    // domainRows intentionally left in a shape that makes the resolver throw:
    // organizationDomainsTable is exported (unlike the fail-open artifact
    // test), so this exercises a genuine query-path error, not the
    // unexported-binding case.
    fixtures.domainRows = undefined as unknown as Record<string, unknown>[];

    const res = await request(app)
      .patch("/api/organizations/3")
      .set("Authorization", "Bearer valid-token")
      .set("X-Tenant-Hostname", "wwm.localhost")
      .send({ name: "New Name" });
    expect(res.status).toBe(503);
  });

  // 12. hostname-neutral legitimate platform administration still behaves per established architecture
  it("12. super_admin retains platform administration from a hostname-neutral context (no tenant resolved)", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 3 });
    mockOrganization(99); // super_admin has no membership in org 99 at all
    // no X-Tenant-Hostname header, no domain fixture -> resolvedTenantOrganizationId stays null

    const res = await request(app).get("/api/organizations/99").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });

  it("12b. super_admin is still denied acting on a different org while browsing a hostname bound to another tenant (no new broad bypass)", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 3 });
    mockOrganization(4);
    mockDomain("wwm.localhost", 3); // super_admin is on WWM's hostname, acting on org 4

    const res = await request(app).get("/api/organizations/4").set("Authorization", "Bearer valid-token").set("X-Tenant-Hostname", "wwm.localhost");
    expect(res.status).toBe(403);
  });

  // 13 & 14 (existing /branches behavior, WWM/Acme isolation) are already
  // covered by tenantHostSecurity.test.ts and organizations.test.ts, both
  // re-run unchanged as part of this same verification pass — not
  // duplicated here.
});
