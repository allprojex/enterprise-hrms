import { pgTable, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { learningEnrollmentsTable } from "./learning-enrollments";
import { employeeDocumentsTable } from "./employee-documents";
import { organizationMembershipsTable } from "./organization-memberships";

// Learning Enrollment Evidence (Phase 3D, W85 — Learning Foundation): a
// lightweight join table only — supporting documentation attached to an
// enrollment, e.g. a completion confirmation or an external receipt, NOT
// the certificate itself (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md
// §8.4). Points into the EXISTING employee_documents table; no new
// file-storage layer, no Learning-specific storage provider — mirrors
// performance_review_evidence exactly, since cardinality here is genuinely
// many-per-enrollment. `employeeDocumentId` restricts deletion so a
// document can never be silently unlinked from enrollment evidence.
// Metadata/relational foundation only — no upload API, no storage-provider
// behavior, no Master Data domain registration for evidence categories in
// W85; that is a later workstream's job.
export const learningEnrollmentEvidenceTable = pgTable(
  "learning_enrollment_evidence",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // Defensive-only cascade — enrollments themselves are never deleted in
    // practice (restrict on employeeId prevents the underlying employee
    // from disappearing silently), matching
    // performance_review_evidence.reviewId's own cascade precedent.
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => learningEnrollmentsTable.id, { onDelete: "cascade" }),
    employeeDocumentId: integer("employee_document_id")
      .notNull()
      .references(() => employeeDocumentsTable.id, { onDelete: "restrict" }),
    addedByMembershipId: integer("added_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("learning_enrollment_evidence_org_enrollment_idx").on(table.organizationId, table.enrollmentId)],
);

export const insertLearningEnrollmentEvidenceSchema = createInsertSchema(learningEnrollmentEvidenceTable).omit({
  id: true,
  addedAt: true,
});

export type InsertLearningEnrollmentEvidence = z.infer<typeof insertLearningEnrollmentEvidenceSchema>;
export type LearningEnrollmentEvidence = typeof learningEnrollmentEvidenceTable.$inferSelect;
