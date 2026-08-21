import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { assetsTable } from "./assets";
import { employeeDocumentsTable } from "./employee-documents";
import { organizationMembershipsTable } from "./organization-memberships";

// Asset Management (Phase 3E, W95): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
// §5/§13, Owner Decision 9. A lightweight join table into the EXISTING
// employee_documents table — no second storage subsystem, mirrors
// learning_enrollment_evidence/performance_review_evidence exactly.
// Attaches to the asset only (no polymorphic assignment/maintenance
// attachment target, §13's own "smallest coherent attachment model").
//
// Document-ownership reconciliation (resolved during W95, not improvised):
// an asset (unassigned or assigned) has no natural single-employee owner
// the way every pre-existing employee_documents consumer does, but that
// table's own `employeeId` was NOT NULL. Rather than inventing a fake
// employee-ownership model (e.g. attributing a purchase receipt to
// whichever employee currently happens to hold the asset, which would
// misattribute the document on every later reassignment), `employeeId` on
// employee_documents was made nullable in this same migration — see that
// table's own updated header comment. Every pre-existing consumer
// (Core HR's own employee documents, Performance's review evidence,
// Learning's enrollment evidence) is structurally unaffected: each always
// supplies a real employeeId at insert time, unchanged.
export const assetEvidenceTable = pgTable(
  "asset_evidence",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    employeeDocumentId: integer("employee_document_id")
      .notNull()
      .references(() => employeeDocumentsTable.id, { onDelete: "restrict" }),
    addedByMembershipId: integer("added_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("asset_evidence_org_asset_idx").on(table.organizationId, table.assetId),
    index("asset_evidence_employee_document_idx").on(table.employeeDocumentId),
  ],
);

export const insertAssetEvidenceSchema = createInsertSchema(assetEvidenceTable).omit({
  id: true,
  addedAt: true,
});

export type InsertAssetEvidence = z.infer<typeof insertAssetEvidenceSchema>;
export type AssetEvidence = typeof assetEvidenceTable.$inferSelect;
