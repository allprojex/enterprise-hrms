/**
 * WS-6 — the worker process entrypoint. Separate runtime command from the
 * web server (§8/§49 of the brief), built from the same source and image:
 * `node dist/worker.mjs` alongside `node dist/index.mjs` (see build.mjs's
 * second entry point, package.json's `worker` script, and
 * docs/SCHEDULED_JOBS_AND_NOTIFICATIONS.md for the Docker/compose command).
 * HTTP traffic never runs due jobs opportunistically — only this process
 * ever claims and executes a scheduled_jobs row.
 *
 * The actual poll/reclaim/shutdown logic lives in lib/workerRuntime.ts,
 * where it is directly unit-testable independent of OS signal delivery;
 * this file only wires that runtime to the real environment and process
 * signals.
 */
import { randomUUID } from "crypto";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { registerShippedJobHandlers } from "./lib/jobHandlers";
import { createWorkerRuntime } from "./lib/workerRuntime";

// installationKey (WS-4 deployment identity) + a fresh id for this process +
// this process's OS pid — enough to tell "which deployment, which process
// restart, which OS process" apart in lockedBy without any new identity
// table (§40/§47: WS-4 models deployment identity, not per-process identity;
// nothing here invents fleet orchestration, it only labels a text column).
const WORKER_ID = `${process.env.INSTALLATION_KEY ?? "local"}:${process.pid}:${randomUUID().slice(0, 8)}`;

registerShippedJobHandlers();

const runtime = createWorkerRuntime({
  workerId: WORKER_ID,
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000),
  claimBatchSize: Number(process.env.WORKER_CLAIM_BATCH_SIZE ?? 10),
  // Deliberately generous relative to any expected handler runtime (§28):
  // the cost of reclaiming too early is a job running twice concurrently
  // for the remainder of a merely-slow attempt; the cost of reclaiming too
  // late is only a delayed retry. This platform's own job handlers do not
  // run anywhere near this long today.
  reclaimLeaseMs: Number(process.env.WORKER_RECLAIM_LEASE_MS ?? 10 * 60_000),
  reclaimIntervalMs: Number(process.env.WORKER_RECLAIM_INTERVAL_MS ?? 60_000),
  shutdownGraceMs: Number(process.env.WORKER_SHUTDOWN_GRACE_MS ?? 30_000),
  onEvent: (event, meta) => {
    const level = event === "job_execution_unexpected_error" || event === "reclaim_failed" || event === "poll_cycle_failed" ? "error" : "info";
    logger[level](meta, `worker: ${event}`);
  },
  onShutdownComplete: () => pool.end(),
});

process.on("SIGTERM", () => void runtime.shutdown("SIGTERM").then(() => process.exit(0)));
process.on("SIGINT", () => void runtime.shutdown("SIGINT").then(() => process.exit(0)));
