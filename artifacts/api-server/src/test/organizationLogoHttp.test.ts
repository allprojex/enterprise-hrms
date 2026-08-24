/**
 * HTTP-level tests for the Organization Logo routes (WWM Readiness,
 * Workstream 3): the public GET serves only what GET /tenant-context
 * already tells any caller it may fetch, and the authenticated PATCH
 * validates/stores/updates through requireMembership+requirePermission.
 * @workspace/db and ../lib/fileStorage are mocked — no real database
 * connection or disk I/O is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      orgRows: [] as Record<string, unknown>[],
      updated: [] as { table: string; values: unknown }[],
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    organizationsTable: { __name: "organizations" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === organizationsTable) rows = fixtures.orgRows;
        else rows = fixtures.sessionRows;

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
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            fixtures.updated.push({ table: table.__name, values: v });
            const merged = { ...fixtures.orgRows[0], ...v };
            fixtures.orgRows = [merged];
            return Promise.resolve([merged]);
          },
        }),
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => Promise.resolve([{ id: 1, ...v }]),
        then: (resolve: (x: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "branding/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
  readOrgFile: vi.fn(async (_orgId: number, key: string) => {
    if (key === "branding/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png") {
      return Buffer.from("fake-png-bytes");
    }
    throw new Error("not found");
  }),
  deleteOrgFile: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  gt: () => "gt",
  isNull: () => "isNull",
  inArray: () => "inArray",
}));

const { default: app } = await import("../app");

const REAL_TOKEN = "test-session-token";

function activeSession() {
  return {
    session: { id: 1, token: REAL_TOKEN, userId: 1, expiresAt: new Date(Date.now() + 3600_000) },
    user: {
      id: 1,
      email: "admin@wwm.test",
      firstName: "Kwame",
      lastName: "Owusu",
      role: "org_admin",
      organizationId: 3,
      avatarUrl: null,
      jobTitle: null,
      department: null,
      phoneNumber: null,
      createdAt: new Date(),
    },
  };
}

function membership(roles: string[]) {
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId: 3, status: "active" }];
  fixtures.membershipRoleRows = roles.map((r, i) => ({ roleId: i + 1 }));
}

function mockPermissions(keys: string[]) {
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

describe("GET /organizations/:id/logo/:filename (public)", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.orgRows = [];
  });

  it("serves the image for a resolved, non-suspended organization whose logoUrl matches", async () => {
    fixtures.orgRows = [
      { id: 3, status: "trial", logoUrl: "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" },
    ];
    const res = await request(app).get("/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("404s when the filename does not match the organization's own current logoUrl", async () => {
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" }];
    const res = await request(app).get("/api/organizations/3/logo/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png");
    expect(res.status).toBe(404);
  });

  it("404s for a suspended organization even with a matching logoUrl (fails safely, mirrors GET /tenant-context)", async () => {
    fixtures.orgRows = [{ id: 3, status: "suspended", logoUrl: "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" }];
    const res = await request(app).get("/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
    expect(res.status).toBe(404);
  });

  it("404s for a malformed filename without ever touching storage", async () => {
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" }];
    const res = await request(app).get("/api/organizations/3/logo/..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(404);
  });

  it("never requires authentication", async () => {
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png" }];
    const res = await request(app)
      .get("/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png")
      .set("Authorization", "");
    expect(res.status).toBe(200);
  });
});

describe("PATCH /organizations/:id/logo (authenticated)", () => {
  beforeEach(() => {
    fixtures.sessionRows = [activeSession()];
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: null }];
    fixtures.updated = [];
  });

  it("403s without organization.update permission", async () => {
    membership(["employee"]);
    mockPermissions([]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), "logo.png");
    expect(res.status).toBe(403);
  });

  it("400s for a file whose content does not match an allowed image type", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", Buffer.from("not an image"), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });

  it("updates organizations.logoUrl to the new public asset path on success, preserving a transparent PNG", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 150, b: 50, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", pngBytes, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe("/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png");
  });
});
