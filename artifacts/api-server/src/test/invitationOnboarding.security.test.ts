/**
 * Adversarial coverage for the invitation / tenant-onboarding safety fix.
 *
 * Reproduces and locks the three defects the WWM Gmail test exposed:
 *   1. an Admin Console mutation must target the organization in the request
 *      PATH, authorized server-side — never a session/user default (the incident
 *      put an invitation into org #1 while the admin believed they were in WWM);
 *   2. revoking an invitation destroys its token, and re-inviting mints a NEW
 *      one (the old link stayed valid and was shown as fresh);
 *   3. the invitation URL and branding come from the INVITED organization's
 *      governed configuration, never from request headers.
 *
 * Real HTTP through the app; @workspace/db is the in-memory adversarial engine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import * as harness from "./security/adversarialHarness";

const { ORG_A, ORG_B, seedTwoOrgs, bearer, expectDenied, expectAllowed } = harness;

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
    organizationSettingsTable: h.mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    auditEventsTable: h.mockTable("audit_events", ["id", "organizationId", "eventType", "targetType", "targetId", "actorApplicationUserId", "actorMembershipId", "metadata", "afterState", "beforeState", "occurredAt", "category", "outcome"]),
  };
});

process.env.APP_BASE_URL = "https://platform.test";
// Pin production tenant-resolution semantics: X-Tenant-Hostname and
// X-Forwarded-Host are ignored (only the edge-set raw Host is trusted).
process.env.NODE_ENV = "production";
delete process.env.ALLOW_TENANT_HOSTNAME_HEADER;
const { default: app } = await import("../app");

const ADMIN_KEYS = ["organization.read", "membership.read", "membership.manage", "role.manage", "employee.read"];
const ROLE = { employee: 810, hrManager: 811 } as const;

let fx: ReturnType<typeof seedTwoOrgs>;

function addRole(id: number, key: string, keys: string[]) {
  state.store.roles.push({ id, key, organizationId: null, label: key, description: null, isSystemRole: true });
  for (const k of keys) {
    let p = state.store.permissions.find((x) => x.key === k);
    if (!p) { p = { id: state.store.permissions.length + 1, key: k }; state.store.permissions.push(p); }
    state.store.role_permissions.push({ roleId: id, permissionId: p.id });
  }
}

function seed(domains: { a?: { host: string; primary?: boolean }[]; b?: { host: string; primary?: boolean }[] } = {}) {
  fx = seedTwoOrgs({ permissions: { admin: ADMIN_KEYS, hr: ADMIN_KEYS, manager: [], employee: [] } });
  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  state.store.organization_settings = [];
  addRole(ROLE.employee, "employee", ["employee.read"]);
  addRole(ROLE.hrManager, "hr", ["employee.read", "employee.write", "organization.read"]);
  let did = 1;
  const aDomains = domains.a ?? [{ host: "a.hrms.test", primary: true }];
  for (const d of aDomains) state.store.organization_domains.push({ id: did++, organizationId: ORG_A, hostname: d.host, status: "active", isPrimary: !!d.primary, domainType: "custom_domain" });
  for (const d of domains.b ?? [{ host: "b.hrms.test", primary: true }]) state.store.organization_domains.push({ id: did++, organizationId: ORG_B, hostname: d.host, status: "active", isPrimary: !!d.primary, domainType: "custom_domain" });
  state.unsupported.length = 0;
}
beforeEach(() => seed());

const invite = (actor: harness.Actor, org: number, email: string, roleId?: number, headers: Record<string, string> = {}) => {
  let r = request(app).post(`/api/organizations/${org}/invitations`).set("Authorization", bearer(actor));
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(roleId === undefined ? { email } : { email, roleId });
};
const preview = (token: string, headers: Record<string, string> = {}) => {
  let r = request(app).get(`/api/invitations/${token}`);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r;
};
const accept = (token: string) =>
  request(app).post(`/api/invitations/${token}/accept`).send({ firstName: "Jo", lastName: "Vee", password: "correct-horse-battery-staple" });
const revoke = (actor: harness.Actor, org: number, membershipId: number) =>
  request(app).delete(`/api/organizations/${org}/members/${membershipId}`).set("Authorization", bearer(actor));

function membershipByEmail(email: string) {
  const u = state.store.users.find((x) => x.email === email);
  if (!u) return undefined;
  return state.store.organization_memberships.find((m) => m.applicationUserId === u.id);
}
function auditOf(type: string) {
  return state.store.audit_events.filter((e) => e.eventType === type);
}

describe("organization context is the authoritative path org", () => {
  it("an invitation created on org A's path belongs to org A, regardless of spoofed headers", async () => {
    // Forwarded headers are the caller-controlled spoof vector (WS-18); the
    // raw Host is set by the edge. Neither changes the path org.
    const res = await invite(fx.a.admin, ORG_A, "newhire@x.test", ROLE.hrManager, {
      "X-Forwarded-Host": "b.hrms.test",
      "X-Tenant-Hostname": "b.hrms.test",
      "X-Forwarded-For": "203.0.113.9",
    });
    expectAllowed(res);
    expect(res.body.organizationId).toBe(ORG_A);
    expect(membershipByEmail("newhire@x.test")?.organizationId).toBe(ORG_A);
    expect(state.unsupported).toEqual([]);
  });

  it("an actor authorized only for org A cannot invite into org B (no membership fallback)", async () => {
    expectDenied(await invite(fx.a.admin, ORG_B, "x@x.test", ROLE.employee));
    expect(membershipByEmail("x@x.test")).toBeUndefined();
  });

  it("a request whose Host resolves to another tenant cannot mutate this org (WS-18 mismatch)", async () => {
    // Even the edge-set Host cannot cross tenants: a request on org B's host
    // targeting org A's path is rejected before any write.
    expectDenied(await invite(fx.a.admin, ORG_A, "cross@x.test", ROLE.employee, { Host: "b.hrms.test" }));
    expect(membershipByEmail("cross@x.test")).toBeUndefined();
  });

  it("incident reproduction: WWM-authorized admin inviting on WWM's path never lands in another org", async () => {
    // Two orgs stand in for WWM (#3) and System Administration (#1). Whatever
    // the caller's default/legacy org, the created membership is the PATH org.
    const res = await invite(fx.a.admin, ORG_A, "gloria.test@x.test", ROLE.hrManager);
    expectAllowed(res);
    expect(res.body.organizationId).toBe(ORG_A);
    expect(state.store.organization_memberships.some((m) => m.applicationUserId === state.store.users.find((u) => u.email === "gloria.test@x.test")?.id && m.organizationId === ORG_B)).toBe(false);
  });
});

describe("server-built invitation URL from governed domains", () => {
  it("uses the organization's primary active domain", async () => {
    const res = await invite(fx.a.admin, ORG_A, "p@x.test", ROLE.employee);
    expectAllowed(res);
    expect(res.body.inviteUrl).toBe(`https://a.hrms.test/invite/${res.body.inviteToken}`);
    expect(res.body.inviteUrlSource).toBe("primary_domain");
  });

  it("uses the single active domain when none is primary", async () => {
    seed({ a: [{ host: "solo.hrms.test" }] });
    const res = await invite(fx.a.admin, ORG_A, "s@x.test", ROLE.employee);
    expectAllowed(res);
    expect(res.body.inviteUrl).toBe(`https://solo.hrms.test/invite/${res.body.inviteToken}`);
    expect(res.body.inviteUrlSource).toBe("single_active_domain");
  });

  it("falls back to APP_BASE_URL (flagged ambiguous) when multiple active domains have no primary", async () => {
    seed({ a: [{ host: "one.hrms.test" }, { host: "two.hrms.test" }] });
    const res = await invite(fx.a.admin, ORG_A, "m@x.test", ROLE.employee);
    expectAllowed(res);
    expect(res.body.inviteUrl).toBe(`https://platform.test/invite/${res.body.inviteToken}`);
    expect(res.body.inviteUrlSource).toBe("app_base_url_ambiguous_domains");
  });

  it("the invite URL is unaffected by Host / X-Forwarded-Host / X-Tenant-Hostname", async () => {
    // The invite URL is derived from org A domains; forwarded headers are
    // ignored, and a matching real Host does not change it either.
    const res = await invite(fx.a.admin, ORG_A, "h@x.test", ROLE.employee, {
      Host: "a.hrms.test",
      "X-Forwarded-Host": "attacker.test",
      "X-Tenant-Hostname": "b.hrms.test",
    });
    expectAllowed(res);
    expect(res.body.inviteUrl).toBe(`https://a.hrms.test/invite/${res.body.inviteToken}`);
    expect(res.body.inviteUrl).not.toContain("attacker.test");
    expect(res.body.inviteUrl).not.toContain("b.hrms.test");
  });
});

describe("revoke destroys the token; re-invite mints a new one", () => {
  it("full lifecycle: invite, accept works once, replay rejected", async () => {
    const res = await invite(fx.a.admin, ORG_A, "life@x.test", ROLE.employee);
    expectAllowed(res);
    const token = res.body.inviteToken as string;
    expect((await preview(token)).body.status).toBe("pending");
    expectAllowed(await accept(token));
    // Token cleared on accept -> preview no longer finds it, replay rejected.
    expect((await preview(token)).status).toBe(404);
    expect((await accept(token)).status).toBe(404);
  });

  it("revoke clears the token and expiry; the old link previews revoked and cannot be accepted", async () => {
    const first = await invite(fx.a.admin, ORG_A, "rev@x.test", ROLE.hrManager);
    expectAllowed(first);
    const oldToken = first.body.inviteToken as string;
    const membershipId = first.body.membershipId as number;

    expectAllowed(await revoke(fx.a.admin, ORG_A, membershipId));
    const row = state.store.organization_memberships.find((m) => m.id === membershipId)!;
    expect(row.status).toBe("revoked");
    expect(row.inviteToken).toBeNull();
    expect(row.inviteTokenExpiresAt).toBeNull();

    expect((await preview(oldToken)).status).toBe(404); // token no longer resolves at all
    expect((await accept(oldToken)).status).toBe(404);
  });

  it("re-invite reuses the row, mints a NEW token, replaces the role, and audits membership.reinvited", async () => {
    const first = await invite(fx.a.admin, ORG_A, "reinv@x.test", ROLE.hrManager);
    const oldToken = first.body.inviteToken as string;
    const membershipId = first.body.membershipId as number;
    await revoke(fx.a.admin, ORG_A, membershipId);

    const second = await invite(fx.a.admin, ORG_A, "reinv@x.test", ROLE.employee);
    expectAllowed(second);
    expect(second.body.reinvited).toBe(true);
    expect(second.body.membershipId).toBe(membershipId); // same row (unique on user+org)
    const newToken = second.body.inviteToken as string;
    expect(newToken).not.toBe(oldToken);

    // Old token dead, new token accepts.
    expect((await preview(oldToken)).status).toBe(404);
    expect((await preview(newToken)).body.status).toBe("pending");
    // Role replaced: employee now, not hr_manager.
    const roleIds = state.store.membership_roles.filter((r) => r.membershipId === membershipId).map((r) => r.roleId);
    expect(roleIds).toEqual([ROLE.employee]);
    expect(auditOf("membership.reinvited")).toHaveLength(1);
    expect((auditOf("membership.reinvited")[0] as { metadata?: Record<string, unknown> }).metadata).toMatchObject({ roleKey: "employee", previousStatus: "revoked" });
    expectAllowed(await accept(newToken));
  });

  it("re-invite refuses an active membership (409)", async () => {
    const first = await invite(fx.a.admin, ORG_A, "active@x.test", ROLE.employee);
    await accept(first.body.inviteToken);
    const res = await invite(fx.a.admin, ORG_A, "active@x.test", ROLE.employee);
    expect(res.status).toBe(409);
  });
});

describe("invitation-scoped branding", () => {
  it("preview returns the invited organization's branding, independent of request host", async () => {
    const res = await invite(fx.a.admin, ORG_A, "brand@x.test", ROLE.employee);
    const token = res.body.inviteToken as string;
    const p = await preview(token, { Host: "b.hrms.test", "X-Forwarded-Host": "b.hrms.test" });
    expect(p.status).toBe(200);
    expect(p.body.organization).not.toBeNull();
    expect(p.body.organization.organizationName).toBe("Org A");
    expect(p.body.organizationName).toBe("Org A");
  });
});

describe("delegation guards still apply to invitations", () => {
  it("an ordinary member cannot invite", async () => {
    expectDenied(await invite(fx.a.employee, ORG_A, "nope@x.test", ROLE.employee));
  });
  it("unauthenticated is rejected", async () => {
    expect((await request(app).post(`/api/organizations/${ORG_A}/invitations`).send({ email: "z@x.test" })).status).toBe(401);
  });
});
