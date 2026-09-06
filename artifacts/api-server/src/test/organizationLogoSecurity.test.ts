/**
 * WS-25 Organization Branding — security and regression coverage for
 * PATCH /organizations/:id/logo, complementing organizationLogoHttp.test.ts.
 *
 * Two things this file pins down that the earlier file did not:
 *
 *   1. The authority chain end to end — unauthenticated, no membership,
 *      cross-tenant, tampered id, missing permission — with membership
 *      resolution modelled faithfully (getActiveMembership is mocked on its
 *      real (userId, organizationId) contract, so a member of org 3 posting
 *      to org 4 is refused because no row exists for org 4, exactly as the
 *      database would answer).
 *
 *   2. The "dangling old file" scenario seen on Production: organizations.
 *      logoUrl points at a binary that no longer exists. Replacing the logo
 *      must still succeed, the failed cleanup of the old object must be
 *      non-fatal, the reference must move to the new object, the new object
 *      must serve, and the old URL must 404 cleanly rather than crash.
 *
 * @workspace/db, ../lib/fileStorage and ../lib/membership are mocked — no
 * real database connection or disk I/O is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";

const NEW_KEY = "branding/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";
const NEW_FILENAME = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";
const OLD_FILENAME = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
const OLD_URL = `/api/organizations/3/logo/${OLD_FILENAME}`;

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
  storage,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      memberships: [] as { id: number; applicationUserId: number; organizationId: number; status: string }[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      orgRows: [] as Record<string, unknown>[],
      updated: [] as { table: string; values: unknown }[],
      inserted: [] as { table: string; values: Record<string, unknown> }[],
    },
    storage: {
      // Which keys currently have bytes. The OLD key is deliberately absent
      // in the dangling-file tests.
      present: new Set<string>(),
      deleteShouldFail: false,
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
        if (table === organizationMembershipsTable) rows = fixtures.memberships;
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
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return {
          returning: () => Promise.resolve([{ id: 1, ...v }]),
          onConflictDoNothing: () => Promise.resolve(undefined),
          then: (resolve: (x: unknown) => void) => resolve(undefined),
        };
      },
    }),
  },
}));

// Faithful membership resolution: a row is found only for the exact
// (userId, organizationId) pair, mirroring the real query's WHERE clause.
vi.mock("../lib/membership", () => ({
  getActiveMembership: vi.fn(async (userId: number, organizationId: number) => {
    return (
      fixtures.memberships.find(
        (m) => m.applicationUserId === userId && m.organizationId === organizationId && m.status === "active",
      ) ?? null
    );
  }),
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async (_orgId: number, _subdir: string, _ext: string, _data: Buffer) => {
    storage.present.add(NEW_KEY);
    return NEW_KEY;
  }),
  readOrgFile: vi.fn(async (_orgId: number, key: string) => {
    if (storage.present.has(key)) return Buffer.from("png-bytes");
    throw new Error("ENOENT: object missing");
  }),
  deleteOrgFile: vi.fn(async (_orgId: number, key: string) => {
    if (storage.deleteShouldFail) throw new Error("storage backend unavailable");
    storage.present.delete(key);
  }),
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
const fileStorage = await import("../lib/fileStorage");

const REAL_TOKEN = "test-session-token";

function activeSession(role: "org_admin" | "employee" = "org_admin") {
  return {
    session: { id: 1, token: REAL_TOKEN, userId: 1, expiresAt: new Date(Date.now() + 3600_000) },
    user: {
      id: 1,
      email: "admin@tenant.test",
      firstName: "Ama",
      lastName: "Boateng",
      role,
      organizationId: 3,
      avatarUrl: null,
      jobTitle: null,
      department: null,
      phoneNumber: null,
      createdAt: new Date(),
    },
  };
}

function memberOf(organizationId: number) {
  fixtures.memberships = [{ id: 5, applicationUserId: 1, organizationId, status: "active" }];
  fixtures.membershipRoleRows = [{ roleId: 1 }];
}

function grant(keys: string[]) {
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

async function validPng(): Promise<Buffer> {
  return sharp({ create: { width: 48, height: 24, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.4 } } })
    .png()
    .toBuffer();
}

async function validJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

function patchLogo(orgId: number | string) {
  return request(app).patch(`/api/organizations/${orgId}/logo`).set("Authorization", `Bearer ${REAL_TOKEN}`);
}

beforeEach(() => {
  fixtures.sessionRows = [activeSession()];
  fixtures.memberships = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.orgRows = [{ id: 3, status: "active", logoUrl: null }];
  fixtures.updated = [];
  fixtures.inserted = [];
  storage.present = new Set();
  storage.deleteShouldFail = false;
  vi.mocked(fileStorage.writeOrgFile).mockClear();
  vi.mocked(fileStorage.deleteOrgFile).mockClear();
});

describe("PATCH /organizations/:id/logo — authority chain", () => {
  it("401s an unauthenticated request before touching storage", async () => {
    const res = await request(app).patch("/api/organizations/3/logo").attach("file", await validPng(), {
      filename: "logo.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(401);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("403s an authenticated user with no membership in the organization", async () => {
    fixtures.memberships = [];
    grant(["organization.update"]);
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("403s a cross-tenant attempt: a member of org 3 cannot set org 4's logo", async () => {
    memberOf(3);
    grant(["organization.update"]);
    const res = await patchLogo(4).attach("file", await validPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
    expect(fixtures.updated).toHaveLength(0);
  });

  it("400s a tampered, non-numeric organization id", async () => {
    memberOf(3);
    grant(["organization.update"]);
    const res = await patchLogo("not-an-id").attach("file", await validPng(), {
      filename: "logo.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(400);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("403s a member who lacks organization.update", async () => {
    memberOf(3);
    grant(["employee.read"]);
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("allows an own-organization member holding organization.update", async () => {
    memberOf(3);
    grant(["organization.update"]);
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(`/api/organizations/3/logo/${NEW_FILENAME}`);
    expect(fixtures.updated).toEqual([{ table: "organizations", values: { logoUrl: `/api/organizations/3/logo/${NEW_FILENAME}` } }]);
  });
});

describe("PATCH /organizations/:id/logo — file validation", () => {
  beforeEach(() => {
    memberOf(3);
    grant(["organization.update"]);
  });

  it("400s a non-image MIME type", async () => {
    const res = await patchLogo(3).attach("file", Buffer.from("hello"), { filename: "logo.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPEG, PNG, and WebP only/);
  });

  it("400s an SVG even when it is a well-formed image document", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    const res = await patchLogo(3).attach("file", svg, { filename: "logo.svg", contentType: "image/svg+xml" });
    expect(res.status).toBe(400);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("400s an SVG smuggled under a PNG extension and Content-Type (signature mismatch)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const res = await patchLogo(3).attach("file", svg, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match an allowed image type/);
  });

  it("400s real JPEG bytes declared as image/png (declared type must agree with the signature)", async () => {
    const res = await patchLogo(3).attach("file", await validJpeg(), { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match its declared image type/);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("400s (never 500s) a file over the 5MB limit", async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);
    const res = await patchLogo(3).attach("file", oversized, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5MB/);
    expect(fileStorage.writeOrgFile).not.toHaveBeenCalled();
  });

  it("400s when no file field is present", async () => {
    const res = await patchLogo(3).field("note", "no file here");
    expect(res.status).toBe(400);
  });

  it("never lets the browser filename influence the storage key or the URL", async () => {
    const res = await patchLogo(3).attach("file", await validPng(), {
      filename: "../../../etc/passwd.png",
      contentType: "image/png",
    });
    expect(res.status).toBe(200);
    // Storage receives only the fixed subdir and the extension derived from
    // the validated MIME type; the client name never reaches it.
    const [orgId, subdir, extension] = vi.mocked(fileStorage.writeOrgFile).mock.calls[0];
    expect(orgId).toBe(3);
    expect(subdir).toBe("branding");
    expect(extension).toBe("png");
    expect(res.body.logoUrl).toMatch(/^\/api\/organizations\/3\/logo\/[a-f0-9]{48}\.png$/);
    expect(res.body.logoUrl).not.toContain("etc");
  });
});

describe("PATCH /organizations/:id/logo — replacing a logo whose old binary is already missing", () => {
  beforeEach(() => {
    memberOf(3);
    grant(["organization.update"]);
    // The organization references OLD_URL, but no bytes exist for it.
    fixtures.orgRows = [{ id: 3, status: "active", logoUrl: OLD_URL }];
    storage.present = new Set();
  });

  it("the old URL 404s cleanly (no crash) while the reference dangles", async () => {
    const res = await request(app).get(OLD_URL);
    expect(res.status).toBe(404);
  });

  it("replacement succeeds, moves the reference, audits before/after, and the new object serves", async () => {
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "official.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    const newUrl = `/api/organizations/3/logo/${NEW_FILENAME}`;
    expect(res.body.logoUrl).toBe(newUrl);

    // Reference replaced, never left pointing at the missing object.
    expect(fixtures.orgRows[0].logoUrl).toBe(newUrl);

    // Best-effort cleanup of the dangling old object was attempted with the
    // OLD key, and its absence did not fail the request.
    expect(fileStorage.deleteOrgFile).toHaveBeenCalledWith(3, `branding/${OLD_FILENAME}`);

    // Audit: organization.logo_updated with before/after references.
    const audit = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(audit).toBeDefined();
    expect(audit!.values.eventType).toBe("organization.logo_updated");
    expect(audit!.values.organizationId).toBe(3);
    expect(audit!.values.beforeState).toEqual({ logoUrl: OLD_URL });
    expect(audit!.values.afterState).toEqual({ logoUrl: newUrl });

    // The new object is served publicly; the old URL now 404s because it is
    // no longer the organization's current logo.
    const served = await request(app).get(newUrl);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    const stale = await request(app).get(OLD_URL);
    expect(stale.status).toBe(404);
  });

  it("a storage failure while deleting the old object is non-fatal", async () => {
    storage.deleteShouldFail = true;
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "official.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe(`/api/organizations/3/logo/${NEW_FILENAME}`);
    expect(fileStorage.deleteOrgFile).toHaveBeenCalled();
    expect(fixtures.orgRows[0].logoUrl).toBe(`/api/organizations/3/logo/${NEW_FILENAME}`);
  });

  it("does not attempt to delete anything when the organization had no logo", async () => {
    fixtures.orgRows = [{ id: 3, status: "active", logoUrl: null }];
    const res = await patchLogo(3).attach("file", await validPng(), { filename: "first.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(fileStorage.deleteOrgFile).not.toHaveBeenCalled();
  });
});
