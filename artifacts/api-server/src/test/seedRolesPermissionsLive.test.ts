/**
 * seed:roles — live regression for the role-key collision.
 *
 * `roles.key` is unique only per scope, so an organization may own a role keyed
 * `employee` or `super_admin`. The seed used to resolve templates by key alone
 * across EVERY role, and whichever row came last won: an organization-owned
 * role could receive a template's entire permission list. This suite runs the
 * real seed (seedRolesAndPermissions — the function the seed:roles command
 * runs) against a disposable LOCAL database and proves organization-owned roles
 * are untouched, whatever their key.
 *
 * Opt-in on its own variable (SEED_LIVE_DATABASE_URL): it writes platform-wide
 * templates, which another live suite running in parallel must not observe.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("SEED_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

const MIGRATION_0082 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "lib", "db", "drizzle", "0082_vr02b_revoke_employee_write_own.sql"),
  "utf8",
);

describeLive("seed:roles — templates resolved by system identity (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let pool: any;
  let seed: () => Promise<void>;
  let ROLE_PERMISSIONS: Record<string, readonly string[]>;
  let SYSTEM_ROLES: readonly { key: string }[];
  const stamp = Date.now();
  let n = 0;

  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;
  const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];

  async function makeOrg(): Promise<number> {
    n += 1;
    return (await one(`insert into organizations(name, slug) values ($1, $2) returning id`, [`Seed ${stamp} ${n}`, `seed-${stamp}-${n}`])).id;
  }
  async function makeOrgRole(organizationId: number, key: string, grantKeys: string[] = []): Promise<number> {
    const role = await one(
      `insert into roles(key, organization_id, label, is_system_role) values ($1, $2, $3, false) returning id`,
      [key, organizationId, `Org ${key}`],
    );
    for (const k of grantKeys) {
      await pool.query(
        `insert into role_permissions(role_id, permission_id) select $1, id from permissions where key = $2`,
        [role.id, k],
      );
    }
    return role.id;
  }
  const keysOf = async (roleId: number): Promise<string[]> =>
    (await q(`select p.key from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = $1 order by 1`, [roleId])).map(
      (r: { key: string }) => r.key,
    );
  const templateId = async (key: string): Promise<number> =>
    (await one(`select id from roles where organization_id is null and is_system_role and key = $1`, [key])).id;
  const totalMappings = async (): Promise<number> => Number((await one(`select count(*)::int n from role_permissions`)).n);

  let orgA: number;
  let orgB: number;
  let orgAEmployee: number;
  let orgASuperAdmin: number;
  let orgAHr: number;
  let orgBEmployee: number;
  let orgBRequester: number;

  beforeAll(async () => {
    pool = (await import("@workspace/db")).pool;
    ({ seedRolesAndPermissions: seed } = await import("@workspace/db/seed/roles-permissions-seeder"));
    ({ ROLE_PERMISSIONS, SYSTEM_ROLES } = await import("@workspace/db/seed/roles-permissions-definitions"));

    // Templates exist first (a normal seeded platform).
    await seed();

    orgA = await makeOrg();
    orgB = await makeOrg();
    // Organization-owned roles colliding with template keys — some empty, some
    // with a deliberate, explicit grant that must survive.
    orgAEmployee = await makeOrgRole(orgA, "employee");
    orgASuperAdmin = await makeOrgRole(orgA, "super_admin");
    orgAHr = await makeOrgRole(orgA, "hr", ["leave_request.write.own"]);
    orgBEmployee = await makeOrgRole(orgB, "employee", ["vehicle_request.write.own"]);
    orgBRequester = await makeOrgRole(orgB, "vehicle_requester", ["vehicle_request.write.own", "vehicle_request.write.department"]);

    // The corrected VR-02B state: 0082 has removed write.own from the template.
    await pool.query(MIGRATION_0082);

    await seed();
  });

  it("the system Employee template holds exactly its intended permissions", async () => {
    expect(await keysOf(await templateId("employee"))).toEqual([...new Set(ROLE_PERMISSIONS.employee)].sort());
  });

  it("every system template holds exactly its definition", async () => {
    for (const { key } of SYSTEM_ROLES) {
      expect({ key, keys: await keysOf(await templateId(key)) }).toEqual({ key, keys: [...new Set(ROLE_PERMISSIONS[key] ?? [])].sort() });
    }
  });

  it("an organization-owned role keyed `employee` receives none of the template's permissions", async () => {
    expect(await keysOf(orgAEmployee)).toEqual([]);
  });

  it("an organization-owned role keyed `super_admin` does not receive Super Admin permissions", async () => {
    expect(await keysOf(orgASuperAdmin)).toEqual([]);
  });

  it("an organization-owned role keyed like a template keeps exactly its explicit grant", async () => {
    expect(await keysOf(orgAHr)).toEqual(["leave_request.write.own"]);
  });

  it("same-key roles in different organizations stay isolated from each other and from the template", async () => {
    expect(await keysOf(orgAEmployee)).toEqual([]);
    expect(await keysOf(orgBEmployee)).toEqual(["vehicle_request.write.own"]);
  });

  it("legitimate explicit organization grants survive seeding", async () => {
    expect(await keysOf(orgBRequester)).toEqual(["vehicle_request.write.department", "vehicle_request.write.own"]);
  });

  it("the corrected VR-02B state holds: the system Employee template does not regain vehicle_request.write.own", async () => {
    expect(await keysOf(await templateId("employee"))).not.toContain("vehicle_request.write.own");
    expect(await keysOf(await templateId("super_admin"))).toEqual(expect.arrayContaining([
      "vehicle_request.approve",
      "vehicle_request.read.all",
      "vehicle_request.write.department",
      "vehicle_request.write.own",
    ]));
  });

  it("running the seed again changes nothing", async () => {
    const before = await totalMappings();
    const snapshot = await Promise.all([orgAEmployee, orgASuperAdmin, orgAHr, orgBEmployee, orgBRequester].map(keysOf));
    await seed();
    await seed();
    expect(await totalMappings()).toBe(before);
    expect(await Promise.all([orgAEmployee, orgASuperAdmin, orgAHr, orgBEmployee, orgBRequester].map(keysOf))).toEqual(snapshot);
  });

  it("never renames a role and never touches memberships", async () => {
    const names = await q(`select id, key from roles where id = any($1::int[]) order by id`, [[orgAEmployee, orgASuperAdmin, orgBEmployee]]);
    expect(names.map((r: { key: string }) => r.key)).toEqual(["employee", "super_admin", "employee"]);
    const before = Number((await one(`select count(*)::int n from membership_roles`)).n);
    await seed();
    expect(Number((await one(`select count(*)::int n from membership_roles`)).n)).toBe(before);
  });
});
