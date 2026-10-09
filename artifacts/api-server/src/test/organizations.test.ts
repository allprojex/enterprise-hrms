/**
 * Integration test for the single-organization-scoped routes
 * (GET/PATCH/:id, suspend, reactivate), exercising the real requireAuth
 * middleware and route handlers through supertest. @workspace/db is mocked
 * so the suite never opens a real database connection.
 *
 * Authorization on these routes is Organization Permission Gates (W9):
 * super_admin bypasses; everyone else needs an active membership in the
 * target organization AND the relevant permission (organization.read /
 * organization.update) via that membership's roles -- same
 * membership+permission infrastructure every other org-scoped route uses,
 * replacing the prior role-string checks (canAccessOrganization /
 * canManageOrganization).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const {
  fixtures,
  organizationsTable,
  sessionsTable,
  usersTable,
  notificationsTable,
  auditEventsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      orgRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      auditEvents: [] as Record<string, unknown>[],
      slugConflict: false,
    },
    organizationsTable: mockTable("organizations", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    usersTable: mockTable("users", ["id", "email"]),
    notificationsTable: mockTable("notifications", ["id"]),
    auditEventsTable: mockTable("audit_events", ["organizationId"]),
    organizationMembershipsTable: mockTable("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
    ]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
  };
});

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
  organizationsTable,
  sessionsTable,
  usersTable,
  notificationsTable,
  auditEventsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
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
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: col.split(".").pop(), vals }),
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
      tenantUuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
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

/** Gives applicationUserId an active membership in organizationId, carrying permissionKeys. */
function mockMembership(
  applicationUserId: number,
  organizationId: number,
  permissionKeys: string[],
  membershipId = 5,
  roleId = 1,
) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId, organizationId, status: "active" }];
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

describe("GET /api/organizations/:id", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
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

  it("returns 200 when a member with organization.read requests their own organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.read"]);

    const res = await request(app)
      .get("/api/organizations/10")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  it("returns 403 when the caller has no membership in the target organization", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(99);
    // no membership fixture -> getActiveMembership resolves null

    const res = await request(app)
      .get("/api/organizations/99")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller's membership lacks organization.read", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, []);

    const res = await request(app)
      .get("/api/organizations/10")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 200 when a super_admin requests an organization they have no membership in", async () => {
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
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.auditEvents = [];
    fixtures.slugConflict = false;
  });

  it("returns 403 when the member's role lacks organization.update", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.read"]);

    const res = await request(app)
      .patch("/api/organizations/10")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when an org_admin-equivalent membership targets a different organization", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(99);
    mockMembership(1, 10, ["organization.update"]); // membership is in org 10, not 99

    const res = await request(app)
      .patch("/api/organizations/99")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
  });

  it("updates the organization and records an audit event for a member with organization.update", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.update"]);

    const res = await request(app)
      .patch("/api/organizations/10")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Renamed Org" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Org");
    expect(fixtures.auditEvents).toHaveLength(1);
    expect(fixtures.auditEvents[0].eventType).toBe("organization.updated");
  });

  // Tenant identity contract: the slug is the tenant CODE and is immutable
  // after creation — even the platform super_admin cannot rename it through
  // this route, and the attempt is refused explicitly rather than silently
  // dropped.
  it("returns 400 and changes nothing when a slug change is attempted (tenant code is immutable)", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .patch("/api/organizations/99")
      .set("Authorization", "Bearer valid-token")
      .send({ slug: "renamed-slug" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/immutable/);
    expect(fixtures.auditEvents).toHaveLength(0);
  });

  // Phase 9 test 7: a display-name change is just that — it never touches the
  // tenant's identity (id, tenantUuid, slug) and the audit event names the
  // same tenant before and after.
  it("a display-name change leaves the tenant identity untouched", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.update"]);

    const res = await request(app)
      .patch("/api/organizations/10")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Completely Different Name" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
    expect(res.body.slug).toBe("org-10");
    expect(res.body.tenantUuid).toBe(fixtures.orgRows[0].tenantUuid);
    expect(fixtures.auditEvents[0].organizationId).toBe(10);
    const before = fixtures.auditEvents[0].beforeState as { tenantUuid: string };
    const after = fixtures.auditEvents[0].afterState as { tenantUuid: string };
    expect(before.tenantUuid).toBe(after.tenantUuid);
    expect(fixtures.auditEvents[0].metadata).toMatchObject({
      blastRadius: "tenant_scoped",
      targetOrganizationId: 10,
      operation: "organization.update",
    });
  });
});

describe("POST /api/organizations/:id/suspend and /reactivate", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.auditEvents = [];
    fixtures.slugConflict = false;
  });

  it("returns 403 when the member's role lacks organization.update", async () => {
    mockSession({ id: 1, role: "employee", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.read"]);

    const res = await request(app)
      .post("/api/organizations/10/suspend")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  // Platform ownership boundary: suspend/reactivate is platform tenant
  // lifecycle, reserved to the genuine platform super_admin. A tenant
  // Organization Admin holding organization.update can no longer suspend even
  // its own organisation.
  it("returns 403 when a tenant org_admin (organization.update) attempts to suspend its own organisation", async () => {
    mockSession({ id: 1, role: "org_admin", organizationId: 10 });
    mockOrganization(10);
    mockMembership(1, 10, ["organization.update"]);

    const res = await request(app)
      .post("/api/organizations/10/suspend")
      .set("Authorization", "Bearer valid-token")
      .send({ confirmSlug: "org-10", reason: "Ticket #123 — non-payment" });

    expect(res.status).toBe(403);
    expect(fixtures.auditEvents).toHaveLength(0);
  });

  it("suspends the organization and records an audit event for the platform super_admin", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(10);

    const res = await request(app)
      .post("/api/organizations/10/suspend")
      .set("Authorization", "Bearer valid-token")
      .send({ confirmSlug: "org-10", reason: "Ticket #123 — non-payment" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("suspended");
    expect(fixtures.auditEvents[0].eventType).toBe("organization.suspended");
    expect(fixtures.auditEvents[0].organizationId).toBe(10);
    expect(fixtures.auditEvents[0].metadata).toMatchObject({
      blastRadius: "tenant_scoped",
      operation: "organization.suspend",
      targetOrganizationId: 10,
      tenantSlug: "org-10",
      reason: "Ticket #123 — non-payment",
    });
  });

  it("reactivates a suspended organization for a super_admin with no membership in it", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .post("/api/organizations/99/reactivate")
      .set("Authorization", "Bearer valid-token")
      .send({ confirmSlug: "org-99" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(fixtures.auditEvents[0].eventType).toBe("organization.reactivated");
    expect(fixtures.auditEvents[0].organizationId).toBe(99);
    expect(fixtures.auditEvents[0].metadata).toMatchObject({ blastRadius: "tenant_scoped", targetOrganizationId: 99 });
  });

  // Phase 7: a dangerous tenant-specific action names its target twice and
  // the two must agree. A missing or mismatched tenant code changes nothing
  // and records nothing — the wrong customer cannot be suspended by a stale
  // screen or a mistyped id.
  it("refuses to suspend without a typed confirmSlug", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .post("/api/organizations/99/suspend")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
    expect(fixtures.auditEvents).toHaveLength(0);
  });

  it("refuses to suspend when confirmSlug names a different tenant", async () => {
    mockSession({ id: 1, role: "super_admin", organizationId: 10 });
    mockOrganization(99);

    const res = await request(app)
      .post("/api/organizations/99/suspend")
      .set("Authorization", "Bearer valid-token")
      .send({ confirmSlug: "org-10" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmSlug/);
    expect(fixtures.auditEvents).toHaveLength(0);
  });
});
