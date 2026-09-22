/**
 * getEffectivePermissions — the read-side tenant guard, live against a real
 * database.
 *
 * Every assignment path refuses to link a membership to another
 * organization's role, but a malformed `membership_roles` row can still exist:
 * historical onboarding resolved `org_admin` by key alone, and operator
 * scripts or manual SQL write the table directly. Rows here are inserted
 * DIRECTLY, bypassing every writer guard, to prove that such a link grants
 * nothing while system templates and same-organization roles keep working.
 *
 * Opt-in (EFFECTIVE_PERMISSIONS_LIVE_DATABASE_URL, a disposable LOCAL database
 * that has had seed:roles run — liveDbGuard refuses anything else).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("EFFECTIVE_PERMISSIONS_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("getEffectivePermissions — cross-organization roles grant nothing (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let isNull: any;
  let permissions: typeof import("../lib/permissions");

  const suffix = `epg-${Date.now().toString(36)}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  let orgX: number;
  let orgY: number;
  let employeeTemplate: { id: number };
  let employeeTemplateKeys: Set<string>;

  async function permissionId(key: string): Promise<number> {
    const [p] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
    if (!p) throw new Error(`permission ${key} is not seeded`);
    return p.id;
  }

  async function makeOrg(): Promise<number> {
    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq("Org"), slug: uniq("org") }).returning();
    return org.id;
  }

  async function makeOrgRole(organizationId: number, keys: string[], opts: { key?: string; isSystemRole?: boolean } = {}) {
    const [role] = await db
      .insert(schema.rolesTable)
      .values({ key: opts.key ?? uniq("role"), organizationId, label: uniq("Role"), isSystemRole: opts.isSystemRole ?? false })
      .returning();
    for (const k of keys) await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await permissionId(k) });
    return role.id as number;
  }

  /** A membership in `organizationId` linked DIRECTLY to `roleIds` — no writer guard in the way. */
  async function makeMembership(organizationId: number, roleIds: number[]): Promise<number> {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "E", lastName: "P", organizationId })
      .returning();
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ organizationId, applicationUserId: user.id, status: "active" }).returning();
    for (const roleId of roleIds) await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
    return m.id;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    isNull = drizzle.isNull;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    permissions = await import("../lib/permissions");

    [employeeTemplate] = await db
      .select()
      .from(schema.rolesTable)
      .where(and(eq(schema.rolesTable.key, "employee"), isNull(schema.rolesTable.organizationId), eq(schema.rolesTable.isSystemRole, true)));
    if (!employeeTemplate) throw new Error("system `employee` template missing — run seed:roles first");
    const rows = await db
      .select({ key: schema.permissionsTable.key })
      .from(schema.rolePermissionsTable)
      .innerJoin(schema.permissionsTable, eq(schema.rolePermissionsTable.permissionId, schema.permissionsTable.id))
      .where(eq(schema.rolePermissionsTable.roleId, employeeTemplate.id));
    employeeTemplateKeys = new Set(rows.map((r: { key: string }) => r.key));
    expect(employeeTemplateKeys.size).toBeGreaterThan(0);

    orgX = await makeOrg();
    orgY = await makeOrg();
  });

  it("a SYSTEM template role contributes its permissions", async () => {
    const m = await makeMembership(orgY, [employeeTemplate.id]);
    expect(await permissions.getEffectivePermissions(m)).toEqual(employeeTemplateKeys);
  });

  it("a same-organization custom role contributes its permissions", async () => {
    const role = await makeOrgRole(orgY, ["employee.read", "leave_request.approve"]);
    const m = await makeMembership(orgY, [role]);
    expect(await permissions.getEffectivePermissions(m)).toEqual(new Set(["employee.read", "leave_request.approve"]));
  });

  it("another organization's custom role, linked directly, contributes NOTHING", async () => {
    const foreign = await makeOrgRole(orgX, ["employee.read", "leave_request.approve"]);
    const m = await makeMembership(orgY, [foreign]);
    expect((await permissions.getEffectivePermissions(m)).size).toBe(0);
    expect(await permissions.hasPermission(m, "employee.read")).toBe(false);
  });

  it("with mixed valid and invalid roles, only the valid ones contribute", async () => {
    const own = await makeOrgRole(orgY, ["employee.read"]);
    const foreign = await makeOrgRole(orgX, ["leave_request.approve", "payroll.compensation.read"]);
    const m = await makeMembership(orgY, [employeeTemplate.id, own, foreign]);
    const effective = await permissions.getEffectivePermissions(m);
    expect(effective).toEqual(new Set([...employeeTemplateKeys, "employee.read"]));
  });

  it("a foreign role cannot grant a powerful permission — even keyed `org_admin` and flagged as a system role", async () => {
    const powerful = ["membership.manage", "role.manage", "organization.update", "audit.read"];
    const masquerade = await makeOrgRole(orgX, powerful, { key: "org_admin", isSystemRole: true });
    const m = await makeMembership(orgY, [masquerade]);
    for (const key of powerful) expect({ key, held: await permissions.hasPermission(m, key) }).toEqual({ key, held: false });
  });

  it("a foreign role cannot remove or interfere with valid permissions", async () => {
    const own = await makeOrgRole(orgY, ["employee.read", "leave_request.approve"]);
    const baseline = await makeMembership(orgY, [employeeTemplate.id, own]);
    const withForeign = await makeMembership(orgY, [employeeTemplate.id, own, await makeOrgRole(orgX, []), await makeOrgRole(orgX, ["employee.read"])]);
    expect(await permissions.getEffectivePermissions(withForeign)).toEqual(await permissions.getEffectivePermissions(baseline));
  });

  it("the same role counts for its own organization's members and not for anyone else's", async () => {
    const role = await makeOrgRole(orgX, ["employee.read"]);
    const inX = await makeMembership(orgX, [role]);
    const inY = await makeMembership(orgY, [role]);
    expect(await permissions.hasPermission(inX, "employee.read")).toBe(true);
    expect(await permissions.hasPermission(inY, "employee.read")).toBe(false);
  });

  it("normal behaviour is unchanged: no roles means no permissions; the union spans template and own roles", async () => {
    expect((await permissions.getEffectivePermissions(await makeMembership(orgY, []))).size).toBe(0);
    const a = await makeOrgRole(orgY, ["employee.read"]);
    const b = await makeOrgRole(orgY, ["leave_request.approve"]);
    const m = await makeMembership(orgY, [employeeTemplate.id, a, b]);
    expect(await permissions.getEffectivePermissions(m)).toEqual(new Set([...employeeTemplateKeys, "employee.read", "leave_request.approve"]));
  });
});
