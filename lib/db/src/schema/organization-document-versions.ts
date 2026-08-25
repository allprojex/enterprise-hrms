import { pgTable, serial, integer, text, date, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { organizationDocumentsTable } from "./organization-documents";
import { usersTable } from "./users";

// WS-5 — immutable version history for organization_documents, mirroring
// offer_versions' own envelope/version split. Re-uploading a document never
// overwrites a prior row or its underlying stored file (fileStorage.ts's
// writeOrgFile always returns a fresh, unguessable key) — it inserts a new
// version row and flips the prior "current" row to "superseded" in the same
// transaction. The partial unique index below is the DB-level guarantee
// against two contradictory "current" versions (§11 of the frozen scope) —
// stronger than an application-only check, which a race between two
// concurrent uploads could otherwise defeat.
export const organizationDocumentVersionStatusEnum = pgEnum("organization_document_version_status", ["current", "superseded"]);

export const organizationDocumentVersionsTable = pgTable(
  "organization_document_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => organizationDocumentsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    status: organizationDocumentVersionStatusEnum("status").notNull().default("current"),
    effectiveDate: date("effective_date"),
    expiryDate: date("expiry_date"),
    changeNote: text("change_note"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    supersededBy: integer("superseded_by").references(() => usersTable.id, { onDelete: "set null" }),
    uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_document_versions_doc_version_unique").on(table.documentId, table.versionNumber),
    uniqueIndex("organization_document_versions_current_unique")
      .on(table.documentId)
      .where(sql`${table.status} = 'current'`),
    index("organization_document_versions_org_idx").on(table.organizationId),
    index("organization_document_versions_document_idx").on(table.documentId),
    index("organization_document_versions_expiry_idx").on(table.organizationId, table.expiryDate),
  ],
);

export const insertOrganizationDocumentVersionSchema = createInsertSchema(organizationDocumentVersionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOrganizationDocumentVersion = z.infer<typeof insertOrganizationDocumentVersionSchema>;
export type OrganizationDocumentVersion = typeof organizationDocumentVersionsTable.$inferSelect;
