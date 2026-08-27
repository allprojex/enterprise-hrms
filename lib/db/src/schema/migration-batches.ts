import { pgTable, serial, integer, text, jsonb, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * WS-7 (Bulk Import — Full Multi-Entity Migration, P0, no Owner Decision —
 * mandatory per the original brief per docs/ENTERPRISE_HRMS_MASTER_OWNER_
 * REVIEW.md §9). The top-level record of one organization migration
 * operation, spanning any number of entity-type sources (branches,
 * departments, positions, employees, employment history, qualifications,
 * certifications, leave balances, payroll opening balances).
 *
 * Lifecycle (Owner-approved, frozen for this workstream):
 * draft -> mapped -> validated -> approved -> running -> completed |
 * completed_with_errors | failed -> (cancelled only before running).
 * `completed_with_errors` exists because a large, chunked migration is
 * explicitly NOT claimed atomic (§27/§29 of the brief) — some rows can
 * genuinely succeed while others fail, and reporting that as plain
 * "completed" would be dishonest. A small, synchronously-executed migration
 * runs inside one transaction and can therefore only ever reach `completed`
 * or `failed` (never `completed_with_errors` — see lib/migrations/execution.ts's
 * own header for the exact threshold and reasoning).
 *
 * `approvedSourcesSnapshot` is the source-integrity mechanism (§24): at
 * approval time, every source's current sha256 digest is captured here.
 * Execution re-verifies every source's live digest against this snapshot
 * before mutating anything — a source (or its mapping) changed after
 * approval invalidates the approval outright (see
 * lib/migrations/execution.ts's `assertApprovalStillValid`).
 */
export const migrationBatchStatusEnum = pgEnum("migration_batch_status", [
  "draft",
  "mapped",
  "validated",
  "approved",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

export const migrationBatchesTable = pgTable(
  "migration_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: migrationBatchStatusEnum("status").notNull().default("draft"),
    // Snapshot of every source's (sourceId, sha256Digest, columnMapping) at
    // the moment of approval — see this file's own header comment.
    approvedSourcesSnapshot: jsonb("approved_sources_snapshot"),
    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executionStartedAt: timestamp("execution_started_at", { withTimezone: true }),
    executionCompletedAt: timestamp("execution_completed_at", { withTimezone: true }),
    // Which source (by entityType, in dependency order) execution is
    // currently on, and how far through its staged rows — the durable
    // checkpoint a resumed/reclaimed WS-6 chunk job reads to continue
    // exactly where the last successful chunk left off (§27).
    executionEntityType: text("execution_entity_type"),
    executionCursorRowId: integer("execution_cursor_row_id"),
    // Cached at completion from migration_staged_rows (the authoritative
    // source) purely so the reconciliation view/export doesn't re-aggregate
    // every time — never the only copy of the truth (§30).
    reconciliationSummary: jsonb("reconciliation_summary"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("migration_batches_org_idx").on(table.organizationId),
    index("migration_batches_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertMigrationBatchSchema = createInsertSchema(migrationBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMigrationBatch = z.infer<typeof insertMigrationBatchSchema>;
export type MigrationBatch = typeof migrationBatchesTable.$inferSelect;
