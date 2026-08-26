import { pgTable, serial, integer, text, varchar, jsonb, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * WS-6 (Scheduled Jobs / Notifications Foundation, Owner Decision #13) — the
 * durable, database-authoritative unit of scheduled work. Verified against
 * current reality before designing this (not assumed from the frozen review
 * alone): zero scheduling/queue/cron infrastructure exists anywhere in this
 * codebase today, and `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`'s own
 * "Background-job boundary: none exists... if an in-app job system is ever
 * justified, it should be scoped as its own workstream" is the explicit
 * standing invitation this workstream fulfills.
 *
 * Design principle (§6 of the frozen brief): the database is authoritative.
 * A row here must survive process restart, container restart, a crashed
 * worker, and a deploy — nothing about a job's existence or due state is
 * ever held only in application memory (no setTimeout/setInterval anywhere
 * in this file or its consumers).
 *
 * `organizationId` is nullable — per the brief's own instruction, "nullable
 * only for truly platform-scoped jobs" (e.g. a future audit-retention scan
 * that operates platform-wide). `onDelete: cascade` here (not `restrict`,
 * unlike WS-5's document tables) is deliberate: a scheduled_jobs row is
 * ephemeral operational work, not a historical record an organization's
 * deletion must be blocked by — there is nothing to preserve once the
 * organization it was scheduled for no longer exists.
 *
 * `jobType` is a free-text column, not a Postgres enum, but is NOT
 * client-writable content: every write path in lib/scheduledJobs.ts checks it
 * against a server-side allow-list (the job-handler registry) before a row
 * is ever inserted or executed — "database values select only from approved
 * server-side handlers" (§11 of the brief). No column here stores executable
 * code.
 */
export const scheduledJobStatusEnum = pgEnum("scheduled_job_status", ["scheduled", "running", "completed", "failed", "cancelled"]);

/**
 * Classifies a failure so retry logic knows whether trying again could ever
 * help. A `permanent` failure (bad payload, entity no longer exists,
 * authorization no longer valid) is never retried regardless of remaining
 * attempts — see lib/scheduledJobs.ts's `JobError` classes.
 */
export const scheduledJobErrorClassEnum = pgEnum("scheduled_job_error_class", ["transient", "permanent"]);

export const scheduledJobsTable = pgTable(
  "scheduled_jobs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    jobType: varchar("job_type", { length: 64 }).notNull(),
    sourceReferenceType: varchar("source_reference_type", { length: 32 }),
    sourceReferenceId: integer("source_reference_id"),
    // Caller-constructed (e.g. "reminder:contract_expiry:employee:123:2026-09-01").
    // The unique index below is what makes "same reminder source + same
    // reminder type + same due occurrence -> one row" a database guarantee
    // rather than an application-level hope (§13 of the brief: idempotency
    // is mandatory). Callers embed organizationId in the key themselves when
    // the job is org-scoped, so a single global (jobType, idempotencyKey)
    // uniqueness tuple is sufficient without needing null-aware partial
    // indexes for the platform-scoped (organizationId is null) case.
    idempotencyKey: text("idempotency_key").notNull(),
    // Narrow, validated parameters only — identifiers, not domain snapshots
    // (§67 of the brief: "GOOD: employeeId, reminderType. BAD: entire
    // employee record"). Handlers re-fetch authoritative state at execution
    // time; see lib/scheduledJobs.ts's JobHandler contract.
    payload: jsonb("payload"),
    status: scheduledJobStatusEnum("status").notNull().default("scheduled"),
    priority: integer("priority").notNull().default(0),
    // The single "when is this next due" instant — doubles as both the
    // original scheduled time and, after a retry, the next-attempt time.
    // Deliberately not split into separate scheduledFor/nextAttemptAt
    // columns: nothing in this design ever needs both simultaneously (a
    // retry supersedes the original due time, it doesn't coexist with it),
    // and one mutable column is what the due-job index below polls.
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastErrorClass: scheduledJobErrorClassEnum("last_error_class"),
    // Safe diagnostics only — never secrets, tokens, or confidential payload
    // content (§27 of the brief). Handlers must throw sanitized errors; see
    // lib/scheduledJobs.ts's `toSafeErrorMessage`.
    lastErrorMessage: text("last_error_message"),
    // No separate scheduled_job_attempts table (see this file's own header
    // comment in the migration and docs/SCHEDULED_JOBS_AND_NOTIFICATIONS.md
    // §"Attempt history" for the full reasoning): attemptCount +
    // lastAttemptAt + lastErrorClass + lastErrorMessage is enough to answer
    // "how many times, when last, why last failed" for operational
    // troubleshooting, matching the brief's own "keep it operational, not a
    // duplicate audit system" instruction for the closely analogous
    // dead-letter question (§26).
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // Worker identity string (installationKey + a fresh per-process id),
    // not a foreign key — WS-4's installations table models deployment
    // identity, not per-process/per-attempt identity, so this stays a plain
    // string column recorded for diagnostics.
    lockedBy: varchar("locked_by", { length: 160 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("scheduled_jobs_type_idempotency_unique").on(table.jobType, table.idempotencyKey),
    // Partial index on exactly the predicate the due-job claim query uses
    // (status = 'scheduled'), so ordinary due-job polling never touches
    // rows in any other status — the smallest index that answers "what's
    // due" (§52 of the brief: prove no full-table scan for due-job polling).
    index("scheduled_jobs_due_idx")
      .on(table.scheduledFor)
      .where(sql`${table.status} = 'scheduled'`),
    index("scheduled_jobs_org_idx").on(table.organizationId),
    index("scheduled_jobs_source_idx").on(table.sourceReferenceType, table.sourceReferenceId),
    // Recovers stale locks (§28: worker-crash reclaim) without scanning
    // every row — only 'running' rows are ever candidates.
    index("scheduled_jobs_running_lock_idx")
      .on(table.lockedAt)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const insertScheduledJobSchema = createInsertSchema(scheduledJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertScheduledJob = z.infer<typeof insertScheduledJobSchema>;
export type ScheduledJob = typeof scheduledJobsTable.$inferSelect;
