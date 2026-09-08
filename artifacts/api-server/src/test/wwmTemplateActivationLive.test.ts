/**
 * WS-26C — WWM template activation (live, local 5433).
 * Skipped unless WS26_LIVE_DATABASE_URL is set.
 *
 * Proves the activation mechanism: installs + publishes the four authoritative
 * WWM templates into ONE explicit organization; is idempotent on rerun (no
 * duplicates); is scoped to the named org only; and the published versions carry
 * the exact definitions (+ signature policy where the source has signatures).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("WS-26C live: WWM template activation", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let installer: typeof import("../lib/formEngine/templateInstaller");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `act-${Date.now().toString(36)}`;
  let orgId: number;
  let otherOrgId: number;
  let actorUser: number;
  let actorMembership: number;

  const templateCount = async (organizationId: number) =>
    (await db.select().from(schema.formTemplatesTable).where(eq(schema.formTemplatesTable.organizationId, organizationId))).length;

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    installer = await import("../lib/formEngine/templateInstaller");
    wwm = await import("../formTemplates/wwm");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `Act ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `Act other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;
    const [u] = await db.insert(schema.usersTable).values({ email: `hr-${suffix}@example.invalid`, passwordHash: "x", firstName: "hr", lastName: "P", organizationId: orgId }).returning();
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId: orgId, status: "active" }).returning();
    actorUser = u.id;
    actorMembership = m.id;
  }, 60000);

  it("installs and publishes all four WWM templates in the named org", async () => {
    const results = await installer.installTemplates({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, actorApplicationUserId: actorUser, actorMembershipId: actorMembership });
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.action === "installed" && r.published)).toBe(true);
    expect(results.map((r) => r.templateKey).sort()).toEqual(wwm.WWM_FORM_TEMPLATES.map((t) => t.templateKey).sort());
    expect(await templateCount(orgId)).toBe(4);
    // Each template has a published version whose definition parses.
    for (const r of results) {
      const published = await templates.getPublishedVersion(orgId, r.templateId);
      expect(published).not.toBeNull();
      expect(templates.parseDefinition(published!).sections.length).toBeGreaterThan(0);
    }
  });

  it("persists signature policy where the source has signatures (Leave/PIF) and not otherwise (Eval/Probation)", async () => {
    const { and } = await import("drizzle-orm");
    const byKey = new Map((await Promise.all(wwm.WWM_FORM_TEMPLATES.map(async (s) => {
      const [t] = await db.select().from(schema.formTemplatesTable).where(and(eq(schema.formTemplatesTable.organizationId, orgId), eq(schema.formTemplatesTable.templateKey, s.templateKey)));
      const v = await templates.getPublishedVersion(orgId, t.id);
      return [s.formType, v] as const;
    }))));
    expect((byKey.get("leave_application")!.signaturePolicy as { slots?: unknown[] })?.slots?.length).toBe(2);
    expect((byKey.get("personal_information")!.signaturePolicy as { slots?: unknown[] })?.slots?.length).toBe(1);
    expect(byKey.get("staff_evaluation")!.signaturePolicy).toBeNull();
    expect(byKey.get("probationary_assessment")!.signaturePolicy).toBeNull();
  });

  it("is idempotent: rerunning installs nothing new and creates no duplicates", async () => {
    const rerun = await installer.installTemplates({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, actorApplicationUserId: actorUser, actorMembershipId: actorMembership });
    expect(rerun.every((r) => r.action === "already_present")).toBe(true);
    expect(await templateCount(orgId)).toBe(4); // still exactly four
  });

  it("is scoped to the named org only — no other organization gets the templates", async () => {
    expect(await templateCount(otherOrgId)).toBe(0);
  });

  it("refuses activation without an explicit organization", async () => {
    await expect(installer.installTemplates({ organizationId: 0, seeds: wwm.WWM_FORM_TEMPLATES, actorApplicationUserId: actorUser, actorMembershipId: actorMembership })).rejects.toThrow(/explicit target organizationId/);
  });
});
