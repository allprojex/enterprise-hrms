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
  rolesTable,
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
    rolesTable: { __name: "roles" },
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
  rolesTable,
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

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: vi.fn(async () => undefined),
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
const { writeOrgFile, deleteOrgFile } = await import("../lib/fileStorage");
const { recordAuditEvent } = await import("../lib/auditLog");

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

/**
 * Organization Branding upload UI (WS-25) — server-side guarantees the UI
 * relies on. The UI is convenience only; every rule below is enforced here
 * regardless of what the client sends.
 */
describe("PATCH /organizations/:id/logo — security and storage guarantees", () => {
  const NEW_KEY = "branding/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  const NEW_URL = "/api/organizations/3/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";

  async function transparentPng(): Promise<Buffer> {
    return sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } } })
      .png()
      .toBuffer();
  }

  beforeEach(() => {
    fixtures.sessionRows = [activeSession()];
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: null }];
    fixtures.updated = [];
    vi.mocked(writeOrgFile).mockClear();
    vi.mocked(deleteOrgFile).mockClear();
    vi.mocked(deleteOrgFile).mockImplementation(async () => undefined);
    vi.mocked(recordAuditEvent).mockClear();
  });

  it("401s an unauthenticated caller before touching storage", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .attach("file", await transparentPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(401);
    expect(writeOrgFile).not.toHaveBeenCalled();
  });

  it("403s an authenticated user with no active membership in the target organization (cross-tenant)", async () => {
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    mockPermissions(["organization.update"]);
    const res = await request(app)
      .patch("/api/organizations/4/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", await transparentPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(writeOrgFile).not.toHaveBeenCalled();
    expect(fixtures.updated).toEqual([]);
  });

  it("writes under the VERIFIED membership's organization, never a client-controlled id", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .field("organizationId", "999")
      .attach("file", await transparentPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(writeOrgFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeOrgFile).mock.calls[0][0]).toBe(3);
  });

  it("rejects SVG (declared type and content) with 400", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const declared = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", svg, { filename: "logo.svg", contentType: "image/svg+xml" });
    expect(declared.status).toBe(400);
    const disguised = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", svg, { filename: "logo.png", contentType: "image/png" });
    expect(disguised.status).toBe(400);
    expect(writeOrgFile).not.toHaveBeenCalled();
  });

  it("magic bytes decide: non-image content is rejected whatever the declared type, and the stored extension follows the declared allowed type — never the filename", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    // Executable-looking bytes declared as JPEG: signature check rejects.
    const fake = Buffer.concat([Buffer.from("MZ\x90\x00"), Buffer.alloc(64)]);
    const rejected = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", fake, { filename: "logo.jpg", contentType: "image/jpeg" });
    expect(rejected.status).toBe(400);
    expect(writeOrgFile).not.toHaveBeenCalled();

    // Real JPEG bytes with a misleading filename: accepted, stored as .jpg
    // under the fixed branding subdir — the filename plays no part.
    const jpegBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", jpegBytes, { filename: "logo.exe.png", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(vi.mocked(writeOrgFile).mock.calls[0][1]).toBe("branding");
    expect(vi.mocked(writeOrgFile).mock.calls[0][2]).toBe("jpg");
  });

  it("rejects a file over 5MB with a 400 JSON error, not a 500", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(5 * 1024 * 1024 + 16)]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", big, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5MB/);
    expect(writeOrgFile).not.toHaveBeenCalled();
  });

  it("never lets the supplied filename influence the storage path (fixed subdir, server-generated key)", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", await transparentPng(), { filename: "../../../etc/passwd.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    const [orgId, subdir, extension] = vi.mocked(writeOrgFile).mock.calls[0];
    expect(orgId).toBe(3);
    expect(subdir).toBe("branding");
    expect(extension).toBe("png");
    expect(res.body.logoUrl).toBe(NEW_URL);
    expect(res.body.logoUrl).not.toContain("..");
  });

  it("replaces a DANGLING previous logo (reference exists, binary missing): delete failure never aborts the upload", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    const oldUrl = "/api/organizations/3/logo/f854992789a923b5310294c7280688ec9e141d18289ca11c.png";
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: oldUrl }];
    vi.mocked(deleteOrgFile).mockRejectedValueOnce(new Error("ENOENT: previous binary was never on this host"));

    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", await transparentPng(), { filename: "official.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(NEW_URL);
    // new object written first, then the old reference's file removed best-effort
    expect(writeOrgFile).toHaveBeenCalledTimes(1);
    expect(deleteOrgFile).toHaveBeenCalledWith(3, "branding/f854992789a923b5310294c7280688ec9e141d18289ca11c.png");
    // the dangling reference is gone from the organization row
    const update = fixtures.updated.find((u) => u.table === "organizations");
    expect(update?.values).toEqual({ logoUrl: NEW_URL });
    expect(fixtures.orgRows[0].logoUrl).toBe(NEW_URL);
    // and the new asset now serves publicly
    const served = await request(app).get(NEW_URL);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    void NEW_KEY;
  });

  it("records an organization.logo_updated audit event with before/after references", async () => {
    membership(["org_admin"]);
    mockPermissions(["organization.update"]);
    fixtures.orgRows = [{ id: 3, status: "trial", logoUrl: "/api/organizations/3/logo/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png" }];
    const res = await request(app)
      .patch("/api/organizations/3/logo")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", await transparentPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAuditEvent).mock.calls[0][0]).toMatchObject({
      organizationId: 3,
      eventType: "organization.logo_updated",
      targetType: "organization",
      targetId: "3",
      beforeState: { logoUrl: "/api/organizations/3/logo/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png" },
      afterState: { logoUrl: NEW_URL },
    });
  });
});
