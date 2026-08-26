/**
 * WS-6 (§50) — the worker's poll/reclaim loop and graceful shutdown,
 * extracted from src/worker.ts into a plain function so it is directly unit
 * -testable without depending on OS signal delivery. `worker.ts` itself is
 * now a thin entrypoint: it calls `createWorkerRuntime` and wires
 * `process.on("SIGTERM"/"SIGINT", ...)` to the returned `shutdown()`.
 *
 * This split matters because real OS signal delivery is platform-dependent
 * in ways irrelevant to whether this code is correct: Node's
 * `process.on("SIGTERM")` works normally on the Linux containers this
 * platform actually deploys to (Docker/VPS, per WS-1), but is not
 * reliably deliverable to an arbitrary external process on Windows dev
 * machines. Testing the shutdown *logic* directly — stop claiming, drain
 * the in-flight batch within a bound, close the pool — is both more
 * reliable and more precise than trying to prove OS signal plumbing works,
 * which is Node's own responsibility, not this workstream's.
 */
import { claimDueJobs, executeClaimedJob, reclaimStaleJobs } from "./scheduledJobs";

export interface WorkerRuntimeOptions {
  workerId: string;
  pollIntervalMs: number;
  claimBatchSize: number;
  reclaimLeaseMs: number;
  reclaimIntervalMs: number;
  shutdownGraceMs: number;
  onEvent?: (event: string, meta: Record<string, unknown>) => void;
  /** Injected so a test can close a test-scoped pool instead of the module-level one, or skip pool teardown entirely. */
  onShutdownComplete?: () => Promise<void>;
}

export interface WorkerRuntime {
  shutdown: (signal: string) => Promise<void>;
  /** Test-only: true once no further polling will be scheduled. */
  isShuttingDown: () => boolean;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const emit = (event: string, meta: Record<string, unknown> = {}) => options.onEvent?.(event, { workerId: options.workerId, ...meta });

  let shuttingDown = false;
  let activeBatch: Promise<void> = Promise.resolve();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let reclaimTimer: ReturnType<typeof setInterval> | undefined;

  async function pollOnce(): Promise<void> {
    const claimed = await claimDueJobs({ workerId: options.workerId, limit: options.claimBatchSize });
    if (claimed.length === 0) return;
    emit("jobs_claimed", { count: claimed.length });

    for (const job of claimed) {
      const startedAt = Date.now();
      try {
        await executeClaimedJob(job);
      } catch (err) {
        emit("job_execution_unexpected_error", { jobId: job.id, jobType: job.jobType, err: err instanceof Error ? err.message : String(err) });
      }
      emit("job_attempt_finished", { jobId: job.id, jobType: job.jobType, durationMs: Date.now() - startedAt });
    }
  }

  function scheduleNextPoll(): void {
    if (shuttingDown) return;
    pollTimer = setTimeout(() => {
      activeBatch = pollOnce()
        .catch((err) => emit("poll_cycle_failed", { err: err instanceof Error ? err.message : String(err) }))
        .finally(scheduleNextPoll);
    }, options.pollIntervalMs);
  }

  async function runReclaim(): Promise<void> {
    try {
      const count = await reclaimStaleJobs(options.reclaimLeaseMs);
      if (count > 0) emit("stale_jobs_reclaimed", { count, leaseMs: options.reclaimLeaseMs });
    } catch (err) {
      emit("reclaim_failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    emit("shutting_down", { signal });

    if (pollTimer) clearTimeout(pollTimer);
    if (reclaimTimer) clearInterval(reclaimTimer);

    await Promise.race([activeBatch, new Promise((resolve) => setTimeout(resolve, options.shutdownGraceMs))]);

    if (options.onShutdownComplete) await options.onShutdownComplete();
    emit("shutdown_complete", {});
  }

  emit("started", {
    pollIntervalMs: options.pollIntervalMs,
    reclaimLeaseMs: options.reclaimLeaseMs,
  });
  reclaimTimer = setInterval(() => void runReclaim(), options.reclaimIntervalMs);
  void runReclaim();
  scheduleNextPoll();

  return { shutdown, isShuttingDown: () => shuttingDown };
}
