/**
 * System role templates are resolved by SYSTEM IDENTITY, never by key alone —
 * live against a real database.
 *
 * `roles.key` is unique only per scope, so any organization may own a role
 * keyed `org_admin`, `hr`, `hr_manager` … Before this fix, organization
 * onboarding, the HR-role migration CLI and the membership backfill each looked
 * a template up by key alone and could pick up an organization-owned role —
 * possibly another tenant's — depending on nothing more than which row Postgres
 * read first.
 *
 * Opt-in (SYSTEM_ROLE_LIVE_DATABASE_URL, a disposable LOCAL database that has
 * had seed:roles run — liveDbGuard refuses anything else). Run it on its own:
 * the fail-closed case briefly disables the system `org_admin` template and
 * restores it in `finally`, and the backfill case processes every user in the
 * database, as the real command does.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("SYSTEM_ROLE_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

const TEMPLATE_KEYS = ["employee", "super_admin", "org_admin", "hr", "hr_manager", "hr_administrator"] as const;

describeLive("system role template resolution (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let inArray: any;
  let sql: any;
  let onboarding: typeof import("../lib/onboarding");
  let systemRoles: typeof import("../lib/systemRoles");
  let backfiller: typeof import("@workspace/db/backfill/memberships-backfiller");

  const suffix = `srr-${Date.now().toString(36)}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  const template: Record<string, { id: number }> = {};

  async function makeOrg(): Promise<number> {
    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq("Org"), slug: uniq("org") }).returning();
    return org.id;
  }

  async function makeUser(organizationId: number, role: string = "employee"): Promise<number> {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "S", lastName: "R", organizationId, role })
      .returning();
    return user.id;
  }

  async function permissionId(key: string): Promise<number> {
    const [p] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
    if (!p) throw new Error(`permission ${key} is not seeded`);
    return p.id;
  }

  /** An organization-owned role under a TEMPLATE key, optionally (wrongly) flagged as a system role. */
  async function makeOrgRole(organizationId: number, key: string, opts: { isSystemRole?: boolean; permissionKeys?: string[] } = {}) {
    const [role] = await db
      .insert(schema.rolesTable)
      .values({ key, organizationId, label: uniq(`org ${key}`), isSystemRole: opts.isSystemRole ?? false })
      .returning();
    for (const k of opts.permissionKeys ?? []) {
      await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await permissionId(k) });
    }
    return role.id as number;
  }

  async function makeMember(organizationId: number, roleIds: number[], status: "active" | "revoked" = "active") {
    const userId = await makeUser(organizationId);
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ organizationId, applicationUserId: userId, status }).returning();
    for (const roleId of roleIds) await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
    return { userId, membershipId: m.id as number };
  }

  async function roleIdsOf(membershipId: number): Promise<number[]> {
    const rows = await db
      .select({ roleId: schema.membershipRolesTable.roleId })
      .from(schema.membershipRolesTable)
      .where(eq(schema.membershipRolesTable.membershipId, membershipId));
    return rows.map((r: { roleId: number }) => r.roleId).sort((a: number, b: number) => a - b);
  }

  async function permissionKeysOfRole(roleId: number): Promise<string[]> {
    const rows = await db
      .select({ key: schema.permissionsTable.key })
      .from(schema.rolePermissionsTable)
      .innerJoin(schema.permissionsTable, eq(schema.rolePermissionsTable.permissionId, schema.permissionsTable.id))
      .where(eq(schema.rolePermissionsTable.roleId, roleId));
    return rows.map((r: { key: string }) => r.key).sort();
  }

  /** The creator's membership in the organization onboarding just created, with its role ids. */
  async function onboard(creatorUserId: number, slug = uniq("new")) {
    const { organization, membership, primaryHr } = await onboarding.onboardOrganization({
      name: uniq("New Org"),
      slug,
      type: "church",
      creatorApplicationUserId: creatorUserId,
    });
    return { organization, membership, primaryHr, roleIds: await roleIdsOf(membership.id) };
  }

  /**
   * Rewrites the system template's row in place. Postgres writes a new tuple
   * version for every UPDATE, usually later in the heap, so a key-only
   * `LIMIT 1` scan can start finding an organization's same-key row first —
   * exactly the physical-order dependence the old lookup had.
   */
  async function rewriteTemplateTuple(key: string) {
    await db.execute(sql`UPDATE roles SET description = description WHERE organization_id IS NULL AND key = ${key}`);
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    inArray = drizzle.inArray;
    sql = drizzle.sql;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    onboarding = await import("../lib/onboarding");
    systemRoles = await import("../lib/systemRoles");
    backfiller = await import("@workspace/db/backfill/memberships-backfiller");

    for (const key of TEMPLATE_KEYS) {
      const [row] = await db
        .select()
        .from(schema.rolesTable)
        .where(and(eq(schema.rolesTable.key, key), sql`${schema.rolesTable.organizationId} is null`, eq(schema.rolesTable.isSystemRole, true)));
      if (!row) throw new Error(`system template "${key}" is missing — run seed:roles against this database first`);
      template[key] = row;
    }
  });

  // ── the resolver ───────────────────────────────────────────────────────────
  describe("resolveSystemRoleTemplate", () => {
    it("returns the system template even when organizations own same-key roles, flagged or not", async () => {
      const x = await makeOrg();
      const y = await makeOrg();
      for (const key of TEMPLATE_KEYS) {
        await makeOrgRole(x, key);
        await makeOrgRole(y, key, { isSystemRole: true });
      }
      for (const key of TEMPLATE_KEYS) {
        await rewriteTemplateTuple(key);
        const resolved = await systemRoles.resolveSystemRoleTemplate(db, key);
        expect({ key, id: resolved.id, organizationId: resolved.organizationId }).toEqual({ key, id: template[key]!.id, organizationId: null });
      }
    });

    it("fails closed for a key with no system template, even if organizations own that key", async () => {
      const x = await makeOrg();
      const key = uniq("no_such_template");
      await makeOrgRole(x, key, { isSystemRole: true });
      await expect(systemRoles.resolveSystemRoleTemplate(db, key)).rejects.toBeInstanceOf(systemRoles.SystemRoleTemplateNotFoundError);
    });

    it("listSystemRoleTemplates returns templates only", async () => {
      const x = await makeOrg();
      await makeOrgRole(x, "hr_manager", { isSystemRole: true });
      const listed = await systemRoles.listSystemRoleTemplates(db, ["hr_manager", "hr_administrator"]);
      expect(listed.map((r) => r.id).sort()).toEqual([template.hr_administrator!.id, template.hr_manager!.id].sort());
      expect(listed.every((r) => r.organizationId === null)).toBe(true);
    });
  });

  // ── organization onboarding ────────────────────────────────────────────────
  describe("onboardOrganization", () => {
    it("Org X owning `org_admin` does not change what Org Y's creator receives: the SYSTEM template", async () => {
      const x = await makeOrg();
      const xRole = await makeOrgRole(x, "org_admin", { permissionKeys: ["employee.read"] });
      const creator = await makeUser(x, "super_admin");
      const { roleIds } = await onboard(creator);
      expect(roleIds).toEqual([template.org_admin!.id]);
      expect(roleIds).not.toContain(xRole);
      // X's role is untouched.
      expect(await permissionKeysOfRole(xRole)).toEqual(["employee.read"]);
    });

    it("many organizations owning `org_admin` cannot influence selection", async () => {
      const foreign: number[] = [];
      for (let i = 0; i < 5; i++) foreign.push(await makeOrgRole(await makeOrg(), "org_admin"));
      const creator = await makeUser(await makeOrg(), "super_admin");
      const { roleIds } = await onboard(creator);
      expect(roleIds).toEqual([template.org_admin!.id]);
      for (const id of foreign) expect(roleIds).not.toContain(id);
    });

    it("physical row order cannot influence selection", async () => {
      const before = await makeOrgRole(await makeOrg(), "org_admin");
      await rewriteTemplateTuple("org_admin");
      const after = await makeOrgRole(await makeOrg(), "org_admin");
      const creatorA = await makeUser(await makeOrg(), "super_admin");
      const a = await onboard(creatorA);
      await rewriteTemplateTuple("org_admin");
      const creatorB = await makeUser(await makeOrg(), "super_admin");
      const b = await onboard(creatorB);
      for (const r of [a, b]) {
        expect(r.roleIds).toEqual([template.org_admin!.id]);
        expect(r.roleIds).not.toContain(before);
        expect(r.roleIds).not.toContain(after);
      }
    });

    it("an organization-owned `org_admin` wrongly flagged is_system_role = true cannot masquerade as the template", async () => {
      const masquerade = await makeOrgRole(await makeOrg(), "org_admin", { isSystemRole: true, permissionKeys: ["employee.read"] });
      await rewriteTemplateTuple("org_admin");
      const creator = await makeUser(await makeOrg(), "super_admin");
      const { roleIds } = await onboard(creator);
      expect(roleIds).toEqual([template.org_admin!.id]);
      expect(roleIds).not.toContain(masquerade);
    });

    it("keeps the rest of onboarding intact: active membership, Primary HR, both audit events", async () => {
      const creator = await makeUser(await makeOrg(), "super_admin");
      const { organization, membership, primaryHr, roleIds } = await onboard(creator);
      expect(membership.status).toBe("active");
      expect(membership.applicationUserId).toBe(creator);
      expect(membership.organizationId).toBe(organization.id);
      expect(primaryHr.membershipId).toBe(membership.id);
      expect(primaryHr.organizationId).toBe(organization.id);
      expect(roleIds).toEqual([template.org_admin!.id]);
      const events = await db
        .select({ eventType: schema.auditEventsTable.eventType })
        .from(schema.auditEventsTable)
        .where(eq(schema.auditEventsTable.organizationId, organization.id));
      expect(events.map((e: { eventType: string }) => e.eventType).sort()).toEqual(["organization.onboarded", "primary_hr.appointed"]);
    });

    it("a duplicate slug is still a unique violation, and creates nothing", async () => {
      const creator = await makeUser(await makeOrg(), "super_admin");
      const slug = uniq("dup");
      await onboard(creator, slug);
      const { isUniqueViolation } = await import("../lib/dbErrors");
      const err = await onboard(creator, slug).then(() => null, (e: unknown) => e);
      expect(isUniqueViolation(err)).toBe(true);
      const orgs = await db.select().from(schema.organizationsTable).where(eq(schema.organizationsTable.slug, slug));
      expect(orgs).toHaveLength(1);
    });

    it("a missing SYSTEM `org_admin` fails closed and leaves nothing behind", async () => {
      // An organization-owned `org_admin` exists, flagged as a system role, so
      // the old key-only lookup would have "succeeded" with it.
      await makeOrgRole(await makeOrg(), "org_admin", { isSystemRole: true });
      const creator = await makeUser(await makeOrg(), "super_admin");
      const slug = uniq("failclosed");
      const membershipsBefore = await db
        .select()
        .from(schema.organizationMembershipsTable)
        .where(eq(schema.organizationMembershipsTable.applicationUserId, creator));

      await db.execute(sql`UPDATE roles SET is_system_role = false WHERE id = ${template.org_admin!.id}`);
      try {
        await expect(onboard(creator, slug)).rejects.toBeInstanceOf(systemRoles.SystemRoleTemplateNotFoundError);
      } finally {
        await db.execute(sql`UPDATE roles SET is_system_role = true WHERE id = ${template.org_admin!.id}`);
      }

      const orgs = await db.select().from(schema.organizationsTable).where(eq(schema.organizationsTable.slug, slug));
      expect(orgs).toHaveLength(0);
      const membershipsAfter = await db
        .select()
        .from(schema.organizationMembershipsTable)
        .where(eq(schema.organizationMembershipsTable.applicationUserId, creator));
      expect(membershipsAfter).toHaveLength(membershipsBefore.length);
      const ids = membershipsAfter.map((m: { id: number }) => m.id);
      if (ids.length > 0) {
        const primary = await db.select().from(schema.primaryHrAssignmentsTable).where(inArray(schema.primaryHrAssignmentsTable.membershipId, ids));
        expect(primary).toHaveLength(0);
        const links = await db.select().from(schema.membershipRolesTable).where(inArray(schema.membershipRolesTable.membershipId, ids));
        expect(links).toHaveLength(0);
      }
      // And onboarding works again once the template is back.
      expect((await onboard(creator)).roleIds).toEqual([template.org_admin!.id]);
    });
  });

  // ── HR-role migration CLI ──────────────────────────────────────────────────
  describe("migrate-hr-roles CLI", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.resolve(here, "../../scripts/migrate-hr-roles.ts");
    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

    function runCli(args: string[]) {
      const out = spawnSync(process.execPath, [tsxCli, scriptPath, ...args], {
        env: { ...process.env, DATABASE_URL: LIVE_URL! },
        encoding: "utf8",
        timeout: 120_000,
      });
      return { status: out.status, output: `${out.stdout}\n${out.stderr}` };
    }

    it("migrates only SYSTEM deprecated templates onto the SYSTEM `hr`; organization-owned same-key roles are untouched", async () => {
      const org = await makeOrg();
      const actorRole = await makeOrgRole(org, uniq("hr_admin_actor"), { permissionKeys: ["role.manage", "membership.manage"] });
      const actor = await makeMember(org, [actorRole]);

      // Organization-owned roles under all three HR keys, in this org and another,
      // some wrongly flagged as system roles — none may be treated as a template.
      const orgHr = await makeOrgRole(org, "hr", { isSystemRole: true, permissionKeys: ["employee.read"] });
      const orgMgr = await makeOrgRole(org, "hr_manager", { permissionKeys: ["employee.read"] });
      const orgAdm = await makeOrgRole(org, "hr_administrator", { isSystemRole: true, permissionKeys: ["employee.read"] });
      await makeOrgRole(await makeOrg(), "hr", { isSystemRole: true });
      for (const key of ["hr", "hr_manager", "hr_administrator"]) await rewriteTemplateTuple(key);

      const sysHolder = await makeMember(org, [template.hr_manager!.id]);
      const orgHrHolder = await makeMember(org, [orgHr]);
      const orgMgrHolder = await makeMember(org, [orgMgr]);
      const orgAdmHolder = await makeMember(org, [orgAdm]);

      // Dry run first: plans exactly the one system-template holder.
      const dry = runCli(["--org", String(org), "--actor-user", String(actor.userId), "--actor-membership", String(actor.membershipId)]);
      expect(dry.status, dry.output).toBe(0);
      expect(dry.output).toContain(`membership ${sysHolder.membershipId} `);
      for (const m of [orgHrHolder, orgMgrHolder, orgAdmHolder]) expect(dry.output).not.toContain(`membership ${m.membershipId} `);

      const run = runCli([
        "--org", String(org),
        "--actor-user", String(actor.userId),
        "--actor-membership", String(actor.membershipId),
        "--confirm",
      ]);
      expect(run.status, run.output).toBe(0);

      // The system holder moved to the SYSTEM hr template — not the org's `hr`.
      expect(await roleIdsOf(sysHolder.membershipId)).toEqual([template.hr!.id]);
      // Organization-owned HR roles and their holders are exactly as they were.
      expect(await roleIdsOf(orgHrHolder.membershipId)).toEqual([orgHr]);
      expect(await roleIdsOf(orgMgrHolder.membershipId)).toEqual([orgMgr]);
      expect(await roleIdsOf(orgAdmHolder.membershipId)).toEqual([orgAdm]);
      for (const id of [orgHr, orgMgr, orgAdm]) expect(await permissionKeysOfRole(id)).toEqual(["employee.read"]);
    });
  });

  // ── membership backfill ────────────────────────────────────────────────────
  describe("backfill:memberships", () => {
    it("the template map holds SYSTEM templates only", async () => {
      await makeOrgRole(await makeOrg(), "org_admin", { isSystemRole: true });
      await makeOrgRole(await makeOrg(), "employee");
      const map = await backfiller.systemRoleTemplatesByKey();
      for (const [key, role] of map) {
        expect({ key, organizationId: role.organizationId, isSystemRole: role.isSystemRole }).toEqual({ key, organizationId: null, isSystemRole: true });
      }
      for (const key of TEMPLATE_KEYS) expect(map.get(key)?.id).toBe(template[key]!.id);
    });

    it("never assigns an organization-owned same-key role — its own org's or another's", async () => {
      const home = await makeOrg();
      const other = await makeOrg();
      const homeRoles = [await makeOrgRole(home, "org_admin"), await makeOrgRole(home, "hr_manager", { isSystemRole: true })];
      const otherRoles = [await makeOrgRole(other, "org_admin", { isSystemRole: true }), await makeOrgRole(other, "employee")];
      for (const key of ["org_admin", "hr_manager", "employee"]) await rewriteTemplateTuple(key);

      // Legacy users with no membership yet — what the backfill exists for.
      const legacy = {
        org_admin: await makeUser(home, "org_admin"),
        hr_manager: await makeUser(home, "hr_manager"),
        employee: await makeUser(home, "employee"),
      };

      await backfiller.backfillMemberships();

      for (const [key, userId] of Object.entries(legacy)) {
        const [m] = await db
          .select()
          .from(schema.organizationMembershipsTable)
          .where(and(eq(schema.organizationMembershipsTable.applicationUserId, userId), eq(schema.organizationMembershipsTable.organizationId, home)));
        expect(m, `membership for legacy ${key} user`).toBeTruthy();
        const ids = await roleIdsOf(m.id);
        expect({ key, ids }).toEqual({ key, ids: [template[key]!.id] });
        for (const id of [...homeRoles, ...otherRoles]) expect(ids).not.toContain(id);
      }

      // Idempotent: a second run creates nothing for these users and adds no link.
      const before = await Promise.all(Object.values(legacy).map(async (u) => {
        const [m] = await db.select().from(schema.organizationMembershipsTable).where(eq(schema.organizationMembershipsTable.applicationUserId, u));
        return roleIdsOf(m.id);
      }));
      await backfiller.backfillMemberships();
      const after = await Promise.all(Object.values(legacy).map(async (u) => {
        const rows = await db.select().from(schema.organizationMembershipsTable).where(eq(schema.organizationMembershipsTable.applicationUserId, u));
        expect(rows).toHaveLength(1);
        return roleIdsOf(rows[0].id);
      }));
      expect(after).toEqual(before);
    });
  });
});
