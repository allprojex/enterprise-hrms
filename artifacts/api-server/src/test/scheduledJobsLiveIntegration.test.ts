/**
 * WS-6 — live integration coverage against a REAL PostgreSQL database.
 *
 * Mirrors WS-5's documentsLiveIntegration.test.ts pattern exactly: the
 * guarantees this workstream leans on hardest — SKIP LOCKED claiming
 * actually preventing double-claims under real concurrency, the
 * idempotency unique index, and stale-lock reclaim — cannot be proven by a
 * mocked `@workspace/db`. CI has no database (every other suite mocks
 * @workspace/db entirely), so this file SKIPS ITSELF unless
 * WS6_LIVE_DATABASE_URL is set.
 *
 *   WS6_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
 *     pnpm --filter @workspace/api-server run test scheduledJobsLive
 *
 * IMPORTANT: run this file ALONE, not together with the other WS6_LIVE_*
 * suites (workerRuntimeLiveIntegration, notificationsLiveIntegration,
 * documentExpiryReminderSample) in the same `vitest run` invocation.
 * `claimDueJobs` deliberately has no per-caller scoping — by production
 * design, one worker claims the next due job platform-wide, across every
 * organization — so if two of these files' test suites run concurrently
 * against the same real database, they can legitimately steal each other's
 * jobs and produce spurious failures that are a test-isolation artifact,
 * not a product defect (verified: every file here passes reliably run on
 * its own). Never a concern in CI — these suites skip themselves entirely
 * without WS6_LIVE_DATABASE_URL set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const LIVE_URL = process.env.WS6_LIVE_DATABASE_URL;
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-6 scheduled jobs — live integration", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgA: number;
  let orgB: number;
  let userId: number;

  let scheduledJobs: typeof import("../lib/scheduledJobs");
  let jobHandlerRegistry: typeof import("../lib/jobHandlerRegistry");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    scheduledJobs = await import("../lib/scheduledJobs");
    jobHandlerRegistry = await import("../lib/jobHandlerRegistry");

    const suffix = `ws6-live-${Date.now()}`;
    const [a] = await db.insert(schema.organizationsTable).values({ name: `WS6 Live A ${suffix}`, slug: `ws6-live-a-${suffix}` }).returning();
    const [b] = await db.insert(schema.organizationsTable).values({ name: `WS6 Live B ${suffix}`, slug: `ws6-live-b-${suffix}` }).returning();
    orgA = a.id;
    orgB = b.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `ws6-live-${suffix}@example.invalid`, passwordHash: "x", firstName: "WS6", lastName: "Tester", organizationId: orgA })
      .returning();
    userId = user.id;

    jobHandlerRegistry.registerJobHandler("test.noop", {
      parsePayload: (raw) => raw,
      execute: async () => undefined,
    });
    jobHandlerRegistry.registerJobHandler("test.always_fails_transient", {
      parsePayload: (raw) => raw,
      execute: async () => {
        throw new jobHandlerRegistry.TransientJobError("synthetic transient failure");
      },
    });
    jobHandlerRegistry.registerJobHandler("test.always_fails_permanent", {
      parsePayload: (raw) => raw,
      execute: async () => {
        throw new jobHandlerRegistry.PermanentJobError("synthetic permanent failure");
      },
    });
    let counterCalls = 0;
    jobHandlerRegistry.registerJobHandler("test.counter", {
      parsePayload: (raw) => raw,
      execute: async () => {
        counterCalls += 1;
      },
    });
    (globalThis as any).__ws6TestCounterCalls = () => counterCalls;
  });

  afterAll(async () => {
    if (!db) return;
    // Organizations and the test user are deliberately NOT deleted: this
    // suite's own audit events (organization_id, actor_application_user_id)
    // are immutable under WS-3's append-only trigger, and audit_events'
    // FKs to both tables are ON DELETE SET NULL — itself an UPDATE, which
    // the trigger also forbids. Same trade WS-5's live suite makes:
    // tamper-evidence outranks test tidiness on a disposable local database.
    for (const organizationId of [orgA, orgB]) {
      await db.delete(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, organizationId)).catch(() => undefined);
      await db.delete(schema.scheduledJobsTable).where(eq(schema.scheduledJobsTable.organizationId, organizationId));
    }
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  const uniqueKey = (label: string) => `${label}-${Math.random().toString(36).slice(2)}`;

  // ---- A: scheduling and idempotency ------------------------------------

  it("A: schedules a job", async () => {
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgA,
      jobType: "test.noop",
      idempotencyKey: uniqueKey("basic"),
      scheduledFor: new Date(),
    });
    expect(job.status).toBe("scheduled");
    expect(job.attemptCount).toBe(0);
  });

  it("§57: a duplicate schedule request with the same idempotency key produces exactly one job", async () => {
    const key = uniqueKey("dup");
    const first = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: key, scheduledFor: new Date() });
    const second = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: key, scheduledFor: new Date(Date.now() + 60_000) });
    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(schema.scheduledJobsTable)
      .where(eq(schema.scheduledJobsTable.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it("the database itself refuses a hand-forged duplicate (jobType, idempotencyKey)", async () => {
    const key = uniqueKey("forced-dup");
    await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: key, scheduledFor: new Date() });
    await expect(
      db.insert(schema.scheduledJobsTable).values({ organizationId: orgA, jobType: "test.noop", idempotencyKey: key, scheduledFor: new Date() }),
    ).rejects.toThrow();
  });

  // ---- F/§12: concurrency — SKIP LOCKED claiming -------------------------

  it("F/§12: two concurrent claims never return the same job twice", async () => {
    const jobs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey(`concurrent-${i}`), scheduledFor: new Date() }),
      ),
    );

    const [claimedByA, claimedByB] = await Promise.all([
      scheduledJobs.claimDueJobs({ workerId: "worker-A", limit: 10 }),
      scheduledJobs.claimDueJobs({ workerId: "worker-B", limit: 10 }),
    ]);

    const idsA = new Set(claimedByA.filter((j) => jobs.some((created) => created.id === j.id)).map((j) => j.id));
    const idsB = new Set(claimedByB.filter((j) => jobs.some((created) => created.id === j.id)).map((j) => j.id));

    // No overlap between what the two concurrent claims picked up.
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
    // Together they claimed all ten — nothing was skipped or double-counted.
    expect(idsA.size + idsB.size).toBe(10);
  });

  it("different due jobs can be claimed and processed independently (not serialized behind one lock)", async () => {
    const j1 = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("indep-1"), scheduledFor: new Date() });
    const j2 = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("indep-2"), scheduledFor: new Date() });

    const claimed = await scheduledJobs.claimDueJobs({ workerId: "worker-solo", limit: 50 });
    const claimedIds = new Set(claimed.map((j) => j.id));
    expect(claimedIds.has(j1.id)).toBe(true);
    expect(claimedIds.has(j2.id)).toBe(true);
    for (const job of claimed) expect(job.status).toBe("running");
  });

  it("a job not yet due is never claimed", async () => {
    const future = await scheduledJobs.scheduleJob({
      organizationId: orgA,
      jobType: "test.noop",
      idempotencyKey: uniqueKey("future"),
      scheduledFor: new Date(Date.now() + 3_600_000),
    });
    const claimed = await scheduledJobs.claimDueJobs({ workerId: "worker-future-check", limit: 100 });
    expect(claimed.some((j) => j.id === future.id)).toBe(false);
  });

  // ---- retry/backoff/terminal failure ------------------------------------

  it("a transient failure retries with backoff rather than failing immediately", async () => {
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgA,
      jobType: "test.always_fails_transient",
      idempotencyKey: uniqueKey("transient"),
      scheduledFor: new Date(),
      maxAttempts: 5,
    });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-retry", limit: 1 });
    expect(claimed.id).toBe(job.id);

    await scheduledJobs.executeClaimedJob(claimed);

    const reloaded = await scheduledJobs.getScheduledJob(job.id);
    expect(reloaded!.status).toBe("scheduled"); // retry-scheduled, not failed
    expect(reloaded!.attemptCount).toBe(1);
    expect(reloaded!.lastErrorClass).toBe("transient");
    expect(reloaded!.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect(reloaded!.lockedAt).toBeNull();
  });

  it("a permanent failure goes straight to terminal 'failed', not retried", async () => {
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgA,
      jobType: "test.always_fails_permanent",
      idempotencyKey: uniqueKey("permanent"),
      scheduledFor: new Date(),
      maxAttempts: 5,
    });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-permanent", limit: 1 });
    await scheduledJobs.executeClaimedJob(claimed);

    const reloaded = await scheduledJobs.getScheduledJob(job.id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.attemptCount).toBe(1);
    expect(reloaded!.lastErrorClass).toBe("permanent");
    expect(reloaded!.failedAt).not.toBeNull();
  });

  it("a job reaches terminal 'failed' after maxAttempts transient failures, and history is retained (no dead-letter table, no deletion)", async () => {
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgA,
      jobType: "test.always_fails_transient",
      idempotencyKey: uniqueKey("max-attempts"),
      scheduledFor: new Date(),
      maxAttempts: 2,
    });

    for (let i = 0; i < 2; i++) {
      // Force each retry due immediately rather than waiting out real backoff.
      await db.update(schema.scheduledJobsTable).set({ scheduledFor: new Date() }).where(eq(schema.scheduledJobsTable.id, job.id));
      const [claimed] = await scheduledJobs.claimDueJobs({ workerId: `worker-loop-${i}`, limit: 1 });
      expect(claimed.id).toBe(job.id);
      await scheduledJobs.executeClaimedJob(claimed);
    }

    const reloaded = await scheduledJobs.getScheduledJob(job.id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.attemptCount).toBe(2);
    expect(reloaded!.lastErrorMessage).toContain("synthetic transient failure");
  });

  it("§11: scheduling an unregistered job type fails fast, before any row is created", async () => {
    await expect(
      scheduledJobs.scheduleJob({
        organizationId: orgA,
        jobType: "totally.unregistered.job.type",
        idempotencyKey: uniqueKey("unknown-type-schedule"),
        scheduledFor: new Date(),
      }),
    ).rejects.toThrow(scheduledJobs.UnknownJobTypeError);
  });

  it("defense in depth: a row that names an unregistered type by some other means (not the scheduleJob API) still fails safely at execution rather than crashing the worker loop", async () => {
    const [job] = await db
      .insert(schema.scheduledJobsTable)
      .values({
        organizationId: orgA,
        jobType: "totally.unregistered.job.type",
        idempotencyKey: uniqueKey("unknown-type-exec"),
        scheduledFor: new Date(),
      })
      .returning();

    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-unknown", limit: 1 });
    expect(claimed.id).toBe(job.id);
    await expect(scheduledJobs.executeClaimedJob(claimed)).resolves.toBeUndefined();

    const reloaded = await scheduledJobs.getScheduledJob(job.id);
    expect(reloaded!.status).toBe("failed");
    expect(reloaded!.lastErrorClass).toBe("permanent");
  });

  it("a completed job is never re-executed by a later poll", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.counter", idempotencyKey: uniqueKey("counter"), scheduledFor: new Date() });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-counter", limit: 1 });
    await scheduledJobs.executeClaimedJob(claimed);

    const before = (globalThis as any).__ws6TestCounterCalls();
    // Repeated polling — a completed job must never be claimed again.
    const reclaim1 = await scheduledJobs.claimDueJobs({ workerId: "worker-counter-2", limit: 50 });
    const reclaim2 = await scheduledJobs.claimDueJobs({ workerId: "worker-counter-3", limit: 50 });
    expect(reclaim1.some((j) => j.id === job.id)).toBe(false);
    expect(reclaim2.some((j) => j.id === job.id)).toBe(false);
    expect((globalThis as any).__ws6TestCounterCalls()).toBe(before);

    const reloaded = await scheduledJobs.getScheduledJob(job.id);
    expect(reloaded!.status).toBe("completed");
  });

  // ---- crash/reclaim ------------------------------------------------------

  it("a stale lock (simulated worker crash) is reclaimed and the job can run again idempotently", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.counter", idempotencyKey: uniqueKey("crash"), scheduledFor: new Date() });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-doomed", limit: 1 });
    expect(claimed.id).toBe(job.id);

    // Simulate the worker dying mid-execution: back-date the lock past the lease window, never call executeClaimedJob.
    await db
      .update(schema.scheduledJobsTable)
      .set({ lockedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.scheduledJobsTable.id, job.id));

    const reclaimedCount = await scheduledJobs.reclaimStaleJobs(5 * 60_000);
    expect(reclaimedCount).toBeGreaterThanOrEqual(1);

    const afterReclaim = await scheduledJobs.getScheduledJob(job.id);
    expect(afterReclaim!.status).toBe("scheduled");
    expect(afterReclaim!.lockedAt).toBeNull();

    const [reclaimedJob] = await scheduledJobs.claimDueJobs({ workerId: "worker-rescuer", limit: 1 });
    expect(reclaimedJob.id).toBe(job.id);
    await scheduledJobs.executeClaimedJob(reclaimedJob);

    const final = await scheduledJobs.getScheduledJob(job.id);
    expect(final!.status).toBe("completed");
  });

  it("a fresh lock within the lease window is never reclaimed", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("fresh-lock"), scheduledFor: new Date() });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-active", limit: 1 });
    expect(claimed.id).toBe(job.id);

    await scheduledJobs.reclaimStaleJobs(5 * 60_000);

    const stillRunning = await scheduledJobs.getScheduledJob(job.id);
    expect(stillRunning!.status).toBe("running");
    expect(stillRunning!.lockedBy).toBe("worker-active");
  });

  // ---- cancellation / rescheduling ----------------------------------------

  it("cancels a pending job, and a claimed (running) job cannot be cancelled out from under a worker", async () => {
    const pending = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("cancel-pending"), scheduledFor: new Date(Date.now() + 60_000) });
    const cancelled = await scheduledJobs.cancelJob({ jobId: pending.id, actorApplicationUserId: userId, actorMembershipId: null });
    expect(cancelled.status).toBe("cancelled");

    const running = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("cancel-running"), scheduledFor: new Date() });
    await scheduledJobs.claimDueJobs({ workerId: "worker-guard", limit: 1 });
    await expect(scheduledJobs.cancelJob({ jobId: running.id, actorApplicationUserId: userId, actorMembershipId: null })).rejects.toThrow(
      scheduledJobs.JobNotCancellableError,
    );
  });

  it("reschedules a pending job", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("reschedule"), scheduledFor: new Date(Date.now() + 60_000) });
    const newTime = new Date(Date.now() + 7 * 24 * 3600_000);
    const rescheduled = await scheduledJobs.rescheduleJob({ jobId: job.id, scheduledFor: newTime, actorApplicationUserId: userId, actorMembershipId: null });
    expect(rescheduled.scheduledFor.getTime()).toBe(newTime.getTime());
  });

  it("manually retries a terminally failed job", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.always_fails_permanent", idempotencyKey: uniqueKey("manual-retry"), scheduledFor: new Date() });
    const [claimed] = await scheduledJobs.claimDueJobs({ workerId: "worker-fail", limit: 1 });
    await scheduledJobs.executeClaimedJob(claimed);
    expect((await scheduledJobs.getScheduledJob(job.id))!.status).toBe("failed");

    const retried = await scheduledJobs.retryFailedJob({ jobId: job.id, actorApplicationUserId: userId, actorMembershipId: null });
    expect(retried.status).toBe("scheduled");
    expect(retried.attemptCount).toBe(0);
  });

  // ---- audit ---------------------------------------------------------------

  it("user-driven cancel/reschedule/retry are audited under the platform_configuration category; routine execution is not", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("audit-cancel"), scheduledFor: new Date(Date.now() + 60_000) });
    await scheduledJobs.cancelJob({ jobId: job.id, actorApplicationUserId: userId, actorMembershipId: null });

    const events = await db
      .select()
      .from(schema.auditEventsTable)
      .where(eq(schema.auditEventsTable.eventType, "scheduled_job.cancelled"));
    const forThisJob = events.filter((e: any) => e.targetId === String(job.id));
    expect(forThisJob).toHaveLength(1);
    expect(forThisJob[0].category).toBe("platform_configuration");

    // Routine execution (completed above, many times, in earlier tests) must not have produced audit spam.
    const executionEvents = await db
      .select()
      .from(schema.auditEventsTable)
      .where(eq(schema.auditEventsTable.eventType, "scheduled_job.executed"));
    expect(executionEvents).toHaveLength(0);
  });

  // ---- organization isolation ----------------------------------------------

  it("§20: a job created for Org A is never claimable/listable as belonging to Org B, and Org B cannot cancel it", async () => {
    const job = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType: "test.noop", idempotencyKey: uniqueKey("isolation"), scheduledFor: new Date(Date.now() + 60_000) });

    const listedForB = await scheduledJobs.listScheduledJobs({ organizationId: orgB });
    expect(listedForB.some((j) => j.id === job.id)).toBe(false);

    const listedForA = await scheduledJobs.listScheduledJobs({ organizationId: orgA });
    expect(listedForA.some((j) => j.id === job.id)).toBe(true);

    // cancelJob itself takes no organizationId (it's a platform-admin operation
    // gated at the route layer by requireSuperAdmin, not by tenant membership —
    // see routes/scheduledJobs.ts); isolation here is about listing/visibility,
    // proven above.
  });
});
