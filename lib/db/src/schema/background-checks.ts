import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";
import { referenceBackgroundCheckStatusEnum } from "./reference-checks";

// Background Checks (Phase 3A, W56 — Reference & Background Checks): status-
// tracked tracking only, no vendor API call — `vendorReference` is a plain,
// manually-entered reference string (an "integration boundary", §15/§9),
// never a real provider integration, and never a Ghana-specific or any
// other hardcoded provider. Column list is exactly §9's `background_checks`
// row — applicationId, checkType (free text, not Master Data — no
// organization-configurable domain table exists in this frozen scope),
// status, vendorReference, resultSummary, documentStorageKey. No separate
// `completedAt`/`notes` column exists here (unlike reference_checks) —
// `resultSummary` carries the completion narrative, and `updatedAt`
// reflects the last status change.
//
// Deliberately its own dedicated permission pair (`background_check.read`/
// `.manage`, §7) — organization-wide only, no assigned tier at all (the
// narrowest row in the entire matrix): holding `application.read`/
// `.manage` never implies background-check access, since result content is
// explicitly flagged "highly sensitive" in §9, unlike reference checks'
// "referee PII" (handled by the ordinary application permission pair).
//
// `documentStorageKey` is a single nullable reference to one privately-
// stored evidence file (fileStorage.ts's existing org-scoped-directory
// convention, `"background-checks"` subdir) — never a public URL, and
// never the candidate's own `candidate_documents` row, reused or
// duplicated.
export const backgroundChecksTable = pgTable(
  "background_checks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    checkType: text("check_type").notNull(),
    status: referenceBackgroundCheckStatusEnum("status").notNull().default("requested"),
    vendorReference: text("vendor_reference"),
    resultSummary: text("result_summary"),
    documentStorageKey: text("document_storage_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("background_checks_org_idx").on(table.organizationId),
    index("background_checks_application_idx").on(table.applicationId),
    index("background_checks_status_idx").on(table.status),
  ],
);

export const insertBackgroundCheckSchema = createInsertSchema(backgroundChecksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBackgroundCheck = z.infer<typeof insertBackgroundCheckSchema>;
export type BackgroundCheck = typeof backgroundChecksTable.$inferSelect;
