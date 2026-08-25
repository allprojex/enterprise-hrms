import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { documentTemplatesTable } from "./document-templates";
import { usersTable } from "./users";

// WS-5 — immutable template content per revision. `content` is always plain
// text with `{{allow-listed.merge.field}}` tokens (lib/documentMerge.ts) —
// deliberately never HTML/a templating-language string, and never evaluated
// as one (§21-22: no script injection, no SSTI, no arbitrary code execution
// surface, by construction rather than by sanitization). `format` is kept as
// an enum rather than hardcoded so a future safe format (e.g. a constrained
// rich-text subset) can be added without a schema change — exactly one value
// exists today, per §23's "establish one authoritative format, don't inflate
// scope" instruction.
//
// Editing a `draft` version updates that row in place; editing an `active`
// one creates a new version instead — enforced in lib/documentTemplates.ts,
// the same "draft rows are mutable, non-draft rows are not" precedent
// offer_versions' own status model already establishes for offers. The
// partial unique index guarantees at most one `active` version per template,
// the same DB-level guarantee organization_document_versions uses for its
// own "current" status.
export const documentTemplateContentFormatEnum = pgEnum("document_template_content_format", ["plain_text"]);
export const documentTemplateVersionStatusEnum = pgEnum("document_template_version_status", ["draft", "active", "superseded"]);

export const documentTemplateVersionsTable = pgTable(
  "document_template_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => documentTemplatesTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    format: documentTemplateContentFormatEnum("format").notNull().default("plain_text"),
    status: documentTemplateVersionStatusEnum("status").notNull().default("draft"),
    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_template_versions_template_version_unique").on(table.templateId, table.versionNumber),
    uniqueIndex("document_template_versions_active_unique")
      .on(table.templateId)
      .where(sql`${table.status} = 'active'`),
    index("document_template_versions_org_idx").on(table.organizationId),
    index("document_template_versions_template_idx").on(table.templateId),
  ],
);

export const insertDocumentTemplateVersionSchema = createInsertSchema(documentTemplateVersionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDocumentTemplateVersion = z.infer<typeof insertDocumentTemplateVersionSchema>;
export type DocumentTemplateVersion = typeof documentTemplateVersionsTable.$inferSelect;
