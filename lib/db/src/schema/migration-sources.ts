import { pgTable, serial, integer, text, varchar, jsonb, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { migrationBatchesTable } from "./migration-batches";
import { usersTable } from "./users";

/**
 * WS-7 — one uploaded file (or one worksheet within an uploaded XLSX
 * workbook) within a migration batch, scoped to exactly one entity type.
 * `entityType` is never client-executable content: every write and read
 * path validates it against the server-side entity-adapter registry
 * (lib/migrations/entityAdapters.ts) before any row is staged or executed —
 * the same allow-list discipline WS-6 established for `scheduled_jobs
 * .jobType`.
 *
 * Unique on (batchId, entityType): one source per entity type per batch,
 * keeping dependency-order resolution simple (§16/§38 of the brief) — an
 * organization that needs two separate files for the same entity type
 * uploads them as two separate batches. Documented as a deliberate v1
 * scope boundary, not an oversight.
 *
 * `sha256Digest` is the source-integrity anchor (§24): computed once at
 * upload from the raw file bytes, never recomputed from a re-parse, so a
 * file silently swapped after upload (same name, different bytes) is
 * detectable at approval/execution time by digest mismatch.
 */
export const migrationSourceStatusEnum = pgEnum("migration_source_status", ["uploaded", "mapped", "validated"]);

export const migrationSourcesTable = pgTable(
  "migration_sources",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => migrationBatchesTable.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256Digest: varchar("sha256_digest", { length: 64 }).notNull(),
    // Set only for an XLSX source that names a specific worksheet; null for
    // CSV and for an XLSX source using the workbook's first/only sheet.
    sheetName: text("sheet_name"),
    // {sourceHeader: canonicalField} — the finalized mapping for this
    // source. Null until mapping is finalized (status transitions to
    // 'mapped' at that point). Small enough to keep inline rather than a
    // separate mapping table (§10 of the brief: this IS the mapping).
    columnMapping: jsonb("column_mapping"),
    rowCount: integer("row_count"),
    status: migrationSourceStatusEnum("status").notNull().default("uploaded"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("migration_sources_batch_entity_unique").on(table.batchId, table.entityType),
    index("migration_sources_org_idx").on(table.organizationId),
    index("migration_sources_batch_idx").on(table.batchId),
  ],
);

export const insertMigrationSourceSchema = createInsertSchema(migrationSourcesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMigrationSource = z.infer<typeof insertMigrationSourceSchema>;
export type MigrationSource = typeof migrationSourcesTable.$inferSelect;
