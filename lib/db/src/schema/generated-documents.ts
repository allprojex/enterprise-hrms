import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { documentTemplatesTable } from "./document-templates";
import { documentTemplateVersionsTable } from "./document-template-versions";
import { usersTable } from "./users";

// WS-5 — one immutable row per finalized generated artifact (§24/§29-30 of
// the frozen scope): proof of exactly which template version, merged with
// which source entity, produced the stored PDF at generation time. Later
// template edits create new document_template_versions rows and never touch
// this one — a downstream workflow (WS-9 offer letters, WS-10 handbook
// issuance, WS-12 warning/separation letters) reads this table to know what
// was actually issued, never re-derives it from the current template state.
//
// `templateId`/`templateVersionId` use `onDelete: "set null"` rather than
// `restrict` — a template or version could in principle be hard-deleted
// later (this workstream does not build that), and a past generated
// artifact's own row (storageKey, fileName, generatedAt) must remain valid
// evidence even if its lineage reference goes null; the artifact itself is
// never deleted by that.
//
// `sourceType`/`sourceId` are the same deliberate polymorphic-pointer
// discipline as document_requirements/document_retention_records — this
// workstream does not know yet whether WS-9 will key generation off
// offer_versions, applications, or something else; recording a free-text
// label plus id here avoids a schema change when that's decided. This is
// exactly the "capable of legitimately populating offer_versions.
// generatedDocumentStorageKey later" wiring §25 asks for, without this
// workstream setting that column itself.
export const generatedDocumentsTable = pgTable(
  "generated_documents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id").references(() => documentTemplatesTable.id, { onDelete: "set null" }),
    templateVersionId: integer("template_version_id").references(() => documentTemplateVersionsTable.id, { onDelete: "set null" }),
    categoryCode: text("category_code").notNull(),
    sourceType: varchar("source_type", { length: 32 }),
    sourceId: integer("source_id"),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    fileSize: integer("file_size").notNull(),
    generatedBy: integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("generated_documents_org_idx").on(table.organizationId),
    index("generated_documents_source_idx").on(table.organizationId, table.sourceType, table.sourceId),
    index("generated_documents_template_idx").on(table.templateId),
  ],
);

export const insertGeneratedDocumentSchema = createInsertSchema(generatedDocumentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertGeneratedDocument = z.infer<typeof insertGeneratedDocumentSchema>;
export type GeneratedDocument = typeof generatedDocumentsTable.$inferSelect;
