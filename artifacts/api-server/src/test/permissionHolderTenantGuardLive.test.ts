/**
 * Every permission-derived path ignores a role another organization owns —
 * live against a real database.
 *
 * getEffectivePermissions drops a foreign role (effectivePermissionsTenantGuardLive).
 * Four other paths derive "who holds permission K" straight from
 * membership_roles and must apply the SAME tenant-ownership rule:
 *   1. notification recipients for `permission_holders`;
 *   2. onboarding responsibility (task assignee, reminders, Action Centre);
 *   3. Vehicle Request approval candidates;
 *   4. GET /me/organizations — the caller's own roles and permissions, which
 *      drive navigation.
 *
 * The malformed link is written DIRECTLY, bypassing every assignment guard: a
 * member of organization Y linked to a role organization X owns — keyed
 * `org_admin`, wrongly flagged as a system role, and carrying powerful keys.
 *
 * Opt-in (PERMISSION_HOLDER_LIVE_DATABASE_URL, a disposable LOCAL database that
 * has had seed:roles run — liveDbGuard refuses anything else).
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("PERMISSION_HOLDER_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

const APPROVE = "vehicle_request.approve";
const ER = "employee_relations.manage";
const TASK = "onboarding.task.complete";
const POWERFUL = [APPROVE, ER, TASK, "membership.manage", "role.manage", "organization.update", "audit.read"];

describeLive("direct permission-holder paths ignore another organization's role (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let isNull: any;
  let app: any;
  let permissions: typeof import("../lib/permissions");
  let notifications: typeof import("../lib/notifications");
  let responsibility: typeof import("../lib/onboarding/responsibility");
  let vrStages: typeof import("../lib/vehicleRequestStages");

  const suffix = `phg-${Date.now().toString(36)}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  let orgX: number;
  let orgY: number;
  let employeeY: number;
  let foreignRole: number;
  let employeeTemplate: { id: number; key: string };

  interface Person {
    userId: number;
    membershipId: number;
  }
  /** Distinct people in org Y, each linked to exactly the roles given. */
  let foreignOnly: Person; // only the malformed foreign role
  let templateHolder: Person; // a system template + a same-org role holding the keys
  let customHolder: Person; // a same-org custom role holding the keys
  let mixed: Person; // valid same-org role (ER only) + the foreign role

  async function permissionId(key: string): Promise<number> {
    const [p] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
    if (!p) throw new Error(`permission ${key} is not seeded`);
    return p.id;
  }

  async function makeOrg(): Promise<number> {
    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq("Org"), slug: uniq("org") }).returning();
    return org.id;
  }

  async function makeRole(organizationId: number | null, keys: string[], opts: { key?: string; isSystemRole?: boolean } = {}) {
    const [role] = await db
      .insert(schema.rolesTable)
      .values({ key: opts.key ?? uniq("role"), organizationId, label: uniq("Role"), isSystemRole: opts.isSystemRole ?? false })
      .returning();
    for (const k of keys) await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await permissionId(k) });
    return role.id as number;
  }

  async function makePerson(organizationId: number, roleIds: number[], lastName = uniq("P")): Promise<Person> {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "Holder", lastName, organizationId })
      .returning();
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ organizationId, applicationUserId: user.id, status: "active" }).returning();
    // Direct inserts: no assignment guard is consulted.
    for (const roleId of roleIds) await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
    return { userId: user.id, membershipId: m.id };
  }

  async function meOrganizations(person: Person) {
    const token = `phg-${randomUUID()}`;
    await db.insert(schema.sessionsTable).values({ token, userId: person.userId, expiresAt: new Date(Date.now() + 3_600_000) });
    const res = await request(app).get("/api/me/organizations").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const summary = (res.body as any[]).find((o) => o.organizationId === orgY);
    expect(summary, "membership summary for org Y").toBeTruthy();
    return summary as { roles: string[]; permissions: string[] };
  }

  const holderIds = (rows: { userId: number }[]) => rows.map((r) => r.userId);

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    isNull = drizzle.isNull;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    permissions = await import("../lib/permissions");
    notifications = await import("../lib/notifications");
    responsibility = await import("../lib/onboarding/responsibility");
    vrStages = await import("../lib/vehicleRequestStages");
    app = (await import("../app")).default;

    [employeeTemplate] = await db
      .select()
      .from(schema.rolesTable)
      .where(and(eq(schema.rolesTable.key, "employee"), isNull(schema.rolesTable.organizationId), eq(schema.rolesTable.isSystemRole, true)));
    if (!employeeTemplate) throw new Error("system `employee` template missing — run seed:roles first");

    orgX = await makeOrg();
    orgY = await makeOrg();
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgY, firstName: "New", lastName: uniq("Hire") }).returning();
    employeeY = emp.id;

    // The malformed role: owned by X, keyed like the org_admin template and
    // wrongly flagged as a system role.
    foreignRole = await makeRole(orgX, POWERFUL, { key: "org_admin", isSystemRole: true });
    const sameOrgAll = await makeRole(orgY, [APPROVE, ER, TASK]);
    const sameOrgErOnly = await makeRole(orgY, [ER]);

    foreignOnly = await makePerson(orgY, [foreignRole]);
    templateHolder = await makePerson(orgY, [employeeTemplate.id, sameOrgAll]);
    customHolder = await makePerson(orgY, [sameOrgAll]);
    mixed = await makePerson(orgY, [sameOrgErOnly, foreignRole]);
  });

  // 1. getEffectivePermissions ------------------------------------------------
  it("getEffectivePermissions still excludes the foreign role", async () => {
    expect((await permissions.getEffectivePermissions(foreignOnly.membershipId)).size).toBe(0);
    const mixedKeys = await permissions.getEffectivePermissions(mixed.membershipId);
    expect([...mixedKeys].sort()).toEqual([ER]);
  });

  // 2. notification recipients ------------------------------------------------
  it("notification permission-holder resolution excludes the foreign role", async () => {
    for (const key of [ER, APPROVE, TASK]) {
      const recipients = holderIds(await notifications.resolveRecipients({ kind: "permission_holders", permissionKey: key }, orgY));
      expect({ key, foreign: recipients.includes(foreignOnly.userId) }).toEqual({ key, foreign: false });
      expect(recipients).toContain(templateHolder.userId);
      expect(recipients).toContain(customHolder.userId);
    }
    // Mixed: counted for the key its VALID role grants, not for the foreign role's keys.
    expect(holderIds(await notifications.resolveRecipients({ kind: "permission_holders", permissionKey: ER }, orgY))).toContain(mixed.userId);
    expect(holderIds(await notifications.resolveRecipients({ kind: "permission_holders", permissionKey: APPROVE }, orgY))).not.toContain(mixed.userId);
  });

  // 3. onboarding responsibility ----------------------------------------------
  it("onboarding responsibility excludes the foreign role — assignee, reminders and Action Centre alike", async () => {
    const config = { resolver: "permission_holder" as const, permissionKey: TASK, membershipId: null };
    const resolved = await responsibility.resolveResponsibility(orgY, employeeY, config);
    expect(resolved.membershipIds).not.toContain(foreignOnly.membershipId);
    expect(resolved.membershipIds).not.toContain(mixed.membershipId);
    expect(resolved.membershipIds).toEqual(expect.arrayContaining([templateHolder.membershipId, customHolder.membershipId]));
    // isCurrentlyResponsible is what the Action Centre provider and command use;
    // reminders send to resolveResponsibility's memberships.
    expect(await responsibility.isCurrentlyResponsible(orgY, employeeY, config, foreignOnly.membershipId)).toBe(false);
    expect(await responsibility.isCurrentlyResponsible(orgY, employeeY, config, mixed.membershipId)).toBe(false);
    expect(await responsibility.isCurrentlyResponsible(orgY, employeeY, config, customHolder.membershipId)).toBe(true);
  });

  // 4. Vehicle Request approval candidates ------------------------------------
  it("Vehicle Request approval candidates exclude the foreign role", async () => {
    const ids = (await vrStages.listApprovalCandidates(orgY)).map((c) => c.membershipId);
    expect(ids).not.toContain(foreignOnly.membershipId);
    expect(ids).not.toContain(mixed.membershipId);
    expect(ids).toEqual(expect.arrayContaining([templateHolder.membershipId, customHolder.membershipId]));
    // And the foreign role's owner gains nothing from it either.
    expect(await vrStages.listApprovalCandidates(orgX)).toEqual([]);
  });

  // 5. GET /me/organizations --------------------------------------------------
  it("/me/organizations shows neither the foreign role's key nor its permissions", async () => {
    const summary = await meOrganizations(foreignOnly);
    expect(summary.roles).toEqual([]);
    expect(summary.permissions).toEqual([]);
  });

  it("/me/organizations keeps a system template and a same-org role, and drops only the foreign one from a mixed set", async () => {
    const holder = await meOrganizations(templateHolder);
    expect(holder.roles).toContain("employee");
    expect(holder.permissions).toEqual(expect.arrayContaining([APPROVE, ER, TASK]));

    const mixedSummary = await meOrganizations(mixed);
    expect(mixedSummary.roles).not.toContain("org_admin");
    expect(mixedSummary.roles).toHaveLength(1);
    expect([...mixedSummary.permissions].sort()).toEqual([ER]);
  });
});
