import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { learningEnrollmentsTable } from "./learning-enrollments";
import { employeesTable } from "./employees";
import { employeeDocumentsTable } from "./employee-documents";
import { organizationMembershipsTable } from "./organization-memberships";

// Learning Certificates (Phase 3D, W85 — Learning Foundation): one row per
// issued certificate (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.5).
// A DISTINCT, Learning-owned model — deliberately never merged with the
// existing employee_certifications table (Owner Decision 3): a
// Learning-issued certificate is a structured, course-linked,
// system-generated artifact, while employee_certifications remains the
// sole source for external/manually-tracked credentials. No cross-write,
// no FK between the two tables.
//
// `employeeDocumentId` is a plain column, not a join table, since
// cardinality is 1-certificate-to-0-or-1-file (unlike
// learning_enrollment_evidence's many-per-enrollment shape).
// `courseTitleSnapshot` is copied from the enrollment's own snapshot at
// issuance — a chain of snapshots (course -> enrollment -> certificate),
// each frozen at its own creation moment.
//
// 'expired' is deliberately NOT a stored status value (§10.4 rule 9) — it
// is always computed live from expiresAt < now() by a later workstream's
// read path, avoiding any background job (Owner Decision 5). Issuance
// itself, expiry computation, and revocation are all later-workstream
// business logic — W85 is schema only.
export const learningCertificateStatusEnum = pgEnum("learning_certificate_status", ["active", "revoked"]);

export const learningCertificatesTable = pgTable(
  "learning_certificates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // Provenance — which completion produced this certificate.
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => learningEnrollmentsTable.id, { onDelete: "restrict" }),
    // Live reference for query convenience (matches
    // performance_reviews.employeeId's own "live reference, permanent
    // identity" precedent) — the authoritative "what/when" always traces
    // through enrollmentId.
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    courseTitleSnapshot: text("course_title_snapshot").notNull(),
    // Optional org-assigned identifier; no enforced global sequence in V1.
    certificateNumber: text("certificate_number"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    // Computed once at issuance from the enrollment's own
    // certificateValidityMonthsSnapshot; null = never expires.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: learningCertificateStatusEnum("status").notNull().default("active"),
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    // Optional uploaded certificate file — V1 never generates one (§4).
    employeeDocumentId: integer("employee_document_id").references(() => employeeDocumentsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("learning_certificates_org_employee_idx").on(table.organizationId, table.employeeId),
    index("learning_certificates_org_expires_idx").on(table.organizationId, table.expiresAt),
  ],
);

export const insertLearningCertificateSchema = createInsertSchema(learningCertificatesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLearningCertificate = z.infer<typeof insertLearningCertificateSchema>;
export type LearningCertificate = typeof learningCertificatesTable.$inferSelect;
