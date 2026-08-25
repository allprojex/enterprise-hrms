import { pgTable, serial, integer, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// WS-5 — the reusable, organization-scoped document-template envelope (§19-
// 20 of the frozen scope): the platform service future workstreams (WS-9
// offer/appointment letters, WS-10 handbook, WS-12 warning/separation
// letters) generate official HR documents from. Envelope/version split
// mirrors organization_documents/organization_document_versions (itself
// mirroring offers/offer_versions) exactly — same reason: template content
// must have immutable version history so a letter already generated from
// version N is never silently reinterpreted after the template is edited
// (§24). `currentVersionId` carries no FK for the same same-migration mutual-
// cycle reason as offers.currentVersionId/organization_documents.currentVersionId.
export const documentTemplateStatusEnum = pgEnum("document_template_status", ["active", "inactive"]);

export const documentTemplatesTable = pgTable(
  "document_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    categoryCode: text("category_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    currentVersionId: integer("current_version_id"),
    status: documentTemplateStatusEnum("status").notNull().default("active"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("document_templates_org_idx").on(table.organizationId),
    index("document_templates_org_category_idx").on(table.organizationId, table.categoryCode),
  ],
);

export const insertDocumentTemplateSchema = createInsertSchema(documentTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentTemplate = z.infer<typeof insertDocumentTemplateSchema>;
export type DocumentTemplate = typeof documentTemplatesTable.$inferSelect;
