/**
 * HR role consolidation — live behaviour (local 5433). Skipped unless
 * WS26_LIVE_DATABASE_URL is set.
 *
 * Covers the parts that are only true against a real database: that a
 * canonical-HR membership actually resolves the effective permissions the
 * activation CLI demands, that Primary HR stays a designation rather than a
 * role, that several HR users can coexist, that HR cannot reach another
 * tenant, and that migrating a deprecated holder loses them nothing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";
import {
  ROLE_PERMISSIONS,
  CANONICAL_HR_ROLE_KEY,
  DEPRECATED_ROLE_KEYS,
} from "@workspace/db/seed/roles-permissions-definitions";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("HR role consolidation (live)", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let permissions: typeof import("../lib/permissions");
  let authz: typeof import("../lib/actorAuthorization");
  let primaryHr: typeof import("../lib/primaryHr");
  let installer: typeof import("../lib/formEngine/templateInstaller");

  const suffix = `hrc-${Date.now().toString(36)}`;
  let seq = 0;

  async function makeOrg(tag: string): Promise<number> {
    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `HRC ${tag} ${suffix}`, slug: `${suffix}-${tag}-${++seq}` })
      .returning();
    return org.id;
  }

  async function permissionId(key: string): Promise<number> {
    const [existing] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
    if (existing) return existing.id;
    const [resource, action] = key.split(".");
    const [created] = await db
      .insert(schema.permissionsTable)
      .values({ key, resource: resource ?? key, action: action ?? "manage" })
      .returning();
    return created.id;
  }

  /**
   * A real system-style role template carrying exactly the seeded key set for
   * `roleKey`. The local database is not necessarily fully seeded, so this
   * builds the template from the same pure definitions the seed writer uses.
   */
  async function ensureTemplate(roleKey: string): Promise<number> {
    const scopedKey = `${roleKey}__${suffix}`;
    const [role] = await db
      .insert(schema.rolesTable)
      .values({ key: scopedKey, organizationId: null, label: scopedKey, isSystemRole: true })
      .returning();
    for (const key of ROLE_PERMISSIONS[roleKey] ?? []) {
      await db
        .insert(schema.rolePermissionsTable)
        .values({ roleId: role.id, permissionId: await permissionId(key) })
        .onConflictDoNothing();
    }
    return role.id;
  }

  async function makeMember(organizationId: number, roleIds: number[], tag: string) {
    const n = ++seq;
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${tag}-${n}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "U", organizationId })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: user.id, organizationId, status: "active" })
      .returning();
    for (const roleId of roleIds) {
      await db.insert(schema.membershipRolesTable).values({ membershipId: membership.id, roleId });
    }
    return { userId: user.id, membershipId: membership.id };
  }

  let hrTemplateId: number;
  let hrAdministratorTemplateId: number;
  let employeeTemplateId: number;

  beforeAll(async () => {
    ({ eq, and } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    permissions = await import("../lib/permissions");
    authz = await import("../lib/actorAuthorization");
    primaryHr = await import("../lib/primaryHr");
    installer = await import("../lib/formEngine/templateInstaller");
    hrTemplateId = await ensureTemplate(CANONICAL_HR_ROLE_KEY);
    hrAdministratorTemplateId = await ensureTemplate("hr_administrator");
    employeeTemplateId = await ensureTemplate("employee");
  }, 120000);

  it("a canonical HR membership resolves form_template.manage AND publish", async () => {
    const org = await makeOrg("pub");
    const hrUser = await makeMember(org, [hrTemplateId], "hr");
    const effective = await permissions.getEffectivePermissions(hrUser.membershipId);
    expect(effective.has("form_template.manage")).toBe(true);
    expect(effective.has("form_template.publish")).toBe(true);
  });

  it("the hardened activation CLI authorizes canonical HR through real effective permissions", async () => {
    const org = await makeOrg("activate");
    const hrUser = await makeMember(org, [hrTemplateId], "hr");
    // No bypass was added: this is the same authorizeActor gate, satisfied by
    // genuine tenant permissions.
    const actor = await authz.authorizeActor({
      organizationId: org,
      actorApplicationUserId: hrUser.userId,
      actorMembershipId: hrUser.membershipId,
      requiredPermissions: ["form_template.manage", "form_template.publish"],
    });
    expect(actor.membershipId).toBe(hrUser.membershipId);

    const wwm = await import("../formTemplates/wwm");
    const results = await installer.installTemplates({
      organizationId: org,
      seeds: wwm.WWM_FORM_TEMPLATES,
      actorApplicationUserId: hrUser.userId,
      actorMembershipId: hrUser.membershipId,
    });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.action === "installed" && r.published)).toBe(true);
  });

  it("a deprecated hr_administrator holder cannot publish — the gap the consolidation closes", async () => {
    const org = await makeOrg("legacy");
    const legacy = await makeMember(org, [hrAdministratorTemplateId], "legacy");
    const effective = await permissions.getEffectivePermissions(legacy.membershipId);
    expect(effective.has("form_template.manage")).toBe(true);
    expect(effective.has("form_template.publish")).toBe(false);
    await expect(
      authz.authorizeActor({
        organizationId: org,
        actorApplicationUserId: legacy.userId,
        actorMembershipId: legacy.membershipId,
        requiredPermissions: ["form_template.manage", "form_template.publish"],
      }),
    ).rejects.toThrow(/form_template\.publish/);
  });

  it("migrating a deprecated holder onto canonical HR loses them nothing and gains publish", async () => {
    const org = await makeOrg("migrate");
    const holder = await makeMember(org, [hrAdministratorTemplateId], "holder");
    const before = await permissions.getEffectivePermissions(holder.membershipId);

    // The migration shape the CLI performs: grant first, then revoke.
    await db.insert(schema.membershipRolesTable).values({ membershipId: holder.membershipId, roleId: hrTemplateId });
    await db
      .delete(schema.membershipRolesTable)
      .where(
        and(
          eq(schema.membershipRolesTable.membershipId, holder.membershipId),
          eq(schema.membershipRolesTable.roleId, hrAdministratorTemplateId),
        ),
      );

    const after = await permissions.getEffectivePermissions(holder.membershipId);
    for (const key of before) expect(after.has(key), `lost ${key}`).toBe(true);
    expect(after.has("form_template.publish")).toBe(true);
    expect(after.size).toBeGreaterThan(before.size);
  });

  it("supports multiple HR users in one organization", async () => {
    const org = await makeOrg("many");
    const a = await makeMember(org, [hrTemplateId], "hra");
    const b = await makeMember(org, [hrTemplateId], "hrb");
    const c = await makeMember(org, [hrTemplateId], "hrc");
    for (const m of [a, b, c]) {
      const eff = await permissions.getEffectivePermissions(m.membershipId);
      expect(eff.has("form_template.publish")).toBe(true);
    }
    const holders = await db
      .select()
      .from(schema.membershipRolesTable)
      .where(eq(schema.membershipRolesTable.roleId, hrTemplateId));
    expect(holders.length).toBeGreaterThanOrEqual(3);
  });

  it("Primary HR is a designation, not a role: HR authority does not require it", async () => {
    const org = await makeOrg("primary");
    const one = await makeMember(org, [hrTemplateId], "hr1");
    const two = await makeMember(org, [hrTemplateId], "hr2");

    // Neither is Primary HR yet — both still hold full HR authority.
    expect((await permissions.getEffectivePermissions(one.membershipId)).has("form_template.publish")).toBe(true);
    expect((await permissions.getEffectivePermissions(two.membershipId)).has("form_template.publish")).toBe(true);
    expect(await primaryHr.getActivePrimaryHr(org)).toBeNull();

    // Designating one changes no permission set; it only names the single
    // accountable HR authority.
    await db.insert(schema.primaryHrAssignmentsTable).values({ organizationId: org, membershipId: one.membershipId, assignedBy: one.userId });
    const active = await primaryHr.getActivePrimaryHr(org);
    expect(active?.membershipId).toBe(one.membershipId);
    const twoAfter = await permissions.getEffectivePermissions(two.membershipId);
    expect(twoAfter.has("form_template.publish")).toBe(true);

    // And Primary HR is not a role template: it appears in no membership_roles row.
    const roleRows = await db
      .select()
      .from(schema.membershipRolesTable)
      .where(eq(schema.membershipRolesTable.membershipId, one.membershipId));
    const roleIds = roleRows.map((r) => r.roleId);
    expect(roleIds).toEqual([hrTemplateId]);
  });

  it("a Primary HR holding canonical HR satisfies the hr_team delegation invariant", async () => {
    const org = await makeOrg("invariant");
    const hrUser = await makeMember(org, [hrTemplateId], "phr");
    await db.insert(schema.primaryHrAssignmentsTable).values({ organizationId: org, membershipId: hrUser.membershipId, assignedBy: hrUser.userId });
    const eff = await permissions.getEffectivePermissions(hrUser.membershipId);
    // Both halves of the hr_team path: the key AND the designation.
    expect(eff.has("hr_team.manage")).toBe(true);
    expect((await primaryHr.getActivePrimaryHr(org))?.membershipId).toBe(hrUser.membershipId);
  });

  it("HR cannot cross a tenant boundary", async () => {
    const home = await makeOrg("home");
    const foreign = await makeOrg("foreign");
    const hrUser = await makeMember(home, [hrTemplateId], "hrx");
    await expect(
      authz.authorizeActor({
        organizationId: foreign,
        actorApplicationUserId: hrUser.userId,
        actorMembershipId: hrUser.membershipId,
        requiredPermissions: ["form_template.manage"],
      }),
    ).rejects.toThrow(/no active membership in this organization/);
  });

  it("an ordinary employee remains least-privileged", async () => {
    const org = await makeOrg("emp");
    const emp = await makeMember(org, [employeeTemplateId], "emp");
    const eff = await permissions.getEffectivePermissions(emp.membershipId);
    for (const key of ["form_template.manage", "form_template.publish", "employee.sensitive.read", "hr_team.manage", "role.manage", "membership.manage"]) {
      expect(eff.has(key), key).toBe(false);
    }
  });

  it("reporting-manager workflow authority is independent of any HR role", async () => {
    const org = await makeOrg("mgr");
    // A plain employee who is somebody's reporting manager holds no HR keys;
    // stage authority comes from employees.reportingManagerId, not a role name.
    const manager = await makeMember(org, [employeeTemplateId], "mgr");
    const eff = await permissions.getEffectivePermissions(manager.membershipId);
    expect(eff.has("form_template.manage")).toBe(false);
    const templates = await import("../lib/formEngine/templates");
    const [mgrEmployee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: org, employeeNumber: `M-${suffix}-${++seq}`, firstName: "Man", lastName: "Ager" })
      .returning();
    const [report] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: org, employeeNumber: `R-${suffix}-${++seq}`, firstName: "Re", lastName: "Port", reportingManagerId: mgrEmployee.id })
      .returning();
    await db.insert(schema.employeeUserLinksTable).values({
      employeeId: mgrEmployee.id,
      applicationUserId: manager.userId,
      organizationMembershipId: manager.membershipId,
    });
    const stage = { resolver: "reporting_manager", resolverConfig: null } as unknown as Parameters<typeof templates.membershipSatisfiesFormStage>[0]["stage"];
    const resolves = await templates.membershipSatisfiesFormStage({
      organizationId: org,
      stage,
      membershipId: manager.membershipId,
      subjectEmployeeId: report.id,
    });
    expect(resolves).toBe(true);
  });

  it("deprecated templates remain readable so historical audit stays interpretable", async () => {
    for (const key of DEPRECATED_ROLE_KEYS) {
      expect(ROLE_PERMISSIONS[key]).toBeDefined();
      expect((ROLE_PERMISSIONS[key] ?? []).length).toBeGreaterThan(0);
    }
  });
});
