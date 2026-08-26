/**
 * WS-6 (Scheduled Jobs / Notifications Foundation, Owner Decision #13) — the
 * scheduling/claiming/execution engine.
 *
 * Scheduler technology decision (documented per the brief's §7 instruction):
 * DB-backed jobs claimed by a dedicated worker loop (option A of the three
 * the brief offered), using Postgres `UPDATE ... FOR UPDATE SKIP LOCKED`
 * for claiming. No Redis/Kafka/RabbitMQ, no queue library (BullMQ/Agenda),
 * no cron package. Reasoning, grounded in verified repository reality rather
 * than a generic preference:
 *
 *   - Zero scheduling/queue infrastructure exists anywhere in this codebase
 *     today (confirmed by repo-wide search, not assumed from the frozen
 *     review alone), and this repository already has a live, working
 *     precedent for exactly this style of Postgres-native concurrency
 *     control: `pg_advisory_xact_lock` is used for exclusive sections in
 *     officeInventoryLedger.ts/payrollPeriods.ts/payrollRuns.ts, and
 *     `FOR UPDATE` row-locking is used throughout (numbering.ts,
 *     departmentHeads.ts, learningEnrollments.ts). `SKIP LOCKED` is the
 *     same family of primitive, one step further — multiple workers each
 *     grab a *different* row instead of one worker exclusively locking a
 *     whole resource. This introduces one new SQL clause, not a new
 *     architecture.
 *   - This is a single Postgres database the application already requires
 *     for every deployment topology named in the brief (shared SaaS,
 *     dedicated VPS, customer-managed) — adding a message broker would be a
 *     second piece of infrastructure every one of those deployments would
 *     newly have to provision, secure, and keep available, for a workload
 *     (HR reminders/overdue checks, not high-frequency event streaming)
 *     that a polling worker against an indexed table serves comfortably.
 *   - `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`'s own prior, still-frozen
 *     statement — "none exists... per the explicit exclusion of 'complex
 *     queue platform'" — already ruled out exactly that kind of heavier
 *     dependency for this platform.
 *
 * Process model: web and worker are separate runtime commands built from the
 * same source (see src/worker.ts and build.mjs's second entry point) — HTTP
 * traffic never opportunistically runs due jobs (§8 of the brief). The web
 * process only ever creates/updates rows via the functions below; only the
 * worker process claims and executes them.
 */
import { and, eq, isNull, lt, desc, sql, type SQL } from "drizzle-orm";
import { db, scheduledJobsTable, type ScheduledJob } from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";
import { recordAuditEvent } from "./auditLog";
import { getJobHandler, TransientJobError, PermanentJobError } from "./jobHandlerRegistry";

export class UnknownJobTypeError extends Error {
  constructor(jobType: string) {
    super(`"${jobType}" is not a registered job type`);
    this.name = "UnknownJobTypeError";
  }
}

export class ScheduledJobNotFoundError extends Error {
  constructor() {
    super("Scheduled job not found");
    this.name = "ScheduledJobNotFoundError";
  }
}

export class JobNotCancellableError extends Error {
  constructor() {
    super("Only a job in 'scheduled' status can be cancelled");
    this.name = "JobNotCancellableError";
  }
}

export class JobNotReschedulableError extends Error {
  constructor() {
    super("Only a job in 'scheduled' status can be rescheduled");
    this.name = "JobNotReschedulableError";
  }
}

export class JobNotRetryableError extends Error {
  constructor() {
    super("Only a job in 'failed' status can be manually retried");
    this.name = "JobNotRetryableError";
  }
}

export interface ScheduleJobParams {
  organizationId: number | null;
  jobType: string;
  idempotencyKey: string;
  scheduledFor: Date;
  sourceReferenceType?: string | null;
  sourceReferenceId?: number | null;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
  createdBy?: number | null;
}

/**
 * Creates a scheduled job, or returns the existing one if `idempotencyKey`
 * already exists for this `jobType` (§13/§57: a duplicate schedule request
 * must produce exactly one row, never a second one and never an error).
 *
 * This is pure deduplication, not a reset: if the existing job already
 * completed, failed, or was cancelled, calling this again with the same key
 * returns that row as-is — it does not resurrect or re-run it. A caller
 * that wants a fresh attempt at the same logical occurrence uses a new key
 * (e.g. one that encodes a later occurrence date).
 *
 * Rejects an unregistered `jobType` immediately (§11: "unknown job types
 * fail safely") — a typo'd job type fails loudly at the call site instead
 * of silently creating a row that can only ever fail once a worker claims
 * it.
 */
export async function scheduleJob(params: ScheduleJobParams): Promise<ScheduledJob> {
  if (!getJobHandler(params.jobType)) throw new UnknownJobTypeError(params.jobType);

  try {
    const [job] = await db
      .insert(scheduledJobsTable)
      .values({
        organizationId: params.organizationId,
        jobType: params.jobType,
        idempotencyKey: params.idempotencyKey,
        scheduledFor: params.scheduledFor,
        sourceReferenceType: params.sourceReferenceType ?? null,
        sourceReferenceId: params.sourceReferenceId ?? null,
        payload: params.payload ?? null,
        priority: params.priority ?? 0,
        maxAttempts: params.maxAttempts ?? 5,
        createdBy: params.createdBy ?? null,
      })
      .returning();
    return job;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db
      .select()
      .from(scheduledJobsTable)
      .where(and(eq(scheduledJobsTable.jobType, params.jobType), eq(scheduledJobsTable.idempotencyKey, params.idempotencyKey)))
      .limit(1);
    // The row that just lost the race is guaranteed to exist by the
    // constraint that raised the violation; absent here would mean it was
    // deleted between the failed insert and this read, which no code path
    // in this codebase does (scheduled_jobs rows are never hard-deleted).
    return existing;
  }
}

export async function getScheduledJob(jobId: number): Promise<ScheduledJob | null> {
  const [row] = await db.select().from(scheduledJobsTable).where(eq(scheduledJobsTable.id, jobId)).limit(1);
  return row ?? null;
}

export interface ListScheduledJobsFilters {
  organizationId?: number;
  status?: ScheduledJob["status"];
  jobType?: string;
  limit?: number;
  offset?: number;
}

/** Read-only listing for the platform admin surface — never claims, never locks. */
export async function listScheduledJobs(filters: ListScheduledJobsFilters = {}): Promise<ScheduledJob[]> {
  const conditions: SQL[] = [];
  if (filters.organizationId !== undefined) conditions.push(eq(scheduledJobsTable.organizationId, filters.organizationId));
  if (filters.status) conditions.push(eq(scheduledJobsTable.status, filters.status));
  if (filters.jobType) conditions.push(eq(scheduledJobsTable.jobType, filters.jobType));

  return db
    .select()
    .from(scheduledJobsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(scheduledJobsTable.createdAt))
    .limit(Math.min(filters.limit ?? 50, 200))
    .offset(filters.offset ?? 0);
}

/** User-driven cancellation of pending work. Concurrency-safe: the WHERE clause only matches a row still in 'scheduled' status, so a job a worker just claimed cannot be cancelled out from under it. */
export async function cancelJob(params: {
  jobId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<ScheduledJob> {
  const [row] = await db
    .update(scheduledJobsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(eq(scheduledJobsTable.id, params.jobId), eq(scheduledJobsTable.status, "scheduled")))
    .returning();

  if (!row) {
    const existing = await getScheduledJob(params.jobId);
    if (!existing) throw new ScheduledJobNotFoundError();
    throw new JobNotCancellableError();
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: row.organizationId,
    eventType: "scheduled_job.cancelled",
    targetType: "scheduled_job",
    targetId: String(row.id),
    metadata: { jobType: row.jobType },
  });

  return row;
}

/** User-driven reschedule of pending work — same concurrency guard as cancelJob. */
export async function rescheduleJob(params: {
  jobId: number;
  scheduledFor: Date;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<ScheduledJob> {
  const [row] = await db
    .update(scheduledJobsTable)
    .set({ scheduledFor: params.scheduledFor })
    .where(and(eq(scheduledJobsTable.id, params.jobId), eq(scheduledJobsTable.status, "scheduled")))
    .returning();

  if (!row) {
    const existing = await getScheduledJob(params.jobId);
    if (!existing) throw new ScheduledJobNotFoundError();
    throw new JobNotReschedulableError();
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: row.organizationId,
    eventType: "scheduled_job.rescheduled",
    targetType: "scheduled_job",
    targetId: String(row.id),
    metadata: { jobType: row.jobType, scheduledFor: row.scheduledFor },
  });

  return row;
}

/** Manually re-queues a terminally failed job for one more attempt window — an explicit administrative act, always audited. */
export async function retryFailedJob(params: {
  jobId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<ScheduledJob> {
  const [row] = await db
    .update(scheduledJobsTable)
    .set({
      status: "scheduled",
      scheduledFor: new Date(),
      attemptCount: 0,
      lastErrorClass: null,
      lastErrorMessage: null,
      failedAt: null,
    })
    .where(and(eq(scheduledJobsTable.id, params.jobId), eq(scheduledJobsTable.status, "failed")))
    .returning();

  if (!row) {
    const existing = await getScheduledJob(params.jobId);
    if (!existing) throw new ScheduledJobNotFoundError();
    throw new JobNotRetryableError();
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: row.organizationId,
    eventType: "scheduled_job.manually_retried",
    targetType: "scheduled_job",
    targetId: String(row.id),
    metadata: { jobType: row.jobType },
  });

  return row;
}

// ---------------------------------------------------------------------------
// Worker-side: claiming, execution, retry/backoff, and stale-lock recovery.
// Everything below is called only from src/worker.ts (or directly from
// tests proving the engine) — never from an HTTP request handler.
// ---------------------------------------------------------------------------

/** Raw driver rows from the hand-written claim SQL below are snake_case (the pg driver's own shape) — never Drizzle's camelCase mapping, which only applies to query-builder results. Mapped explicitly rather than blind-cast. */
interface RawScheduledJobRow extends Record<string, unknown> {
  id: number;
  organization_id: number | null;
  job_type: string;
  source_reference_type: string | null;
  source_reference_id: number | null;
  idempotency_key: string;
  payload: unknown;
  status: ScheduledJob["status"];
  priority: number;
  scheduled_for: Date;
  attempt_count: number;
  max_attempts: number;
  last_attempt_at: Date | null;
  last_error_class: ScheduledJob["lastErrorClass"];
  last_error_message: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  completed_at: Date | null;
  failed_at: Date | null;
  cancelled_at: Date | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

function mapRawJobRow(row: RawScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    organizationId: row.organization_id,
    jobType: row.job_type,
    sourceReferenceType: row.source_reference_type,
    sourceReferenceId: row.source_reference_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    scheduledFor: row.scheduled_for,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastAttemptAt: row.last_attempt_at,
    lastErrorClass: row.last_error_class,
    lastErrorMessage: row.last_error_message,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    cancelledAt: row.cancelled_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Claims up to `limit` due jobs for `workerId` in one statement using
 * `FOR UPDATE SKIP LOCKED` (§12): each claiming worker only ever sees rows
 * no other concurrent claim is already holding, so two workers can never
 * claim the same job, and a worker blocked on one row never blocks another
 * worker from claiming a different due row. The database's own `now()`
 * inside the query — not the application clock — decides "due" (§56),
 * avoiding any app/server clock-skew risk.
 */
export async function claimDueJobs(params: { workerId: string; limit?: number }): Promise<ScheduledJob[]> {
  const limit = Math.min(params.limit ?? 10, 50);
  const result = await db.execute<RawScheduledJobRow>(sql`
    UPDATE scheduled_jobs
    SET status = 'running', locked_at = now(), locked_by = ${params.workerId}
    WHERE id IN (
      SELECT id FROM scheduled_jobs
      WHERE status = 'scheduled' AND scheduled_for <= now()
      ORDER BY priority DESC, scheduled_for ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return result.rows.map(mapRawJobRow);
}

/**
 * Recovers jobs whose worker crashed after claiming them (§28): a 'running'
 * row whose lock is older than `leaseMs` is returned to 'scheduled' so
 * another worker can claim it. The lease must be comfortably longer than
 * any real handler's expected runtime — reclaiming a job whose worker is
 * simply slow (not dead) would risk two workers running it concurrently for
 * the remainder of that slow attempt, so this is a safety margin the
 * deployment configures generously, not a tight timeout.
 */
export async function reclaimStaleJobs(leaseMs: number): Promise<number> {
  const result = await db
    .update(scheduledJobsTable)
    .set({ status: "scheduled", lockedAt: null, lockedBy: null })
    .where(and(eq(scheduledJobsTable.status, "running"), lt(scheduledJobsTable.lockedAt, new Date(Date.now() - leaseMs))))
    .returning({ id: scheduledJobsTable.id });
  return result.length;
}

const DEFAULT_BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 60 * 60_000; // 1h

/**
 * Bounded exponential backoff with jitter (§25): doubles per attempt, capped
 * at one hour, and randomized within the top half of the window so many
 * jobs that failed at the same instant do not all retry at the same instant
 * again (the classic "thundering herd" a fixed backoff would create).
 */
export function computeBackoffDelayMs(attemptCount: number): number {
  const raw = Math.min(DEFAULT_BASE_BACKOFF_MS * 2 ** (attemptCount - 1), MAX_BACKOFF_MS);
  const jitterFloor = raw / 2;
  return Math.round(jitterFloor + Math.random() * jitterFloor);
}

/**
 * Safe diagnostics only (§27): the error's own message, never its stack
 * trace or any nested cause object that might carry a query, a payload, or
 * a token. Truncated so one runaway message cannot bloat the row.
 */
function toSafeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 500);
}

function classifyError(err: unknown): "transient" | "permanent" {
  if (err instanceof PermanentJobError) return "permanent";
  if (err instanceof TransientJobError) return "transient";
  // An unclassified error defaults to transient — safer to retry (bounded by
  // maxAttempts regardless) than to silently give up on a handler that threw
  // an ordinary, unclassified exception.
  return "transient";
}

/**
 * Executes exactly one claimed job and persists its outcome. Never called
 * concurrently for the same job (the claim above already guarantees
 * exclusivity) and never throws — every outcome, including an unknown job
 * type or a handler crash, is recorded on the row rather than propagated,
 * so one bad job can never take down the worker's poll loop.
 */
export async function executeClaimedJob(job: ScheduledJob): Promise<void> {
  const handler = getJobHandler(job.jobType);

  if (!handler) {
    await db
      .update(scheduledJobsTable)
      .set({
        status: "failed",
        failedAt: new Date(),
        lastAttemptAt: new Date(),
        lastErrorClass: "permanent",
        lastErrorMessage: `Unknown job type "${job.jobType}"`,
        attemptCount: job.attemptCount + 1,
      })
      .where(eq(scheduledJobsTable.id, job.id));
    return;
  }

  const attemptCount = job.attemptCount + 1;

  try {
    const payload = handler.parsePayload(job.payload);
    await handler.execute({
      jobId: job.id,
      organizationId: job.organizationId,
      sourceReferenceType: job.sourceReferenceType,
      sourceReferenceId: job.sourceReferenceId,
      payload,
      attemptCount,
    });

    await db
      .update(scheduledJobsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        lastAttemptAt: new Date(),
        attemptCount,
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(scheduledJobsTable.id, job.id));
  } catch (err) {
    const errorClass = classifyError(err);
    const maxAttempts = handler.defaultMaxAttempts ?? job.maxAttempts;
    const terminal = errorClass === "permanent" || attemptCount >= maxAttempts;

    await db
      .update(scheduledJobsTable)
      .set(
        terminal
          ? {
              status: "failed",
              failedAt: new Date(),
              lastAttemptAt: new Date(),
              lastErrorClass: errorClass,
              lastErrorMessage: toSafeErrorMessage(err),
              attemptCount,
              lockedAt: null,
              lockedBy: null,
            }
          : {
              status: "scheduled",
              scheduledFor: new Date(Date.now() + computeBackoffDelayMs(attemptCount)),
              lastAttemptAt: new Date(),
              lastErrorClass: errorClass,
              lastErrorMessage: toSafeErrorMessage(err),
              attemptCount,
              lockedAt: null,
              lockedBy: null,
            },
      )
      .where(eq(scheduledJobsTable.id, job.id));
  }
}
