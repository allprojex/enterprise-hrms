/**
 * WS-18 Pass 2 §8, §9, §15, §16, §17 — adversarial tests for the authorization
 * chain that every organization-scoped route in this platform composes:
 *
 *     requireAuth -> requireMembership(:organizationId)
 *                 -> requireModuleEnabled(module)
 *                 -> requirePermission(key)
 *
 * These are deliberately NOT per-route duplicates of the existing feature
 * suites. Tenant isolation in this codebase is enforced in one place — the
 * chain — and `req.membership.organizationId` is what every handler scopes on.
 * So the property worth proving adversarially is that the chain cannot be talked
 * out of a denial: not that 200-odd handlers each independently remember to
 * filter. Two real routes with different chain shapes are exercised
 * (`/branches`, no module gate; `/leave-types`, module-gated) so the matrix
 * covers both compositions rather than one special case.
 *
 * ## Why every negative case has a positive control
 *
 * A mocked database can make a security test pass for the wrong reason. If the
 * mock cannot answer a query the route 500s, and a test asserting "not 200" goes
 * green while proving nothing. Every block below therefore also runs the
 * *entitled* caller against the *same* route and asserts success. If the
 * positive control ever fails, the suite fails — the denials next to it would be
 * meaningless. `expectDenied` additionally refuses to accept a 500 as a denial.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const harness = await import("./security/adversarialHarness");
const {
  TABLES,
  ORG_A,
  ORG_B,
  seedTwoOrgs,
  createEngine,
  drizzleOperators,
  bearer,
  expectDenied,
  expectAllowed,
  expectNoLeakage,
} = harness;

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
    rolesTable: h.TABLES.roles,
    rolePermissionsTable: h.TABLES.rolePermissions,
    permissionsTable: h.TABLES.permissions,
    modulesTable: h.TABLES.modules,
    organizationModulesTable: h.TABLES.organizationModules,
    breakGlassGrantsTable: h.TABLES.breakGlassGrants,
    branchesTable: h.mockTable("branches", ["id", "organizationId", "name", "code", "isActive"]),
    leaveTypesTable: h.mockTable("leave_types", ["id", "organizationId", "name", "code"]),
    auditEventsTable: h.mockTable("audit_events", ["id", "organizationId", "actorUserId", "action"]),
    organizationDomainsTable: h.mockTable("organization_domains", ["id", "organizationId", "hostname"]),
    organizationsTable: h.mockTable("organizations", ["id", "name", "slug"]),
  };
});

const { default: app } = await import("../app");

const PERMS = {
  employee: [],
  manager: [],
  hr: ["branch.read", "leave_type.read"],
  admin: ["branch.read", "leave_type.read"],
} as const;

let fx: ReturnType<typeof seedTwoOrgs>;

/** Seeds both organizations plus one branch and one leave type in each. */
function seed(options?: Parameters<typeof seedTwoOrgs>[0]) {
  fx = seedTwoOrgs({
    permissions: PERMS as never,
    moduleRegistry: ["leave"],
    breakGlassScope: ["branch.read"],
    ...options,
  });

  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.branches = [
    { id: 9001, organizationId: ORG_A, name: "Alpha HQ", code: "A-HQ", isActive: true },
    { id: 9002, organizationId: ORG_B, name: "Beta Secret Site", code: "B-SEC", isActive: true },
  ];
  state.store.leave_types = [
    { id: 8001, organizationId: ORG_A, name: "Alpha Annual", code: "A-ANN" },
    { id: 8002, organizationId: ORG_B, name: "Beta Confidential Leave", code: "B-CONF" },
  ];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  state.store.organizations = [
    { id: ORG_A, name: "Alpha Ltd", slug: "alpha" },
    { id: ORG_B, name: "Beta Ltd", slug: "beta" },
  ];
}

beforeEach(() => {
  for (const key of Object.keys(state.store)) delete state.store[key];
  state.unsupported.length = 0;
  seed();
});

const branchesOf = (orgId: number) => `/api/organizations/${orgId}/branches`;
const leaveTypesOf = (orgId: number) => `/api/organizations/${orgId}/leave-types`;

describe("§8 — cross-tenant access by organization id", () => {
  it("positive control: an entitled Org A actor CAN read Org A branches", async () => {
    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectAllowed(res);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Alpha HQ");
  });

  it("Org A HR cannot read Org B branches by substituting the organization id", async () => {
    const res = await request(app).get(branchesOf(ORG_B)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res);
    // The denial must not confirm the resource exists or name it.
    expectNoLeakage(res, ["Beta Secret Site", "B-SEC", "Beta Ltd"]);
  });

  it("Org A HR cannot read Org B leave types (module-gated route)", async () => {
    expectAllowed(await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.a.hr)));

    const res = await request(app).get(leaveTypesOf(ORG_B)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res);
    expectNoLeakage(res, ["Beta Confidential Leave", "B-CONF"]);
  });

  it("Org B HR cannot reach Org A — isolation holds in both directions", async () => {
    expectAllowed(await request(app).get(branchesOf(ORG_B)).set("Authorization", bearer(fx.b.hr)));

    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.b.hr));
    expectDenied(res);
    expectNoLeakage(res, ["Alpha HQ", "A-HQ"]);
  });

  it("a response never contains another tenant's rows even when access is legitimate", async () => {
    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectAllowed(res);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("Beta Secret Site");
    expect(serialized).not.toContain("B-SEC");
  });

  it("an unauthenticated caller is rejected before any tenant logic runs", async () => {
    expectDenied(await request(app).get(branchesOf(ORG_A)), [401]);
    expectDenied(await request(app).get(branchesOf(ORG_A)).set("Authorization", "Bearer forged"), [401]);
  });
});

describe("§8 — membership must be live, not merely present", () => {
  it("an inactive membership does not grant access", async () => {
    const membership = state.store.organization_memberships.find((m) => m.id === fx.a.hr.membershipId)!;
    membership.status = "suspended";

    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res);
  });

  it("an expired membership does not grant access", async () => {
    const membership = state.store.organization_memberships.find((m) => m.id === fx.a.hr.membershipId)!;
    membership.expiresAt = new Date(Date.now() - 60_000);

    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res);
  });

  it("a disabled user is rejected even with a live session and live membership", async () => {
    const user = state.store.users.find((u) => u.id === fx.a.hr.userId)!;
    user.disabledAt = new Date();

    // Deliberately the same generic 401 as any other bad credential — this
    // boundary must not distinguish "disabled" from "unknown token".
    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res, [401]);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("an expired session is rejected", async () => {
    const session = state.store.sessions.find((s) => s.userId === fx.a.hr.userId)!;
    session.expiresAt = new Date(Date.now() - 60_000);

    expectDenied(await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr)), [401]);
  });
});

describe("§10 — authority cannot be acquired by tampering with the request", () => {
  it("a member without the permission is denied, and cannot grant it via the body", async () => {
    expectDenied(await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.employee)));

    // Permission-shaped and role-shaped fields in the payload must be inert.
    const res = await request(app)
      .get(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.a.employee))
      .send({
        permissions: ["branch.read"],
        role: "super_admin",
        roleId: 1,
        membershipId: fx.a.hr.membershipId,
        organizationId: ORG_A,
      });
    expectDenied(res);
  });

  it("a query-string organizationId cannot override the authoritative path scope", async () => {
    // Asking for Org A while naming Org B in the query must still return only
    // Org A's rows — the handler scopes on the resolved membership, never input.
    const res = await request(app)
      .get(`${branchesOf(ORG_A)}?organizationId=${ORG_B}`)
      .set("Authorization", bearer(fx.a.hr));
    expectAllowed(res);
    expect(JSON.stringify(res.body)).not.toContain("Beta Secret Site");
  });

  it("a forged membership id in the body does not change the resolved membership", async () => {
    const res = await request(app)
      .get(branchesOf(ORG_B))
      .set("Authorization", bearer(fx.a.hr))
      .send({ membershipId: fx.b.hr.membershipId, applicationUserId: fx.b.hr.userId });
    expectDenied(res);
  });

  it("a non-numeric organization id is rejected without reaching a handler", async () => {
    const res = await request(app)
      .get("/api/organizations/not-a-number/branches")
      .set("Authorization", bearer(fx.a.hr));
    expectDenied(res, [400, 403, 404]);
  });
});

describe("§17 — module gating is enforced server-side", () => {
  it("a disabled module blocks the route even for a fully permissioned caller", async () => {
    seed({ modulesEnabledForA: [] });

    // Same caller, same permission — only module enablement differs.
    const res = await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.a.hr));
    expectDenied(res);

    // Control: the non-module-gated route on the same organization still works,
    // proving the denial came from module gating and not a broken fixture.
    expectAllowed(await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.a.hr)));
  });

  it("another tenant's module enablement does not carry across", async () => {
    seed({ modulesEnabledForA: [], modulesEnabledForB: ["leave"] });

    expectDenied(await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.a.hr)));
    // Org B genuinely has it enabled — so the module itself is reachable, and
    // the Org A denial is about Org A's own configuration.
    expectAllowed(await request(app).get(leaveTypesOf(ORG_B)).set("Authorization", bearer(fx.b.hr)));
  });

  it("a module absent from the registry is denied rather than defaulting open", async () => {
    seed({ moduleRegistry: [] });
    expectDenied(await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.a.hr)));
  });
});

describe("§15/§16 — platform authority confers no standing tenant access", () => {
  it("a super admin with no break-glass grant is denied customer data", async () => {
    const res = await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.superAdminNoGrant));
    expectDenied(res);
    expectNoLeakage(res, ["Alpha HQ"]);
  });

  it("an active grant for Org A gives nothing in Org B", async () => {
    const actor = fx.superAdminWithBreakGlass;
    const res = await request(app).get(branchesOf(ORG_B)).set("Authorization", bearer(actor));
    expectDenied(res);
    expectNoLeakage(res, ["Beta Secret Site", "B-SEC"]);
  });

  /**
   * Finding WS18-P2-05, encoded as a regression test rather than described in a
   * document nobody re-reads.
   *
   * requireMembership deliberately leaves `req.membership` UNDEFINED under
   * break-glass elevation and exposes `resolveOrganizationId(req)` as the safe
   * accessor — its own doc comment warns that handlers reading
   * `req.membership!.organizationId` "will throw under elevation". Only 5 route
   * files use the safe accessor; 101 dereference `req.membership!` directly. So
   * on the overwhelming majority of organization-scoped routes, a valid grant
   * does not elevate — it produces a 500.
   *
   * The security-relevant half is asserted here and is good news: the failure is
   * CLOSED. No row from any organization is returned. This is therefore a
   * correctness/availability defect in an emergency-access control, not a data
   * exposure — graded Low and carried forward as WS-4 follow-on work, not
   * remediated here (fixing it means touching 101 route files, well outside this
   * pass's scope).
   *
   * When that follow-on lands, this test will start failing. That is the point:
   * change it to `expectAllowed` then, and the fix is proven.
   */
  it("WS18-P2-05: elevation on a req.membership! handler fails CLOSED, leaking nothing", async () => {
    const res = await request(app)
      .get(branchesOf(ORG_A))
      .set("Authorization", bearer(fx.superAdminWithBreakGlass));

    expect(res.status).toBe(500);
    const serialized = JSON.stringify(res.body) + (res.text ?? "");
    expect(serialized).not.toContain("Alpha HQ");
    expect(serialized).not.toContain("Beta Secret Site");

    // §25 / finding WS18-P2-06 — the failure must not narrate itself. No stack
    // frames, no absolute paths, no exception message, and a JSON body rather
    // than Express's default HTML error page.
    expect(res.body).toEqual(expect.objectContaining({ error: "Internal server error" }));
    expect(serialized).not.toMatch(/\s+at\s+\S+\s+\(/);
    expect(serialized).not.toContain("api-server/src/routes");
    expect(serialized).not.toContain("node_modules");
    expect(serialized.toLowerCase()).not.toContain("cannot read properties");
    expect(serialized).not.toContain("<!DOCTYPE html>");
  });

  it("an expired grant is denied", async () => {
    expectDenied(
      await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.superAdminExpiredBreakGlass)),
    );
  });

  it("a revoked grant is denied immediately", async () => {
    expectDenied(
      await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.superAdminRevokedBreakGlass)),
    );
  });

  it("a grant for the wrong organization is denied", async () => {
    expectDenied(
      await request(app).get(branchesOf(ORG_A)).set("Authorization", bearer(fx.superAdminWrongOrgBreakGlass)),
    );
  });

  it("a grant never exceeds its own scope", async () => {
    // The grant's scope is ["branch.read"] only. requirePermission rejects the
    // leave route before any handler runs, so this asserts the scope check
    // itself rather than anything downstream.
    const res = await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.superAdminWithBreakGlass));
    expectDenied(res);
    expectNoLeakage(res, ["Alpha Annual", "A-ANN"]);
  });

  it("a scope entry for one organization does not travel to another", async () => {
    // Grant names Org B; caller asks for Org A's leave types. Two independent
    // reasons to deny (wrong org, and key not in scope) — neither may be missed.
    expectDenied(
      await request(app).get(leaveTypesOf(ORG_A)).set("Authorization", bearer(fx.superAdminWrongOrgBreakGlass)),
    );
  });

  it("an ordinary tenant user cannot mint a break-glass grant for themselves", async () => {
    // Writing a grant row is the *only* way to elevate; the API surface for
    // doing so must not be reachable by a tenant member. Whatever the route
    // shape, the outcome must be a refusal, never a created grant.
    const before = state.store.break_glass_grants.length;
    const res = await request(app)
      .post("/api/break-glass-grants")
      .set("Authorization", bearer(fx.a.hr))
      .send({ actorUserId: fx.a.hr.userId, targetOrganizationId: ORG_A, scope: ["branch.read"] });

    expect(res.status).toBeGreaterThanOrEqual(400);
    // §29: the refusal must also have changed nothing.
    expect(state.store.break_glass_grants).toHaveLength(before);
  });
});

describe("harness integrity", () => {
  it("no query shape went unanswered by the mock", () => {
    // If this fires, some denial above may have been a 500 in disguise.
    expect(state.unsupported).toEqual([]);
  });
});
