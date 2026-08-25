import { pgTable, serial, integer, text, varchar, boolean, date, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// WS-5 — the shared retention/archive/disposal primitive (Owner Decision #4,
// §15-18 of the frozen scope). One row per digital document instance across
// every document-owning table (employee_documents, candidate_documents,
// organization_document_versions) — a genuinely shared cross-cutting concern
// (retention policy, legal hold, archive/disposal state), unlike the
// document content itself, which stays in its own domain table per §8's
// "do not collapse into one giant polymorphic documents table" instruction.
// `documentTable`/`documentId` is the same polymorphic-pointer discipline as
// document_requirements' own fulfilledDocumentTable/fulfilledDocumentId —
// the owning service validates the pair before writing here; no DB-level FK
// is possible across a polymorphic reference.
//
// ARCHIVED, ELIGIBLE-FOR-DISPOSAL, and DISPOSED are deliberately distinct
// states (§16): `archiveStatus` never implies deletion, `disposalStatus`
// moving to "eligible" is a determination only (never automatic deletion),
// and `legalHold` blocks disposal authorization regardless of retention
// expiry — enforced in lib/documentRetention.ts, not by a DB trigger, so the
// authorization/audit trail around each transition is explicit.
export const documentRetentionArchiveStatusEnum = pgEnum("document_retention_archive_status", ["active", "archived"]);
export const documentRetentionDisposalStatusEnum = pgEnum("document_retention_disposal_status", ["none", "eligible", "disposed"]);

export const documentRetentionRecordsTable = pgTable(
  "document_retention_records",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    documentTable: varchar("document_table", { length: 32 }).notNull(),
    documentId: integer("document_id").notNull(),
    retentionBasis: text("retention_basis"),
    retainUntil: date("retain_until"),
    legalHold: boolean("legal_hold").notNull().default(false),
    legalHoldReason: text("legal_hold_reason"),
    legalHoldSetBy: integer("legal_hold_set_by").references(() => usersTable.id, { onDelete: "set null" }),
    legalHoldSetAt: timestamp("legal_hold_set_at", { withTimezone: true }),
    archiveStatus: documentRetentionArchiveStatusEnum("archive_status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: integer("archived_by").references(() => usersTable.id, { onDelete: "set null" }),
    disposalStatus: documentRetentionDisposalStatusEnum("disposal_status").notNull().default("none"),
    disposalReason: text("disposal_reason"),
    disposalAuthorizedBy: integer("disposal_authorized_by").references(() => usersTable.id, { onDelete: "set null" }),
    disposalAuthorizedAt: timestamp("disposal_authorized_at", { withTimezone: true }),
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("document_retention_records_document_unique").on(table.documentTable, table.documentId),
    index("document_retention_records_org_archive_idx").on(table.organizationId, table.archiveStatus),
    index("document_retention_records_org_disposal_idx").on(table.organizationId, table.disposalStatus),
    index("document_retention_records_retain_until_idx").on(table.organizationId, table.retainUntil),
  ],
);

export const insertDocumentRetentionRecordSchema = createInsertSchema(documentRetentionRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentRetentionRecord = z.infer<typeof insertDocumentRetentionRecordSchema>;
export type DocumentRetentionRecord = typeof documentRetentionRecordsTable.$inferSelect;
