/**
 * Adversarial coverage for the Primary HR Administrator delegation model
 * (lib/roleDelegation.ts + middlewares/requireDelegationAuthority.ts).
 *
 * Two authority paths reach the member/role administration routes:
 *
 *   org_admin  — the unscoped administrator holding membership.manage /
 *                role.manage (behaviour unchanged, except that the super_admin
 *                template is never assignable and platform-restricted audit
 *                keys cannot be granted by someone who does not hold them);
 *   hr_team    — the organization's ACTIVE Primary HR holding hr_team.manage,
 *                who may only delegate roles that are entirely inside their
 *                own boundary (ownership, template, subset and prohibited-key
 *                rules), and may only act on members inside that boundary.
 *
 * Every negative case is paired with a positive control on the same route so a
 * denial cannot be a broken route in disguise (see adversarialHarness.ts).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import * as harness from "./security/adversarialHarness";

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
    auditEventsTable: h.mockTable("audit_events", [
      "id",
      "organizationId",
      "eventType",
      "targetType",
      "targetId",
      "actorApplicationUserId",
      "actorMembershipId",
    ]),
  };
});

process.env.APP_BASE_URL = "https://platform.test";
const { default: app } = await import("../app");

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const EMPLOYEE_KEYS = ["organization.read", "employee.read"];
const HR_MANAGER_KEYS = ["organization.read", "employee.read", "employee.write", "migration.read"];
const HR_ADMIN_KEYS = [...HR_MANAGER_KEYS, "membership.read", "hr_team.manage"];
const ORG_ADMIN_KEYS = [
  "organization.read",
  "membership.read",
  "membership.manage",
  "role.manage",
  "organization.update",
  "module.manage",
  "primary_hr.manage",
  "employee.read",
];
const SUPER_ADMIN_KEYS = [...ORG_ADMIN_KEYS, "audit.read.security"];

// Stable role ids so tests can name them literally.
const ROLE = {
  superAdmin: 900,
  orgAdmin: 901,
  hrAdministrator: 902,
  hrManager: 903,
  employee: 904,
  aPayrollClerk: 905, // Org A custom role holding a payroll key
  aLeaveAdmin: 906, // Org A custom role reaching beyond the HR boundary
  aHrAssistant: 907, // Org A custom role entirely inside the HR boundary
  bStaff: 908, // Org B custom role — must be invisible from Org A
} as const;

let fx: ReturnType<typeof seedTwoOrgs>;
/** A user with a login but no membership anywhere — the "add existing user" target. */
const OUTSIDER_EMAIL = "outsider@fixture.test";

function permId(key: string): number {
  const found = state.store.permissions.find((p) => p.key === key);
  if (found) return found.id as number;
  const id = state.store.permissions.length + 1;
  state.store.permissions.push({ id, key });
  return id;
}

function addRole(id: number, key: string, organizationId: number | null, isSystemRole: boolean, keys: string[]) {
  state.store.roles.push({ id, key, organizationId, label: key, description: null, isSystemRole });
  for (const k of keys) state.store.role_permissions.push({ roleId: id, permissionId: permId(k) });
}

function seed() {
  fx = seedTwoOrgs({
    permissions: {
      employee: EMPLOYEE_KEYS,
      // `manager` doubles as "holds hr_team.manage but is NOT Primary HR".
      manager: HR_ADMIN_KEYS,
      hr: HR_ADMIN_KEYS,
      admin: ORG_ADMIN_KEYS,
    },
    breakGlassScope: ["organization.read", "membership.read", "membership.manage"],
  });
  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  state.store.organization_settings = [];

  addRole(ROLE.superAdmin, "super_admin", null, true, SUPER_ADMIN_KEYS);
  addRole(ROLE.orgAdmin, "org_admin", null, true, ORG_ADMIN_KEYS);
  addRole(ROLE.hrAdministrator, "hr_administrator", null, true, HR_ADMIN_KEYS);
  addRole(ROLE.hrManager, "hr_manager", null, true, HR_MANAGER_KEYS);
  addRole(ROLE.employee, "employee", null, true, EMPLOYEE_KEYS);
  addRole(ROLE.aPayrollClerk, "payroll_clerk", ORG_A, false, ["payroll.read"]);
  addRole(ROLE.aLeaveAdmin, "leave_admin", ORG_A, false, ["employee.read", "leave.approve"]);
  addRole(ROLE.aHrAssistant, "hr_assistant", ORG_A, false, ["employee.read", "employee.write"]);
  addRole(ROLE.bStaff, "b_staff", ORG_B, false, EMPLOYEE_KEYS);

  // Org A's Primary HR is `a.hr`; Org B's is `b.hr`.
  state.store.primary_hr_assignments.push(
    { id: 1, organizationId: ORG_A, membershipId: fx.a.hr.membershipId, revokedAt: null },
    { id: 2, organizationId: ORG_B, membershipId: fx.b.hr.membershipId, revokedAt: null },
  );

  state.store.users.push({
    id: 500,
    email: OUTSIDER_EMAIL,
    role: "user",
    organizationId: null,
    disabledAt: null,
    firstName: "Out",
    lastName: "Sider",
  });
  state.unsupported.length = 0;
}

beforeEach(seed);

const assignRole = (actor: harness.Actor, membershipId: number, roleId: number) =>
  request(app)
    .post(`/api/organizations/${ORG_A}/members/${membershipId}/roles`)
    .set("Authorization", bearer(actor))
    .send({ roleId });

const revokeRole = (actor: harness.Actor, membershipId: number, roleId: number) =>
  request(app)
    .delete(`/api/organizations/${ORG_A}/members/${membershipId}/roles/${roleId}`)
    .set("Authorization", bearer(actor));

const revokeMember = (actor: harness.Actor, membershipId: number) =>
  request(app)
    .delete(`/api/organizations/${ORG_A}/members/${membershipId}`)
    .set("Authorization", bearer(actor));

const invite = (actor: harness.Actor, email: string, roleId?: number) =>
  request(app)
    .post(`/api/organizations/${ORG_A}/invitations`)
    .set("Authorization", bearer(actor))
    .send(roleId === undefined ? { email } : { email, roleId });

const copyTemplate = (actor: harness.Actor, templateRoleId: number, key: string) =>
  request(app)
    .post(`/api/organizations/${ORG_A}/roles`)
    .set("Authorization", bearer(actor))
    .send({ templateRoleId, key, label: key });

const grantPermission = (actor: harness.Actor, roleId: number, key: string) =>
  request(app)
    .post(`/api/organizations/${ORG_A}/roles/${roleId}/permissions`)
    .set("Authorization", bearer(actor))
    .send({ permissionId: permId(key) });

const listRoles = (actor: harness.Actor) =>
  request(app).get(`/api/organizations/${ORG_A}/roles`).set("Authorization", bearer(actor));

/** The roleId the seeded actor's own fixture role got (membership_roles row). */
function ownRoleId(actor: harness.Actor): number {
  const row = state.store.membership_roles.find((r) => r.membershipId === actor.membershipId);
  return row!.roleId as number;
}

// ---------------------------------------------------------------------------
// Who may enter the routes at all
// ---------------------------------------------------------------------------

describe("delegation authority gate", () => {
  it("positive control: org_admin still assigns any organization role", async () => {
    expectAllowed(await assignRole(fx.a.admin, fx.a.employee.membershipId!, ROLE.hrManager));
    expectAllowed(await assignRole(fx.a.admin, fx.a.employee.membershipId!, ROLE.aPayrollClerk));
    expect(state.unsupported).toEqual([]);
  });

  it("positive control: the active Primary HR holding hr_team.manage assigns a narrow HR role", async () => {
    const res = await assignRole(fx.a.hr, fx.a.employee.membershipId!, ROLE.hrManager);
    expectAllowed(res);
    expect(state.store.membership_roles).toContainEqual(expect.objectContaining({ membershipId: fx.a.employee.membershipId, roleId: ROLE.hrManager }));
    const audit = state.store.audit_events.find((e) => e.eventType === "membership.role_assigned");
    expect(audit).toMatchObject({ organizationId: ORG_A, actorMembershipId: fx.a.hr.membershipId });
    expect((audit as { metadata?: Record<string, unknown> }).metadata).toMatchObject({ delegationMode: "hr_team", roleKey: "hr_manager" });
    expect(state.unsupported).toEqual([]);
  });

  it("denies hr_team.manage holders who are NOT the active Primary HR", async () => {
    const res = await assignRole(fx.a.manager, fx.a.employee.membershipId!, ROLE.employee);
    expectDenied(res, [403]);
    expect(state.store.membership_roles).not.toContainEqual(expect.objectContaining({ membershipId: fx.a.employee.membershipId, roleId: ROLE.employee }));
  });

  it("denies a Primary HR whose designation has been revoked", async () => {
    state.store.primary_hr_assignments[0].revokedAt = new Date();
    expectDenied(await assignRole(fx.a.hr, fx.a.employee.membershipId!, ROLE.employee), [403]);
  });

  it("denies a Primary HR who no longer holds hr_team.manage", async () => {
    state.store.role_permissions = state.store.role_permissions.filter(
      (rp) => !(rp.roleId === ownRoleId(fx.a.hr) && rp.permissionId === permId("hr_team.manage")),
    );
    expectDenied(await assignRole(fx.a.hr, fx.a.employee.membershipId!, ROLE.employee), [403]);
  });

  it("denies ordinary members and Org B's Primary HR", async () => {
    expectDenied(await assignRole(fx.a.employee, fx.a.employee.membershipId!, ROLE.employee), [403]);
    expectDenied(await assignRole(fx.b.hr, fx.a.employee.membershipId!, ROLE.employee));
    expectDenied(await invite(fx.a.employee, "x@fixture.test"), [403]);
    expectDenied(await copyTemplate(fx.a.employee, ROLE.employee, "nope"), [403]);
  });
});

// ---------------------------------------------------------------------------
// Assign / revoke roles
// ---------------------------------------------------------------------------

describe("role assignment through the HR-team path", () => {
  const target = () => fx.a.employee.membershipId!;

  it("denies the org_admin template (prohibited keys)", async () => {
    expectDenied(await assignRole(fx.a.hr, target(), ROLE.orgAdmin), [403]);
  });

  it("denies the super_admin template to Primary HR AND org_admin", async () => {
    expectDenied(await assignRole(fx.a.hr, target(), ROLE.superAdmin), [403]);
    expectDenied(await assignRole(fx.a.admin, target(), ROLE.superAdmin), [403]);
    expect(state.store.membership_roles).not.toContainEqual(expect.objectContaining({ membershipId: target(), roleId: ROLE.superAdmin }));
  });

  it("denies a role containing any payroll key", async () => {
    expectDenied(await assignRole(fx.a.hr, target(), ROLE.aPayrollClerk), [403]);
  });

  it("denies a role reaching beyond what the Primary HR holds (subset rule)", async () => {
    expectDenied(await assignRole(fx.a.hr, target(), ROLE.aLeaveAdmin), [403]);
  });

  it("treats another organization's role as nonexistent, for both paths", async () => {
    expectDenied(await assignRole(fx.a.hr, target(), ROLE.bStaff), [404]);
    expectDenied(await assignRole(fx.a.admin, target(), ROLE.bStaff), [404]);
    expect(state.store.membership_roles).not.toContainEqual(expect.objectContaining({ membershipId: target(), roleId: ROLE.bStaff }));
  });

  it("allows an organization-owned role entirely inside the boundary, and the hr_administrator template", async () => {
    expectAllowed(await assignRole(fx.a.hr, target(), ROLE.aHrAssistant));
    expectAllowed(await assignRole(fx.a.hr, target(), ROLE.hrAdministrator));
    expect(state.unsupported).toEqual([]);
  });

  it("cannot strip authority from an org_admin (scope rule), while org_admin can revoke from anyone", async () => {
    const adminRoleId = ownRoleId(fx.a.admin);
    // The admin's fixture role carries prohibited keys, so it is not delegable either way.
    expectDenied(await revokeRole(fx.a.hr, fx.a.admin.membershipId!, adminRoleId), [403]);
    expect(state.store.membership_roles).toContainEqual(expect.objectContaining({ membershipId: fx.a.admin.membershipId, roleId: adminRoleId }));

    expectAllowed(await revokeRole(fx.a.admin, fx.a.hr.membershipId!, ownRoleId(fx.a.hr)));
  });

  it("cannot revoke a delegable role from a member who also holds out-of-boundary authority", async () => {
    // Give the admin an employee role too; the HR path still may not touch that member.
    state.store.membership_roles.push({ membershipId: fx.a.admin.membershipId, roleId: ROLE.employee });
    expectDenied(await revokeRole(fx.a.hr, fx.a.admin.membershipId!, ROLE.employee), [403]);
    // Positive control: the same operation on an in-boundary member succeeds.
    state.store.membership_roles.push({ membershipId: fx.a.employee.membershipId, roleId: ROLE.employee });
    expectAllowed(await revokeRole(fx.a.hr, fx.a.employee.membershipId!, ROLE.employee));
  });
});

// ---------------------------------------------------------------------------
// Membership add / revoke / invite
// ---------------------------------------------------------------------------

describe("membership changes through the HR-team path", () => {
  it("revokes an in-boundary member but never an org_admin", async () => {
    expectDenied(await revokeMember(fx.a.hr, fx.a.admin.membershipId!), [403]);
    expect(state.store.organization_memberships.find((m) => m.id === fx.a.admin.membershipId)?.status).toBe("active");

    expectAllowed(await revokeMember(fx.a.hr, fx.a.employee.membershipId!));
    const audit = state.store.audit_events.find((e) => e.eventType === "membership.revoked");
    expect((audit as { metadata?: Record<string, unknown> }).metadata).toMatchObject({ delegationMode: "hr_team" });
    expect(state.unsupported).toEqual([]);
  });

  it("adds an existing user by email (positive control) and records the delegation mode", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_A}/members`)
      .set("Authorization", bearer(fx.a.hr))
      .send({ email: OUTSIDER_EMAIL });
    expectAllowed(res);
    const audit = state.store.audit_events.find((e) => e.eventType === "membership.added");
    expect((audit as { metadata?: Record<string, unknown> }).metadata).toMatchObject({ delegationMode: "hr_team" });
    expect(state.unsupported).toEqual([]);
  });

  it("invitation: the initial role obeys the same rules as a direct assignment", async () => {
    expectDenied(await invite(fx.a.hr, "one@fixture.test", ROLE.orgAdmin), [403]);
    expectDenied(await invite(fx.a.hr, "two@fixture.test", ROLE.superAdmin), [403]);
    expectDenied(await invite(fx.a.admin, "two@fixture.test", ROLE.superAdmin), [403]);
    expectDenied(await invite(fx.a.hr, "three@fixture.test", ROLE.aPayrollClerk), [403]);
    expectDenied(await invite(fx.a.hr, "four@fixture.test", ROLE.bStaff), [404]);
    // Nothing above created a login or membership.
    expect(state.store.users.some((u) => String(u.email).endsWith("@fixture.test") && /^(one|two|three|four)@/.test(String(u.email)))).toBe(false);

    const ok = await invite(fx.a.hr, "five@fixture.test", ROLE.hrManager);
    expectAllowed(ok);
    expect(ok.status).toBe(201);
    expect(typeof ok.body.inviteToken).toBe("string");
    expect(ok.body.inviteToken.length).toBeGreaterThan(16);
    const audit = state.store.audit_events.find((e) => e.eventType === "membership.invited");
    expect((audit as { metadata?: Record<string, unknown> }).metadata).toMatchObject({ delegationMode: "hr_team", roleKey: "hr_manager" });
    expect(state.unsupported).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Role management (templates + permission grants)
// ---------------------------------------------------------------------------

describe("role management through the HR-team path", () => {
  it("copies only templates inside the boundary; never org_admin or super_admin", async () => {
    expectDenied(await copyTemplate(fx.a.hr, ROLE.orgAdmin, "my_admins"), [403]);
    expectDenied(await copyTemplate(fx.a.hr, ROLE.superAdmin, "my_supers"), [403]);
    expectDenied(await copyTemplate(fx.a.admin, ROLE.superAdmin, "my_supers"), [403]);
    // An organization-owned role is not a template, and Org B's role does not exist here.
    expectDenied(await copyTemplate(fx.a.hr, ROLE.aHrAssistant, "copy_of_custom"), [404]);
    expectDenied(await copyTemplate(fx.a.hr, ROLE.bStaff, "copy_of_b"), [404]);
    expect(state.store.roles.some((r) => ["my_admins", "my_supers", "copy_of_custom", "copy_of_b"].includes(String(r.key)))).toBe(false);

    const ok = await copyTemplate(fx.a.hr, ROLE.hrManager, "hr_officers");
    expectAllowed(ok);
    expect(ok.status).toBe(201);
    const created = state.store.roles.find((r) => r.key === "hr_officers");
    expect(created).toMatchObject({ organizationId: ORG_A, isSystemRole: false });
    expect(state.unsupported).toEqual([]);
  });

  it("grant rule: the HR team cannot place a prohibited or un-held key on a role", async () => {
    expectDenied(await grantPermission(fx.a.hr, ROLE.aHrAssistant, "membership.manage"), [403]);
    expectDenied(await grantPermission(fx.a.hr, ROLE.aHrAssistant, "role.manage"), [403]);
    expectDenied(await grantPermission(fx.a.hr, ROLE.aHrAssistant, "primary_hr.manage"), [403]);
    expectDenied(await grantPermission(fx.a.hr, ROLE.aHrAssistant, "payroll.read"), [403]);
    expectDenied(await grantPermission(fx.a.hr, ROLE.aHrAssistant, "leave.approve"), [403]);
    expect(
      state.store.role_permissions.filter((rp) => rp.roleId === ROLE.aHrAssistant).map((rp) => rp.permissionId).sort(),
    ).toEqual([permId("employee.read"), permId("employee.write")].sort());

    // Positive control: a held, in-boundary key.
    const ok = await grantPermission(fx.a.hr, ROLE.aHrAssistant, "membership.read");
    expectAllowed(ok);
    expect(ok.status).toBe(204);
    expect(state.store.role_permissions).toContainEqual(expect.objectContaining({ roleId: ROLE.aHrAssistant, permissionId: permId("membership.read") }));
    expect(state.unsupported).toEqual([]);
  });

  it("the HR team cannot edit a role that already reaches outside its boundary", async () => {
    expectDenied(await grantPermission(fx.a.hr, ROLE.aLeaveAdmin, "employee.write"), [403]);
    expectDenied(await grantPermission(fx.a.hr, ROLE.aPayrollClerk, "employee.read"), [403]);
    expectDenied(
      await request(app)
        .delete(`/api/organizations/${ORG_A}/roles/${ROLE.aLeaveAdmin}/permissions/${permId("leave.approve")}`)
        .set("Authorization", bearer(fx.a.hr)),
      [403],
    );
    expect(state.store.role_permissions).toContainEqual(expect.objectContaining({ roleId: ROLE.aLeaveAdmin, permissionId: permId("leave.approve") }));
  });

  it("org_admin keeps its grant authority, except for platform-restricted keys it does not hold", async () => {
    const ok = await grantPermission(fx.a.admin, ROLE.aHrAssistant, "membership.manage");
    expectAllowed(ok);
    expectDenied(await grantPermission(fx.a.admin, ROLE.aHrAssistant, "audit.read.security"), [403]);
    expectDenied(await grantPermission(fx.a.admin, ROLE.aHrAssistant, "audit.read.platform_configuration"), [403]);
    expect(state.store.role_permissions).not.toContainEqual(expect.objectContaining({ roleId: ROLE.aHrAssistant, permissionId: permId("audit.read.security") }));
    expect(state.unsupported).toEqual([]);
  });

  it("no path can grant permissions to a system template (protected)", async () => {
    const res = await grantPermission(fx.a.admin, ROLE.employee, "employee.write");
    expect(res.status).toBe(400);
    expectDenied(await grantPermission(fx.a.hr, ROLE.employee, "employee.write"), [400, 403]);
    expect(state.store.role_permissions.filter((rp) => rp.roleId === ROLE.employee)).toHaveLength(EMPLOYEE_KEYS.length);
  });
});

// ---------------------------------------------------------------------------
// The server's own `delegable` answer for the UI
// ---------------------------------------------------------------------------

describe("GET /organizations/:id/roles delegable flag", () => {
  it("reflects the Primary HR's boundary and hides other tenants' roles", async () => {
    const res = await listRoles(fx.a.hr);
    expectAllowed(res);
    const byKey = new Map((res.body as { key: string; delegable: boolean; organizationId: number | null }[]).map((r) => [r.key, r]));
    expect(byKey.has("b_staff")).toBe(false);
    expect(byKey.get("employee")?.delegable).toBe(true);
    expect(byKey.get("hr_manager")?.delegable).toBe(true);
    expect(byKey.get("hr_assistant")?.delegable).toBe(true);
    expect(byKey.get("org_admin")?.delegable).toBe(false);
    expect(byKey.get("super_admin")?.delegable).toBe(false);
    expect(byKey.get("payroll_clerk")?.delegable).toBe(false);
    expect(byKey.get("leave_admin")?.delegable).toBe(false);
    expect(state.unsupported).toEqual([]);
  });

  it("org_admin sees everything delegable except the super_admin template", async () => {
    const res = await listRoles(fx.a.admin);
    expectAllowed(res);
    const byKey = new Map((res.body as { key: string; delegable: boolean }[]).map((r) => [r.key, r.delegable]));
    expect(byKey.get("org_admin")).toBe(true);
    expect(byKey.get("payroll_clerk")).toBe(true);
    expect(byKey.get("super_admin")).toBe(false);
  });

  it("a member without either authority sees nothing delegable, and the non-primary hr_team.manage holder likewise", async () => {
    for (const actor of [fx.a.employee, fx.a.manager]) {
      const res = await listRoles(actor);
      expectAllowed(res);
      expect((res.body as { delegable: boolean }[]).every((r) => r.delegable === false)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Break-glass keeps its existing shape, minus the super_admin template
// ---------------------------------------------------------------------------

describe("break-glass super admin", () => {
  it("acts on the org_admin path within its scope but cannot assign the super_admin template", async () => {
    expectAllowed(await assignRole(fx.superAdminWithBreakGlass, fx.a.employee.membershipId!, ROLE.hrManager));
    expectDenied(await assignRole(fx.superAdminWithBreakGlass, fx.a.employee.membershipId!, ROLE.superAdmin), [403]);
    expectDenied(await assignRole(fx.superAdminNoGrant, fx.a.employee.membershipId!, ROLE.employee));
    expectDenied(await assignRole(fx.superAdminWrongOrgBreakGlass, fx.a.employee.membershipId!, ROLE.employee));
    expect(state.unsupported).toEqual([]);
  });
});
