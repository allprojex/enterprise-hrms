import { pgTable, serial, integer, varchar, text, boolean, pgEnum, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

// WS-5 (Documents & Records Foundation, Owner Decision #4). The
// "document_category" Master Data domain (already registered, organization-
// defined, see lib/db/src/seed/master-data-definitions.ts) carries only
// code/label/status — the generic shape every Master Data domain shares. The
// document-specific behavior a category needs to drive (is a document in
// this category required to be verified before it counts as provided? does
// it expire? how sensitive is it? what's its retention basis?) does not fit
// that generic shape, and adding document-only columns to master_data_items
// would leak document semantics into every other domain (gender,
// employment_type, ...) sharing that table. This is the minimal companion
// table instead — one settings row per (organization | null, categoryCode),
// mirroring master_data_items' own organizationId-nullable "system default
// vs organization's own row" convention and partial-unique-index pattern
// exactly. A category with no settings row here simply has no special
// behavior (not required to verify, no expiry, standard sensitivity) —
// callers must treat an absent row as those defaults, never as an error.
export const documentSensitivityEnum = pgEnum("document_sensitivity", ["standard", "confidential"]);

export const documentCategorySettingsTable = pgTable(
  "document_category_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    categoryCode: varchar("category_code", { length: 64 }).notNull(),
    verificationRequired: boolean("verification_required").notNull().default(false),
    expirySupported: boolean("expiry_supported").notNull().default(false),
    expiryRequired: boolean("expiry_required").notNull().default(false),
    sensitivity: documentSensitivityEnum("sensitivity").notNull().default("standard"),
    retentionBasis: text("retention_basis"),
    retentionPeriodMonths: integer("retention_period_months"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("document_category_settings_system_unique")
      .on(table.categoryCode)
      .where(sql`${table.organizationId} is null`),
    uniqueIndex("document_category_settings_org_unique")
      .on(table.categoryCode, table.organizationId)
      .where(sql`${table.organizationId} is not null`),
  ],
);

export const insertDocumentCategorySettingsSchema = createInsertSchema(documentCategorySettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentCategorySettings = z.infer<typeof insertDocumentCategorySettingsSchema>;
export type DocumentCategorySettings = typeof documentCategorySettingsTable.$inferSelect;
