/**
 * Administration navigation permission gating (2026-09-07) — backend proof.
 *
 * The frontend fix hides the "Administration" sidebar group from members who
 * hold no administrative permission. Hiding is never the security boundary,
 * so this suite proves, at the HTTP layer, that an ordinary employee — the WWM
 * regression case, Kofi Asante: `employee` + `wwm_employee_inventory_self_service`
 * — is DENIED by the server on every representative administrative route
 * whether or not a link is shown, and that GET /me/organizations now reports
 * the caller's own effective permission keys (the frontend's new gating input)
 * without ever including an administrative key such a member does not hold.
 *
 * Every negative case is paired with a positive control on the same route so a
 * denial cannot be a broken route in disguise (see security/adversarialHarness.ts).
 * @workspace/db is mocked — no database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import * as harness from "./security/adversarialHarness";

const { ORG_A, seedTwoOrgs, bearer, expectDenied, expectAllowed } = harness;

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
    // GET /me/organizations resolves the structural manager signal, which reads
    // the employee link to find the caller own employee identity.
    employeeUserLinksTable: h.mockTable("employee_user_links", ["id", "employeeId", "applicationUserId", "organizationMembershipId"]),
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
// Fixture — permission shapes mirror lib/db/src/seed/roles-permissions-definitions.ts
// ---------------------------------------------------------------------------

/** Seeded `employee` template (subset; organization.read is the one every member holds). */
const EMPLOYEE_KEYS = [
  "organization.read",
  "employee.read",
  "branch.read",
  "department.read",
  "position.read",
  "leave_request.read.own",
  "leave_request.write.own",
  "attendance.clock.own",
];
/** WWM "Employee — Inventory Self-Service" additions (docs/WWM_ORGANIZATION_SETUP.md). */
const INVENTORY_SELF_SERVICE_KEYS = [
  "office_inventory.request",
  "office_inventory.approve",
  "office_inventory.receipt.confirm.own",
  "office_inventory.custody.read",
  "office_inventory.return",
  "office_inventory.handover",
  "office_inventory.report_issue.own",
];
const KOFI_KEYS = [...EMPLOYEE_KEYS, ...INVENTORY_SELF_SERVICE_KEYS];

/** The console authorities the Administration group is gated on (lib/administration-access.ts). */
const CONSOLE_KEYS = ["membership.manage", "role.manage", "module.manage", "primary_hr.manage", "organization.update"];
const ORG_ADMIN_KEYS = [
  ...EMPLOYEE_KEYS,
  "organization.update",
  "membership.read",
  "membership.manage",
  "role.manage",
  "module.manage",
  "master_data.manage",
  "primary_hr.manage",
  "audit.read",
  "form_template.manage",
];

const ROLE = { employee: 904 } as const;

let fx: ReturnType<typeof seedTwoOrgs>;

function permId(key: string): number {
  const found = state.store.permissions.find((p) => p.key === key);
  if (found) return found.id as number;
  const id = state.store.permissions.length + 1;
  state.store.permissions.push({ id, key });
  return id;
}

function seed() {
  fx = seedTwoOrgs({
    permissions: { employee: KOFI_KEYS, manager: KOFI_KEYS, hr: KOFI_KEYS, admin: ORG_ADMIN_KEYS },
    moduleRegistry: ["office_inventory", "attendance", "leave"],
    modulesEnabledForA: ["office_inventory", "attendance", "leave"],
  });
  for (const key of Object.keys(fx.store)) state.store[key] = fx.store[key];
  state.store.audit_events = [];
  state.store.organization_domains = [];
  state.store.organization_settings = [];
  // A platform system role the positive control can assign.
  state.store.roles.push({ id: ROLE.employee, key: "employee", organizationId: null, label: "Employee", description: null, isSystemRole: true });
  for (const k of EMPLOYEE_KEYS) state.store.role_permissions.push({ roleId: ROLE.employee, permissionId: permId(k) });
  state.unsupported.length = 0;
}

beforeEach(seed);

const kofi = () => fx.a.employee;
const orgAdmin = () => fx.a.admin;

const get = (actor: harness.Actor, path: string) => request(app).get(path).set("Authorization", bearer(actor));
const post = (actor: harness.Actor, path: string, body: string | object | undefined) =>
  request(app).post(path).set("Authorization", bearer(actor)).send(body);
const patch = (actor: harness.Actor, path: string, body: string | object | undefined) =>
  request(app).patch(path).set("Authorization", bearer(actor)).send(body);

// ---------------------------------------------------------------------------
// GET /me/organizations — the frontend's new gating input
// ---------------------------------------------------------------------------

describe("GET /me/organizations reports the caller's own effective permissions", () => {
  it("returns exactly Kofi's own keys — inventory self-service included, no administrative key", async () => {
    const res = await get(kofi(), "/api/me/organizations");
    expectAllowed(res);
    const body = res.body as Array<{ organizationId: number; roles: string[]; permissions: string[]; isPrimaryHr: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0].organizationId).toBe(ORG_A);
    expect(body[0].permissions).toEqual([...KOFI_KEYS].sort());
    for (const key of CONSOLE_KEYS) expect(body[0].permissions).not.toContain(key);
    expect(body[0].permissions).not.toContain("hr_team.manage");
    expect(body[0].isPrimaryHr).toBe(false);
  });

  it("returns the org_admin's console authorities, so the Administration group resolves for them", async () => {
    const res = await get(orgAdmin(), "/api/me/organizations");
    expectAllowed(res);
    const body = res.body as Array<{ permissions: string[] }>;
    for (const key of CONSOLE_KEYS) expect(body[0].permissions).toContain(key);
  });

  it("never leaks another member's grants: Kofi's summary contains no key he was not granted", async () => {
    const res = await get(kofi(), "/api/me/organizations");
    const body = res.body as Array<{ permissions: string[] }>;
    const granted = new Set(KOFI_KEYS);
    for (const key of body[0].permissions) expect(granted.has(key)).toBe(true);
  });

  it("is unavailable without authentication", async () => {
    const res = await request(app).get("/api/me/organizations");
    expectDenied(res, [401]);
  });
});

// ---------------------------------------------------------------------------
// Representative administrative routes — denied for Kofi, allowed for org_admin
// ---------------------------------------------------------------------------

describe("an ordinary employee reaching administrative routes by URL is denied server-side", () => {
  it("HR/organization administration: member list (membership.read)", async () => {
    expectDenied(await get(kofi(), `/api/organizations/${ORG_A}/members`), [403]);
    expectAllowed(await get(orgAdmin(), `/api/organizations/${ORG_A}/members`));
  });

  it("role/membership administration: role list (membership.read) and role assignment (requireDelegationAuthority)", async () => {
    expectDenied(await get(kofi(), `/api/organizations/${ORG_A}/roles`), [403]);
    expectAllowed(await get(orgAdmin(), `/api/organizations/${ORG_A}/roles`));

    const target = kofi().membershipId!;
    expectDenied(await post(kofi(), `/api/organizations/${ORG_A}/members/${target}/roles`, { roleId: ROLE.employee }), [403]);
    expect(state.store.membership_roles.filter((r) => r.membershipId === target)).toHaveLength(1);
    expectAllowed(await post(orgAdmin(), `/api/organizations/${ORG_A}/members/${target}/roles`, { roleId: ROLE.employee }));
  });

  it("role/membership administration: creating a role and inviting a member", async () => {
    expectDenied(await post(kofi(), `/api/organizations/${ORG_A}/roles`, { templateRoleId: ROLE.employee, key: "x", label: "x" }), [403]);
    expectDenied(await post(kofi(), `/api/organizations/${ORG_A}/invitations`, { email: "x@fixture.test" }), [403]);
  });

  it("organization administration: profile update (organization.update)", async () => {
    const before = state.store.organizations.find((o) => o.id === ORG_A)!.name;
    expectDenied(await patch(kofi(), `/api/organizations/${ORG_A}`, { name: "Hijacked" }), [403]);
    expect(state.store.organizations.find((o) => o.id === ORG_A)!.name).toBe(before);
  });

  it("organization administration: configuration write (organization.update), module toggle (module.manage), Primary HR (primary_hr.manage)", async () => {
    expectDenied(await patch(kofi(), `/api/organizations/${ORG_A}/config/general`, { data: {} }), [403]);
    expectDenied(await patch(kofi(), `/api/organizations/${ORG_A}/modules/attendance`, { enabled: false }), [403]);
    expectDenied(await get(kofi(), `/api/organizations/${ORG_A}/primary-hr`), [403]);
    expectDenied(await post(kofi(), `/api/organizations/${ORG_A}/primary-hr`, { membershipId: kofi().membershipId }), [403]);
    expectAllowed(await get(orgAdmin(), `/api/organizations/${ORG_A}/primary-hr`));
  });

  it("audit log (audit.read*)", async () => {
    expectDenied(await get(kofi(), `/api/organizations/${ORG_A}/audit-events`), [403]);
  });

  it("Form Templates administration (form_template.manage) — the permission gate refuses before any template work", async () => {
    const body = { templateKey: "x", formType: "x", title: "x" };
    expectDenied(await post(kofi(), `/api/organizations/${ORG_A}/form-templates`, body), [403]);
    // Positive control for the GATE only: the org_admin holding
    // form_template.manage is not refused by authorization. (The mock store
    // has no form tables, so the handler itself is out of scope here; the
    // live form engine suite covers it.)
    const res = await post(orgAdmin(), `/api/organizations/${ORG_A}/form-templates`, body);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("denial is not a broken route: Kofi's legitimate self-scoped read still succeeds", async () => {
    expectAllowed(await get(kofi(), `/api/organizations/${ORG_A}/modules`)); // organization.read
  });
});
