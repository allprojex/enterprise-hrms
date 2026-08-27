/**
 * WS-6 (§41) — an OPTIONAL synthetic integration proof, exactly as the
 * brief allows: "use WS-5's expiry contract as an optional synthetic
 * integration test if useful to prove a real domain can schedule reminders
 * without modifying WS-5 business semantics." This is a test only — no
 * production code path calls WS-5's queryExpiryState, no recurring document-
 * expiry job is registered anywhere, and WS-5's own module is not modified
 * by a single line here.
 *
 * The point being proven: a real domain primitive (WS-5's
 * `queryExpiryState`) can drive WS-6's generic `reminder.notify` job type
 * end to end — schedule, claim, execute, notify — with zero WS-6 code that
 * knows anything about documents, and zero WS-5 code that knows anything
 * about scheduling.
 *
 * IMPORTANT: run this file ALONE — see scheduledJobsLiveIntegration.test.ts's
 * header for why the WS6_LIVE_* suites must not run concurrently against
 * the same real database (claimDueJobs is deliberately unscoped, by
 * production design; never a concern in CI).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS6_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-6 x WS-5 — optional synthetic integration proof", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgId: number;
  let userId: number;

  let scheduledJobs: typeof import("../lib/scheduledJobs");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let documentRequirements: typeof import("../lib/documentRequirements");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    scheduledJobs = await import("../lib/scheduledJobs");
    jobHandlers = await import("../lib/jobHandlers");
    jobHandlers.registerShippedJobHandlers();
    documentRequirements = await import("../lib/documentRequirements");

    const suffix = `ws6-doc-${Date.now()}`;
    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS6xWS5 ${suffix}`, slug: `ws6-doc-${suffix}` }).returning();
    orgId = org.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "WS6", lastName: "Doc", organizationId: orgId })
      .returning();
    userId = user.id;
    await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: userId, organizationId: orgId, status: "active" });

    await db
      .insert(schema.masterDataDomainsTable)
      .values({ key: "document_category", label: "Document Category", classification: "organization-defined" })
      .onConflictDoNothing({ target: schema.masterDataDomainsTable.key });
    await db.insert(schema.masterDataItemsTable).values({ domain: "document_category", organizationId: orgId, code: "sample_policy", label: "Sample Policy" });
    await db.insert(schema.documentCategorySettingsTable).values({ organizationId: orgId, categoryCode: "sample_policy", expirySupported: true });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, orgId)).catch(() => undefined);
    await db.delete(schema.scheduledJobsTable).where(eq(schema.scheduledJobsTable.organizationId, orgId));
    await db.delete(schema.documentRequirementsTable).where(eq(schema.documentRequirementsTable.organizationId, orgId));
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  it("schedules a reminder.notify job from a WS-5 expiring-document finding, and it delivers a real notification — with no WS-5 code changed and no WS-6 code that knows about documents", async () => {
    // 1. A real WS-5 document requirement, expiring soon — untouched WS-5 API.
    const requirement = await documentRequirements.createRequirement({
      organizationId: orgId,
      ownerType: "organization",
      ownerId: 1,
      categoryCode: "sample_policy",
      actorApplicationUserId: userId,
      actorMembershipId: null,
    });
    await documentRequirements.markProvided({
      organizationId: orgId,
      requirementId: requirement.id,
      fulfilledDocumentTable: "organization_document_versions",
      fulfilledDocumentId: 1,
      expiryDate: "2026-09-10",
      actorApplicationUserId: userId,
      actorMembershipId: null,
    });

    const expiry = await documentRequirements.queryExpiryState(orgId, "2026-09-01", 30);
    expect(expiry.expiringSoon.some((r) => r.id === requirement.id)).toBe(true);

    // 2. A caller (standing in for a future WS-9/WS-10/WS-11 workflow, NOT
    // WS-5 or WS-6 themselves) turns that finding into a generic reminder
    // job. Nothing here is WS-6 infrastructure knowing about documents —
    // it's ordinary application code composing two already-shipped primitives.
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgId,
      jobType: "reminder.notify",
      idempotencyKey: `sample-integration:document_requirement:${requirement.id}:2026-09-10`,
      scheduledFor: new Date(),
      sourceReferenceType: "document_requirement",
      sourceReferenceId: requirement.id,
      payload: {
        recipient: { kind: "user", userId },
        title: "A document is expiring soon",
        message: "Sample Policy expires on 2026-09-10.",
        type: "warning",
        actionPath: "/documents",
      },
    });

    // 3. The worker engine (WS-6, knows nothing about documents) claims and executes it.
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "sample-integration-worker", limit: 1 });
    expect(claimed.id).toBe(job.id);
    await scheduledJobs.executeClaimedJob(claimed);

    const completed = await scheduledJobs.getScheduledJob(job.id);
    expect(completed!.status).toBe("completed");

    const notifications = await db
      .select()
      .from(schema.notificationsTable)
      .where(eq(schema.notificationsTable.sourceJobId, job.id));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(userId);
    expect(notifications[0].title).toBe("A document is expiring soon");
    expect(notifications[0].sourceReferenceType).toBe("document_requirement");
    expect(notifications[0].sourceReferenceId).toBe(requirement.id);
  });
});
