import { pgTable, serial, integer, text, jsonb, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { migrationSourcesTable } from "./migration-sources";

/**
 * WS-7 (§11-13) — the staging table. Uploaded rows are never written
 * directly into authoritative HR tables; every row is normalized and
 * staged here first, and validation/dry-run/execution all operate against
 * this table, never a re-parse of the source file.
 *
 * One row serves BOTH the dry-run result AND the execution outcome — a
 * deliberate consolidation rather than two tables: `validationStatus`/
 * `validationMessages`/`operation` are written by validation/dry-run and
 * never mutated by execution; `executionStatus`/`executionResultId`/
 * `executionError` are written only by execution and start `pending`. This
 * is also the row-level idempotency guard (§25): execution checks
 * `executionStatus` before acting — a row already `created`/`updated`/
 * `matched`/`skipped` is never re-executed, so a retried chunk (after a
 * crash/reclaim) cannot double-create anything even before any underlying
 * domain unique constraint is reached.
 *
 * `normalizedData` holds only the mapped, coerced field values for this
 * row — narrow and entity-specific, never a snapshot of an existing
 * authoritative record (§35: no confidential row contents belong in a
 * generic log; the same discipline applies here to a table an
 * organization's migration administrators can read broadly).
 */
export const migrationRowOperationEnum = pgEnum("migration_row_operation", ["create", "match_existing", "skip", "error"]);
export const migrationRowValidationStatusEnum = pgEnum("migration_row_validation_status", ["pending", "valid", "warning", "error"]);
export const migrationRowExecutionStatusEnum = pgEnum("migration_row_execution_status", [
  "pending",
  "created",
  "updated",
  "matched",
  "skipped",
  "failed",
]);

export const migrationStagedRowsTable = pgTable(
  "migration_staged_rows",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => migrationSourcesTable.id, { onDelete: "cascade" }),
    // 1-based position within the source file, excluding the header row —
    // the provenance a validation/reconciliation message points back to.
    rowNumber: integer("row_number").notNull(),
    normalizedData: jsonb("normalized_data").notNull(),
    operation: migrationRowOperationEnum("operation"),
    matchedEntityId: integer("matched_entity_id"),
    validationStatus: migrationRowValidationStatusEnum("validation_status").notNull().default("pending"),
    // [{ field, message, severity }], safe human-readable text only.
    validationMessages: jsonb("validation_messages"),
    executionStatus: migrationRowExecutionStatusEnum("execution_status").notNull().default("pending"),
    executionResultId: integer("execution_result_id"),
    executionError: text("execution_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("migration_staged_rows_source_row_unique").on(table.sourceId, table.rowNumber),
    index("migration_staged_rows_source_validation_idx").on(table.sourceId, table.validationStatus),
    index("migration_staged_rows_source_execution_idx").on(table.sourceId, table.executionStatus),
  ],
);

export const insertMigrationStagedRowSchema = createInsertSchema(migrationStagedRowsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMigrationStagedRow = z.infer<typeof insertMigrationStagedRowSchema>;
export type MigrationStagedRow = typeof migrationStagedRowsTable.$inferSelect;
