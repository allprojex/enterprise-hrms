/**
 * WS-26C governance hardening — out-of-band actor authorization for template
 * activation (live, local 5433). Skipped unless WS26_LIVE_DATABASE_URL is set.
 *
 * The activation CLI accepts actor ids for permanent audit attribution. This
 * suite proves those ids are PROVEN rather than trusted: installTemplates
 * enforces the same effective-permission and membership authority the governed
 * routes demand (form_template.manage to install, plus form_template.publish to
 * publish), and every failure happens BEFORE any template, version, stage or
 * audit row is written.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("WS-26C live: activation actor authorization", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let installer: typeof import("../lib/formEngine/templateInstaller");
  let authz: typeof import("../lib/actorAuthorization");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `authz-${Date.now().toString(36)}`;
  let seq = 0;

  /** A throwaway organization. */
  async function makeOrg(tag: string): Promise<number> {
    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `Authz ${tag} ${suffix}`, slug: `${suffix}-${tag}-${++seq}` })
      .returning();
    return org.id;
  }

  /** The permission row for a key, creating it if this database has not been seeded. */
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
   * An actor in `organizationId` holding exactly `permissionKeys`, through a
   * real org-scoped role — the same shape production RBAC uses.
   */
  async function makeActor(params: {
    organizationId: number;
    permissionKeys: string[];
    tag: string;
    platformRole?: "super_admin" | "employee";
    membershipStatus?: "active" | "revoked";
  }): Promise<{ userId: number; membershipId: number }> {
    const n = ++seq;
    const [user] = await db
      .insert(schema.usersTable)
      .values({
        email: `${params.tag}-${n}-${suffix}@example.invalid`,
        passwordHash: "x",
        firstName: params.tag,
        lastName: "Actor",
        organizationId: params.organizationId,
        ...(params.platformRole ? { role: params.platformRole } : {}),
      })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({
        applicationUserId: user.id,
        organizationId: params.organizationId,
        status: params.membershipStatus ?? "active",
      })
      .returning();
    if (params.permissionKeys.length > 0) {
      const [role] = await db
        .insert(schema.rolesTable)
        .values({
          key: `authz_${params.tag}_${n}`,
          organizationId: params.organizationId,
          label: `Authz ${params.tag} ${n}`,
          isSystemRole: false,
        })
        .returning();
      for (const key of params.permissionKeys) {
        await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await permissionId(key) });
      }
      await db.insert(schema.membershipRolesTable).values({ membershipId: membership.id, roleId: role.id });
    }
    return { userId: user.id, membershipId: membership.id };
  }

  const MANAGE = "form_template.manage";
  const PUBLISH = "form_template.publish";

  /** Every row class activation would create, for the "nothing was written" proof. */
  async function footprint(organizationId: number) {
    const templates = await db.select().from(schema.formTemplatesTable).where(eq(schema.formTemplatesTable.organizationId, organizationId));
    const versions = await db.select().from(schema.formTemplateVersionsTable).where(eq(schema.formTemplateVersionsTable.organizationId, organizationId));
    const stages = await db.select().from(schema.formWorkflowStagesTable).where(eq(schema.formWorkflowStagesTable.organizationId, organizationId));
    const audits = await db.select().from(schema.auditEventsTable).where(eq(schema.auditEventsTable.organizationId, organizationId));
    return { templates: templates.length, versions: versions.length, stages: stages.length, audits: audits.length };
  }

  const install = (organizationId: number, actor: { userId: number; membershipId: number }, publish?: boolean) =>
    installer.installTemplates({
      organizationId,
      seeds: wwm.WWM_FORM_TEMPLATES,
      actorApplicationUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      ...(publish === undefined ? {} : { publish }),
    });

  beforeAll(async () => {
    ({ eq, and } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    installer = await import("../lib/formEngine/templateInstaller");
    authz = await import("../lib/actorAuthorization");
    wwm = await import("../formTemplates/wwm");
  }, 60000);

  it("a full org-admin-equivalent actor (manage + publish) activates all four templates", async () => {
    const org = await makeOrg("ok");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "orgadmin" });
    const results = await install(org, actor);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.action === "installed" && r.published)).toBe(true);
    const after = await footprint(org);
    expect(after.templates).toBe(4);
    expect(after.stages).toBe(8); // Leave 1 + PIF 1 + Evaluation 3 + Probation 3
  });

  it("attribution records the validated actor, not merely the supplied ids", async () => {
    const org = await makeOrg("attr");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "attrib" });
    await install(org, actor);
    const runs = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, org), eq(schema.auditEventsTable.eventType, "form_template.activation_run")));
    expect(runs).toHaveLength(1);
    expect(runs[0].actorApplicationUserId).toBe(actor.userId);
    expect(runs[0].actorMembershipId).toBe(actor.membershipId);
  });

  it("an HR-administrator-equivalent actor (manage, no publish) CANNOT publish", async () => {
    const org = await makeOrg("nopub");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE], tag: "hradmin" });
    const before = await footprint(org);
    await expect(install(org, actor)).rejects.toThrow(/form_template\.publish/);
    expect(await footprint(org)).toEqual(before);
  });

  it("the same manage-only actor CAN install draft-only when that is intended", async () => {
    const org = await makeOrg("draft");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE], tag: "hradmin" });
    const results = await install(org, actor, false);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.action === "installed" && r.published === false)).toBe(true);
    const versions = await db.select().from(schema.formTemplateVersionsTable).where(eq(schema.formTemplateVersionsTable.organizationId, org));
    expect(versions).toHaveLength(4);
    expect(versions.every((v) => v.status === "draft")).toBe(true);
  });

  it("an ordinary employee without manage is denied", async () => {
    const org = await makeOrg("emp");
    const actor = await makeActor({ organizationId: org, permissionKeys: [], tag: "employee" });
    const before = await footprint(org);
    await expect(install(org, actor)).rejects.toThrow(/form_template\.manage/);
    expect(await footprint(org)).toEqual(before);
  });

  it("an actor-user / actor-membership mismatch is denied", async () => {
    const org = await makeOrg("mismatch");
    const authorized = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "real" });
    const other = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "other" });
    const before = await footprint(org);
    // Authorized user id, but somebody else's membership id.
    await expect(install(org, { userId: authorized.userId, membershipId: other.membershipId })).rejects.toThrow(/does not belong to this actor user/);
    expect(await footprint(org)).toEqual(before);
  });

  it("a membership from another organization is denied", async () => {
    const org = await makeOrg("target");
    const foreignOrg = await makeOrg("foreign");
    const foreign = await makeActor({ organizationId: foreignOrg, permissionKeys: [MANAGE, PUBLISH], tag: "foreign" });
    const before = await footprint(org);
    await expect(install(org, foreign)).rejects.toThrow(/no active membership in this organization/);
    expect(await footprint(org)).toEqual(before);
    expect((await footprint(foreignOrg)).templates).toBe(0); // and nothing leaked sideways
  });

  it("a revoked membership is denied even though its roles still carry the permissions", async () => {
    const org = await makeOrg("revoked");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "revoked", membershipStatus: "revoked" });
    const before = await footprint(org);
    await expect(install(org, actor)).rejects.toThrow(/no active membership in this organization/);
    expect(await footprint(org)).toEqual(before);
  });

  it("a disabled user is denied", async () => {
    const org = await makeOrg("disabled");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "disabled" });
    await db.update(schema.usersTable).set({ disabledAt: new Date() }).where(eq(schema.usersTable.id, actor.userId));
    const before = await footprint(org);
    await expect(install(org, actor)).rejects.toThrow(/disabled/);
    expect(await footprint(org)).toEqual(before);
  });

  it("a platform super_admin gets NO implicit bypass of tenant effective permissions", async () => {
    const org = await makeOrg("super");
    // A real, active membership in the target org — but its roles carry none of
    // the form-template keys. Platform super_admin status must not substitute.
    const actor = await makeActor({ organizationId: org, permissionKeys: [], tag: "super", platformRole: "super_admin" });
    const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, actor.userId)).limit(1);
    expect(user.role).toBe("super_admin"); // the bypass really is available to be (not) used
    const before = await footprint(org);
    await expect(install(org, actor)).rejects.toThrow(/form_template\.manage/);
    expect(await footprint(org)).toEqual(before);
  });

  it("a super_admin WITH genuine tenant authority still succeeds (authority, not identity)", async () => {
    const org = await makeOrg("superok");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "superok", platformRole: "super_admin" });
    const results = await install(org, actor);
    expect(results.every((r) => r.action === "installed")).toBe(true);
  });

  it("non-existent and invalid actor ids are denied", async () => {
    const org = await makeOrg("invalid");
    const before = await footprint(org);
    await expect(install(org, { userId: 0, membershipId: 1 })).rejects.toThrow(/actor user id is required/);
    await expect(install(org, { userId: 1, membershipId: 0 })).rejects.toThrow(/actor membership id is required/);
    await expect(install(org, { userId: -5, membershipId: -5 })).rejects.toThrow(/actor user id is required/);
    await expect(install(org, { userId: 2_000_000_000, membershipId: 2_000_000_000 })).rejects.toThrow(/Actor user does not exist/);
    expect(await footprint(org)).toEqual(before);
  });

  it("authorization runs before any mutation — a denied publish leaves no partial activation", async () => {
    const org = await makeOrg("nopartial");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE], tag: "partial" });
    await expect(install(org, actor)).rejects.toThrow();
    // Not "fewer than four" — exactly zero of every row class, including audit.
    expect(await footprint(org)).toEqual({ templates: 0, versions: 0, stages: 0, audits: 0 });
  });

  it("idempotency is preserved for an authorized actor", async () => {
    const org = await makeOrg("idem");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "idem" });
    await install(org, actor);
    const rerun = await install(org, actor);
    expect(rerun.every((r) => r.action === "already_present")).toBe(true);
    expect((await footprint(org)).templates).toBe(4);
  });

  it("authorizeActor itself is read-only and returns the validated actor", async () => {
    const org = await makeOrg("readonly");
    const actor = await makeActor({ organizationId: org, permissionKeys: [MANAGE, PUBLISH], tag: "ro" });
    const before = await footprint(org);
    const resolved = await authz.authorizeActor({
      organizationId: org,
      actorApplicationUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      requiredPermissions: [MANAGE, PUBLISH],
    });
    expect(resolved).toMatchObject({ applicationUserId: actor.userId, membershipId: actor.membershipId, organizationId: org });
    expect(resolved.permissions.has(MANAGE)).toBe(true);
    expect(await footprint(org)).toEqual(before);
  });
});
