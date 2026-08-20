import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { performanceReviewsTable } from "./performance-reviews";
import { performanceReviewGoalsTable } from "./performance-review-goals";
import { employeeDocumentsTable } from "./employee-documents";
import { organizationMembershipsTable } from "./organization-memberships";

// Performance Review Evidence (Phase 3C, W73 — Performance Foundation): a
// lightweight join table only — attaches at review level or a specific
// goal (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.9). Points into
// the EXISTING employee_documents table; no new file-storage layer, no
// Performance-specific storage provider. `employeeDocumentId` restricts
// deletion so a document can never be silently unlinked from review
// evidence. Carries its own organizationId, matching the other review-child
// tables' defense-in-depth convention. Metadata/relational foundation
// only — no upload API, no storage-provider behavior, no Master Data
// `performance_evidence` code registration in W73; all of that is W82's
// job.
export const performanceReviewEvidenceTable = pgTable(
  "performance_review_evidence",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => performanceReviewsTable.id, { onDelete: "cascade" }),
    goalId: integer("goal_id").references(() => performanceReviewGoalsTable.id, { onDelete: "cascade" }),
    employeeDocumentId: integer("employee_document_id")
      .notNull()
      .references(() => employeeDocumentsTable.id, { onDelete: "restrict" }),
    addedByMembershipId: integer("added_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_review_evidence_org_review_idx").on(table.organizationId, table.reviewId)],
);

export const insertPerformanceReviewEvidenceSchema = createInsertSchema(performanceReviewEvidenceTable).omit({
  id: true,
  addedAt: true,
});

export type InsertPerformanceReviewEvidence = z.infer<typeof insertPerformanceReviewEvidenceSchema>;
export type PerformanceReviewEvidence = typeof performanceReviewEvidenceTable.$inferSelect;
