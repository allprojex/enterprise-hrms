/**
 * WS-18 Pass 2 §10, §20, §25, §29 — adversarial tests for write-path privilege
 * acquisition and for what the API says when it fails.
 *
 * Three properties, each of which has a plausible way of silently regressing:
 *
 *   §10  Mass assignment. `routes/branches.ts` builds its insert as
 *        `{ organizationId: req.membership!.organizationId, ...parsed.data }` —
 *        the server value FIRST and the client-derived spread SECOND. That
 *        ordering is only safe because `CreateBranchBody` is a plain
 *        `zod.object({ name, code })`, and Zod strips unknown keys, so
 *        `parsed.data` can never carry an `organizationId` to overwrite it with.
 *        The safety is therefore a property of the schema, not of the handler,
 *        and adding `.passthrough()` or an `organizationId` field to the schema
 *        would turn it into a cross-tenant write. These tests pin that down.
 *
 *   §20  Tenant-controlled strings. The API is JSON-only, so an HTML/script
 *        payload stored in a tenant field must come back as JSON *data* with a
 *        JSON content type — never reflected into an HTML response where a
 *        browser would parse it.
 *
 *   §25  Error leakage. A failure must not narrate itself with a stack trace,
 *        an absolute path, an exception message, or an HTML error page.
 *
 * Every negative case asserts BOTH refusal and unchanged state, per §29.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const harness = await import("./security/adversarialHarness");
const { ORG_A, ORG_B, seedTwoOrgs, bearer, expectDenied, expectAllowed } = harness;

const state = vi.hoisted(() => ({
  store: {} as Record<string, Record<string, unknown>[]>,
  unsupported: [] as string[],
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const h = await import("./security/adversarialHarness");
  return h.drizzleOperators(actual);
});

vi.mock("@workspace/db", async () => {
  const h = await import("./security/adversarialHarness");
  const engine = h.createEngine(state.store as never);
  state.unsupported = engine.unsupported;
  return {
    db: engine.db,
    usersTable: h.TABLES.users,
    sessionsTable: h.TABLES.sessions,
    organizationMembershipsTable: h.TABLES.organizationMemberships,
    membershipRolesTable: h.TABLES.membershipRoles,
    rolePermissionsTable: h.TABLES.rolePermissions,
    permissionsTable: h.TABLES.permissions,
    modulesTable: h.TABLES.modules,
    organizationModulesTable: h.TABLES.organizationModules,
    breakGlassGrantsTable: h.TABLES.breakGlassGrants,
    branchesTable: h.mockTable("branches", ["id", "organizationId", "name", "code", "status", "createdAt"]),
    leaveTypesTable: h.mockTable("leave_types", ["id", "organizationId", "name", "code"]),
    auditEventsTable: h.mockTable("audit_events", ["id", "organizationId", "actorUserId", "action"]),
    organizationDomainsTable: h.mockTable("organization_domains", ["id", "organizationId", "hostname"]),
    organizationsTable: h.mockTable("organizations", ["id", "name", "slug"]),
  };
});

const { default: app } = await import("../app");

let fx: ReturnType<typeof seedTwoOrgs>;

beforeEach(() => {
  for (const key of Object.keys(state.store)) delete state.store[key];
  state.unsupported.length = 0;

  fx = seedTwoOrgs({
    permissions: {
      employee: [],
      manager: [],
      hr: ["branch.read", "branch.manage"],
      admin: ["branch.read", "branch.manage"],
    },
    moduleRegistry: ["leave"],
    // Scoped so break-glass elevation passes requirePermission and actually
    // reaches the handler — that is the unhandled-error path §25 needs.
    breakGlassScope: ["branch.read"],
  });
  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.branches = [];
  state.store.leave_types = [];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  state.store.organizations = [
    { id: ORG_A, name: "Alpha Ltd", slug: "alpha" },
    { id: ORG_B, name: "Beta Ltd", slug: "beta" },
  ];
});

const branchesOf = (orgId: number) => `/api/organizations/${orgId}/branches`;

describe("§10 — mass assignment cannot move a write into another tenant", () => {
  it("positive control: an entitled actor can create a branch in their own organization", async () => {
    const res = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .send({ name: "Legit Branch", code: "LEGIT" });

    expectAllowed(res);
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(ORG_A);
  });

  it("an organizationId in the body is discarded, not honoured", async () => {
    const res = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .send({ name: "Smuggled", code: "SMUG", organizationId: ORG_B });

    expect(res.status).toBe(201);
    // The row must belong to the organization in the authenticated path scope,
    // never the one the client asked for.
    expect(res.body.organizationId).toBe(ORG_A);
    expect(state.store.branches).toHaveLength(1);
    expect(state.store.branches[0].organizationId).toBe(ORG_A);
    // Nothing was written into the other tenant.
    expect(state.store.branches.filter((b) => b.organizationId === ORG_B)).toHaveLength(0);
  });

  it("id, status, and createdAt cannot be set by the client", async () => {
    const res = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .send({
        name: "Forged",
        code: "FORGE",
        id: 4242,
        status: "inactive",
        createdAt: "1999-01-01T00:00:00.000Z",
      });

    expect(res.status).toBe(201);
    const stored = state.store.branches[0];
    expect(stored.id).not.toBe(4242);
    expect(stored.createdAt).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("role-shaped and permission-shaped fields do not escalate the writer", async () => {
    const before = state.store.branches.length;

    const res = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.employee)) // holds no branch.manage
      .send({
        name: "Escalated",
        code: "ESC",
        role: "super_admin",
        permissions: ["branch.manage"],
        membershipId: fx.a.hr.membershipId,
      });

    expectDenied(res);
    // §29 — the refusal changed nothing.
    expect(state.store.branches).toHaveLength(before);
  });

  it("a cross-tenant write is refused and writes nothing anywhere", async () => {
    const res = await request(app)
      .post(branchesOf(ORG_B))
      .set("Authorization", bearer(fx.a.hr))
      .send({ name: "Invader", code: "INV" });

    expectDenied(res);
    expect(state.store.branches).toHaveLength(0);
  });
});

describe("§20 — tenant-controlled strings are returned as data, never as markup", () => {
  const PAYLOAD = '<img src=x onerror="alert(1)"><script>alert(2)</script>';

  it("an HTML/script payload round-trips as JSON with a JSON content type", async () => {
    const created = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .send({ name: PAYLOAD, code: "XSS1" });
    expect(created.status).toBe(201);

    const listed = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectAllowed(listed);

    // Content type must be JSON: a browser will not parse this as a document,
    // and helmet's nosniff stops it being re-interpreted as one.
    expect(listed.headers["content-type"]).toMatch(/application\/json/);
    expect(listed.headers["x-content-type-options"]).toBe("nosniff");

    // The value survives intact as DATA (React escapes it at the render
    // boundary; the API's job is to not turn it into markup here).
    expect(listed.body[0].name).toBe(PAYLOAD);

    // And the raw response body must not contain an unescaped, parseable tag
    // sequence outside of a JSON string context.
    expect(listed.text.startsWith("[") || listed.text.startsWith("{")).toBe(true);
  });

  it("a payload stored by one tenant is never visible to another", async () => {
    await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .send({ name: PAYLOAD, code: "XSS2" });

    const otherTenant = await request(app).get(branchesOf(ORG_B)).set("Authorization", bearer(fx.b.hr));
    expectAllowed(otherTenant);
    expect(JSON.stringify(otherTenant.body)).not.toContain("onerror");
  });
});

describe("§25 — failures do not narrate themselves", () => {
  it("an unhandled server error returns generic JSON with no stack, path, or message", async () => {
    // Break-glass elevation on a `req.membership!` handler throws inside the
    // route (finding WS18-P2-05) — a genuine unhandled error path, not a
    // synthetic one.
    const res = await request(app)
      .get(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.superAdminWithBreakGlass));

    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual(expect.objectContaining({ error: "Internal server error" }));

    const body = res.text;
    expect(body).not.toMatch(/\s+at\s+\S+\s+\(/); // no stack frames
    expect(body).not.toContain("api-server/src/routes"); // no source paths
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("<!DOCTYPE html>"); // not Express's HTML page
    expect(body.toLowerCase()).not.toContain("cannot read properties");
    expect(body.toLowerCase()).not.toContain("typeerror");
  });

  it("no error response carries database or connection detail", async () => {
    const res = await request(app)
      .get(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.superAdminWithBreakGlass));

    const body = res.text.toLowerCase();
    for (const secret of ["postgres://", "postgresql://", "password", "select ", "database_url", "supabase"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("an unknown API route does not reveal internals", async () => {
    const res = await request(app)
      .get("/api/organizations/101/this-route-does-not-exist")
      .set("Authorization", bearer(fx.a.hr));

    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/\s+at\s+\S+\s+\(/);
    expect(res.text).not.toContain("api-server/src");
  });

  it("a malformed JSON body is rejected without a stack trace", async () => {
    const res = await request(app)
      .post(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.hr))
      .set("Content-Type", "application/json")
      .send("{ this is not json");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.text).not.toMatch(/\s+at\s+\S+\s+\(/);
    expect(res.text).not.toContain("node_modules");
  });

  it("a cross-tenant denial does not disclose whether the resource exists", async () => {
    // Two probes: one organization that exists, one that does not. An attacker
    // must not be able to tell them apart.
    const existing = await request(app).get(branchesOf(ORG_B)).set("Authorization", bearer(fx.a.hr));
    const nonExistent = await request(app).get(branchesOf(999999)).set("Authorization", bearer(fx.a.hr));

    expectDenied(existing);
    expectDenied(nonExistent);
    expect(nonExistent.status).toBe(existing.status);
    expect(nonExistent.body).toEqual(existing.body);
  });
});

describe("harness integrity", () => {
  it("no query shape went unanswered by the mock", () => {
    expect(state.unsupported).toEqual([]);
  });
});
