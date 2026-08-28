import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationDocumentsTable } from "./organization-documents";
import { organizationDocumentVersionsTable } from "./organization-document-versions";
import { onboardingInstancesTable } from "./onboarding-instances";
import { usersTable } from "./users";

/**
 * WS-10 — Handbook and policy acknowledgement
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §26.17-26.21).
 *
 * Deliberately named for DOCUMENTS, not for onboarding. §26.18 requires the
 * same mechanism to serve the Employee Handbook, a Code of Conduct and ordinary
 * HR policies, and §26.21 allows assigning to every employee in the
 * organization — an all-staff policy re-issue has nothing to do with anybody's
 * onboarding. `onboardingInstanceId` is therefore an optional link, not the
 * owner of the row.
 *
 * ASSIGNMENT AND ACKNOWLEDGEMENT ARE ONE ROW, not two. Assigning a document IS
 * creating the obligation to acknowledge it; the frozen status model has
 * exactly two states (§26.8), which one row expresses as `pending` then
 * `acknowledged`. Re-acknowledgement of a later version (§26.20) is a NEW row
 * pointing at the new version, so the earlier evidence is preserved by
 * construction rather than by remembering not to overwrite it.
 *
 * There is NO document storage here. The artifact, its versions, its effective
 * date and its retention all remain WS-5's `organization_documents` /
 * `organization_document_versions` (§26.17).
 *
 * This records an ACKNOWLEDGEMENT — that a named person confirmed receipt of an
 * exact version at an exact time. It is not an electronic signature and must
 * never be presented as one; WS-10 builds no e-signature capability (§26.19).
 */

export const acknowledgementStatusEnum = pgEnum("acknowledgement_status", ["pending", "acknowledged"]);

/**
 * How the recipient came to be assigned. Recorded for audit and for explaining
 * the obligation back to the employee — never re-evaluated to expand access.
 * The audience resolver is a fixed allow-list, not a rules engine (§26.21).
 */
export const acknowledgementAudienceEnum = pgEnum("acknowledgement_audience", [
  "all_employees",
  "branch",
  "department",
  "position",
  "employment_type",
  "specific_employees",
  "onboarding",
]);

export const documentAcknowledgementsTable = pgTable(
  "document_acknowledgements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => organizationDocumentsTable.id, { onDelete: "restrict" }),
    /** The EXACT version the obligation is against (§26.19). Never repointed. */
    documentVersionId: integer("document_version_id")
      .notNull()
      .references(() => organizationDocumentVersionsTable.id, { onDelete: "restrict" }),
    status: acknowledgementStatusEnum("status").notNull().default("pending"),
    audience: acknowledgementAudienceEnum("audience").notNull(),
    onboardingInstanceId: integer("onboarding_instance_id").references(() => onboardingInstancesTable.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: integer("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: integer("acknowledged_by").references(() => usersTable.id, { onDelete: "set null" }),
    acknowledgedByName: text("acknowledged_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * One obligation per employee per exact version. This is what makes
     * assignment idempotent under a retried conversion or a re-run audience
     * assignment (§26.34), and it is also why a new version yields a new row
     * instead of mutating the old one.
     */
    uniqueIndex("document_acknowledgements_employee_version_unique").on(
      table.organizationId,
      table.employeeId,
      table.documentVersionId,
    ),
    index("document_acknowledgements_org_status_idx").on(table.organizationId, table.status),
    index("document_acknowledgements_employee_idx").on(table.organizationId, table.employeeId),
    index("document_acknowledgements_instance_idx").on(table.onboardingInstanceId),
  ],
);

export const insertDocumentAcknowledgementSchema = createInsertSchema(documentAcknowledgementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDocumentAcknowledgement = z.infer<typeof insertDocumentAcknowledgementSchema>;
export type DocumentAcknowledgement = typeof documentAcknowledgementsTable.$inferSelect;
