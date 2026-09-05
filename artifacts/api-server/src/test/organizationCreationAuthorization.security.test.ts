/**
 * Adversarial coverage for the platform organisation-ownership boundary.
 *
 * Creating a tenant, and platform tenant lifecycle (suspend/reactivate), are
 * control-plane actions reserved to the genuine platform super_admin
 * (`users.role === "super_admin"`). A tenant user — org_admin, hr_administrator,
 * Primary HR, custom admin, employee — must NEVER provision or suspend a tenant,
 * because onboardOrganization would make the creator org_admin + Primary HR of a
 * brand-new organisation. The bug: POST /organizations had only requireAuth.
 *
 * Real HTTP through the app; @workspace/db is the in-memory adversarial engine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import * as harness from "./security/adversarialHarness";

const { ORG_A, seedTwoOrgs, bearer, expectDenied, expectAllowed } = harness;

const state = vi.hoisted(() => ({ store: {} as Record<string, Record<string, unknown>[]>, unsupported: [] as string[] }));

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
    organizationsTable: h.TABLES.organizations,
    organizationMembershipsTable: h.TABLES.organizationMemberships,
    membershipRolesTable: h.TABLES.membershipRoles,
    rolePermissionsTable: h.TABLES.rolePermissions,
    permissionsTable: h.TABLES.permissions,
    rolesTable: h.TABLES.roles,
    primaryHrAssignmentsTable: h.TABLES.primaryHrAssignments,
    modulesTable: h.TABLES.modules,
    organizationModulesTable: h.TABLES.organizationModules,
    breakGlassGrantsTable: h.TABLES.breakGlassGrants,
    organizationDomainsTable: h.mockTable("organization_domains", ["id", "organizationId", "hostname", "status", "isPrimary", "domainType"]),
    auditEventsTable: h.mockTable("audit_events", ["id", "organizationId", "eventType", "targetType", "targetId", "actorApplicationUserId", "actorMembershipId", "metadata", "afterState", "beforeState", "occurredAt", "category", "outcome"]),
  };
});

const { default: app } = await import("../app");

const ADMIN_KEYS = ["organization.read", "organization.update", "membership.manage", "role.manage"];
const HR_ADMIN_KEYS = ["organization.read", "membership.read", "hr_team.manage", "employee.read", "employee.write"];

let fx: ReturnType<typeof seedTwoOrgs>;

function seed() {
  fx = seedTwoOrgs({
    permissions: { admin: ADMIN_KEYS, hr: HR_ADMIN_KEYS, manager: HR_ADMIN_KEYS, employee: ["employee.read"] },
  });
  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  // org_admin template, needed by onboardOrganization for the created tenant.
  state.store.roles.push({ id: 700, key: "org_admin", organizationId: null, label: "org_admin", description: null, isSystemRole: true });
  // Make Org A's HR actor its active Primary HR — proving Primary HR alone does not grant create.
  state.store.primary_hr_assignments.push({ id: 1, organizationId: ORG_A, membershipId: fx.a.hr.membershipId, revokedAt: null });
  state.unsupported.length = 0;
}
beforeEach(seed);

const createOrg = (actor: harness.Actor | null, body: Record<string, unknown> = { name: "New Tenant", slug: "new-tenant", type: "business" }) => {
  const r = request(app).post("/api/organizations");
  if (actor) r.set("Authorization", bearer(actor));
  return r.send(body);
};
const suspend = (actor: harness.Actor, org: number, slug: string) =>
  request(app).post(`/api/organizations/${org}/suspend`).set("Authorization", bearer(actor)).send({ confirmSlug: slug });

function orgCount() {
  return state.store.organizations.length;
}

describe("organisation creation is Platform Super Admin only", () => {
  it("rejects an unauthenticated caller", async () => {
    const before = orgCount();
    expect((await createOrg(null)).status).toBe(401);
    expect(orgCount()).toBe(before);
  });

  it("rejects every tenant role (employee, HR Manager, HR Administrator, Organization Admin, Primary HR)", async () => {
    const before = orgCount();
    for (const actor of [fx.a.employee, fx.a.manager, fx.a.hr, fx.a.admin]) {
      expectDenied(await createOrg(actor), [403]);
    }
    // fx.a.hr is also the active Primary HR of Org A — Primary HR alone must not create.
    expectDenied(await createOrg(fx.a.hr), [403]);
    expect(orgCount()).toBe(before); // nothing was provisioned
    expect(state.unsupported).toEqual([]);
  });

  it("allows the genuine platform super_admin, provisioning the tenant", async () => {
    const before = orgCount();
    const res = await createOrg(fx.superAdminNoGrant);
    expectAllowed(res);
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("new-tenant");
    expect(orgCount()).toBe(before + 1);
    expect(state.unsupported).toEqual([]);
  });

  it("a tenant admin cannot bypass the UI by calling the endpoint directly", async () => {
    // Same request an org_admin's browser could craft — refused at the server.
    expectDenied(await createOrg(fx.a.admin, { name: "Sneaky", slug: "sneaky-co", type: "ngo" }), [403]);
    expect(state.store.organizations.some((o) => o.slug === "sneaky-co")).toBe(false);
  });
});

describe("platform tenant lifecycle is Super Admin only", () => {
  it("a tenant Organization Admin cannot suspend its own organisation", async () => {
    expectDenied(await suspend(fx.a.admin, ORG_A, "org-a"), [403]);
    expect(state.store.organizations.find((o) => o.id === ORG_A)?.status).toBe("active");
  });

  it("a tenant admin cannot suspend another organisation", async () => {
    expectDenied(await suspend(fx.a.admin, harness.ORG_B, "org-b"), [403]);
  });

  it("the platform super_admin can suspend a tenant (typed confirmation)", async () => {
    const res = await suspend(fx.superAdminNoGrant, ORG_A, "org-a");
    expectAllowed(res);
    expect(state.store.organizations.find((o) => o.id === ORG_A)?.status).toBe("suspended");
    expect(state.unsupported).toEqual([]);
  });
});

describe("tenant self-administration is preserved", () => {
  it("a tenant Organization Admin can still read and update its own organisation", async () => {
    expectAllowed(await request(app).get(`/api/organizations/${ORG_A}`).set("Authorization", bearer(fx.a.admin)));
    const upd = await request(app)
      .patch(`/api/organizations/${ORG_A}`)
      .set("Authorization", bearer(fx.a.admin))
      .send({ industry: "Religious Organizations" });
    expectAllowed(upd);
    expect(state.unsupported).toEqual([]);
  });

  it("a tenant admin cannot update another organisation", async () => {
    expectDenied(
      await request(app).patch(`/api/organizations/${harness.ORG_B}`).set("Authorization", bearer(fx.a.admin)).send({ industry: "X" }),
      [403],
    );
  });

  it("the organisation list is scoped: a tenant user sees only their own", async () => {
    const res = await request(app).get("/api/organizations").set("Authorization", bearer(fx.a.admin));
    expectAllowed(res);
    const ids = (res.body as { id: number }[]).map((o) => o.id);
    expect(ids).toContain(ORG_A);
    expect(ids).not.toContain(harness.ORG_B);
  });
});
