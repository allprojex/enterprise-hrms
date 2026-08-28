import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

// WS-5 (Documents & Records Foundation, Owner Decision #4) — the generic
// organization-level digital document repository (handbook, HR policy,
// forms, procedures): documents that belong to the organization itself, not
// to one employee or candidate, and are NOT Personnel Files (see
// personnel-files.ts's own header — zero column overlap, physical custody
// stays a separate domain). One row per logical document; the actual
// versioned artifact content lives in organization_document_versions, the
// same envelope/version split already established by offers/offer_versions
// (offers.ts) — reused here rather than inventing a different versioning
// shape. `currentVersionId` always points at the latest non-superseded
// version; nullable only for the brief instant between inserting this row
// and its first version within the same transaction, exactly mirroring
// offers.currentVersionId's own precedent and its own reason for carrying no
// FK (the mutual-cycle problem between two tables created in the same
// migration) — enforced at the application layer instead.
export const organizationDocumentStatusEnum = pgEnum("organization_document_status", ["active", "archived"]);

export const organizationDocumentsTable = pgTable(
  "organization_documents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    categoryCode: text("category_code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: organizationDocumentStatusEnum("status").notNull().default("active"),
    currentVersionId: integer("current_version_id"),
    // WS-10 (§26.18, §26.20) — whether this document carries an acknowledgement
    // obligation at all, and whether a newly effective version raises a fresh
    // one. Both are organization configuration: §26.18 forbids hard-coding a
    // policy taxonomy, and §26.20 forbids forcing every revision to require
    // re-acknowledgement. Defaults are false so no existing document silently
    // acquires an obligation.
    requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
    reacknowledgeOnNewVersion: boolean("reacknowledge_on_new_version").notNull().default(false),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("organization_documents_org_idx").on(table.organizationId),
    index("organization_documents_org_category_idx").on(table.organizationId, table.categoryCode),
  ],
);

export const insertOrganizationDocumentSchema = createInsertSchema(organizationDocumentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationDocument = z.infer<typeof insertOrganizationDocumentSchema>;
export type OrganizationDocument = typeof organizationDocumentsTable.$inferSelect;
