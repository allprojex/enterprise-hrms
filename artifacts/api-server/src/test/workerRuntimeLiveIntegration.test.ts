/**
 * WS-6 (§50, §61-62) — live coverage for the worker's poll/shutdown loop
 * itself (lib/workerRuntime.ts), as opposed to scheduledJobsLiveIntegration
 * .test.ts's coverage of the underlying claim/execute/reclaim primitives.
 *
 * This does not test OS signal delivery (SIGTERM/SIGINT plumbing is Node's
 * own responsibility, and is not reliably testable across the Windows dev
 * environment this workstream was authored in vs. the Linux containers it
 * actually deploys to) — it calls `shutdown()` directly, which is exactly
 * what `worker.ts`'s signal handlers do, so this proves the same code path
 * a real SIGTERM would trigger.
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

describeLive("WS-6 worker runtime — live integration", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgA: number;

  let createWorkerRuntime: typeof import("../lib/workerRuntime").createWorkerRuntime;
  let scheduledJobs: typeof import("../lib/scheduledJobs");
  let jobHandlerRegistry: typeof import("../lib/jobHandlerRegistry");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    ({ createWorkerRuntime } = await import("../lib/workerRuntime"));
    scheduledJobs = await import("../lib/scheduledJobs");
    jobHandlerRegistry = await import("../lib/jobHandlerRegistry");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS6 Worker Live ${Date.now()}`, slug: `ws6-worker-live-${Date.now()}` })
      .returning();
    orgA = org.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.scheduledJobsTable).where(eq(schema.scheduledJobsTable.organizationId, orgA));
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  it("claims and completes a due job within a couple of poll cycles, then shuts down cleanly", async () => {
    const jobType = `test.worker.slow.${Date.now()}`;
    let executed = 0;
    jobHandlerRegistry.registerJobHandler(jobType, {
      parsePayload: (raw) => raw,
      execute: async () => {
        executed += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    });

    await scheduledJobs.scheduleJob({ organizationId: orgA, jobType, idempotencyKey: `worker-loop-${Date.now()}`, scheduledFor: new Date() });

    const events: string[] = [];
    const runtime = createWorkerRuntime({
      workerId: "test-worker-1",
      pollIntervalMs: 100,
      claimBatchSize: 10,
      reclaimLeaseMs: 60_000,
      reclaimIntervalMs: 60_000,
      shutdownGraceMs: 2_000,
      onEvent: (event) => events.push(event),
    });

    // Poll for completion rather than a fixed sleep — under parallel test-file
    // CPU/DB contention a fixed short wait can flake even though the engine
    // itself is correct (confirmed: this file passes reliably in isolation).
    const deadline = Date.now() + 10_000;
    while (executed === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await runtime.shutdown("TEST");

    expect(executed).toBe(1);
    expect(events).toContain("started");
    expect(events).toContain("jobs_claimed");
    expect(events).toContain("job_attempt_finished");
    expect(events).toContain("shutting_down");
    expect(events).toContain("shutdown_complete");
    expect(runtime.isShuttingDown()).toBe(true);
  });

  it("§50: shutdown waits for an in-flight job to finish within the grace window rather than abandoning it mid-execution", async () => {
    const jobType = `test.worker.graceful.${Date.now()}`;
    let completedAt: number | null = null;
    jobHandlerRegistry.registerJobHandler(jobType, {
      parsePayload: (raw) => raw,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        completedAt = Date.now();
      },
    });

    const scheduled = await scheduledJobs.scheduleJob({ organizationId: orgA, jobType, idempotencyKey: `worker-graceful-${Date.now()}`, scheduledFor: new Date() });

    const runtime = createWorkerRuntime({
      workerId: "test-worker-2",
      pollIntervalMs: 50,
      claimBatchSize: 10,
      reclaimLeaseMs: 60_000,
      reclaimIntervalMs: 60_000,
      shutdownGraceMs: 5_000, // comfortably longer than the 300ms handler
      onEvent: () => undefined,
    });

    // Wait until the job is actually claimed (status flips to 'running')
    // before shutting down, rather than a fixed sleep guessing the poll
    // loop has fired by then — under parallel test-file contention a fixed
    // short wait could shut down before the first poll even runs, which
    // would trivially (and wrongly) "pass" by never executing the handler
    // at all.
    const claimDeadline = Date.now() + 10_000;
    let job = await scheduledJobs.getScheduledJob(scheduled.id);
    while (job?.status !== "running" && Date.now() < claimDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await scheduledJobs.getScheduledJob(scheduled.id);
    }
    expect(job?.status).toBe("running");

    const shutdownStartedAt = Date.now();
    await runtime.shutdown("TEST");

    expect(completedAt).not.toBeNull();
    // shutdown() did not return until after the handler's own completion.
    expect(completedAt!).toBeGreaterThanOrEqual(shutdownStartedAt);
  });

  it("after shutdown, no further polling occurs (isShuttingDown reflects it and no new claims happen)", async () => {
    const jobType = `test.worker.after-shutdown.${Date.now()}`;
    let calls = 0;
    jobHandlerRegistry.registerJobHandler(jobType, {
      parsePayload: (raw) => raw,
      execute: async () => {
        calls += 1;
      },
    });

    const runtime = createWorkerRuntime({
      workerId: "test-worker-3",
      pollIntervalMs: 50,
      claimBatchSize: 10,
      reclaimLeaseMs: 60_000,
      reclaimIntervalMs: 60_000,
      shutdownGraceMs: 1_000,
      onEvent: () => undefined,
    });

    await runtime.shutdown("TEST");
    expect(runtime.isShuttingDown()).toBe(true);

    // Schedule a due job only AFTER this runtime has already shut down —
    // it must never be claimed by a runtime that has stopped polling.
    await scheduledJobs.scheduleJob({ organizationId: orgA, jobType, idempotencyKey: `after-shutdown-${Date.now()}`, scheduledFor: new Date() });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(0);
  });
});
