/**
 * WS-26C — generic submission↔domain linkage.
 *
 * A finalized/governed WS-26 form submission may LINK to an existing
 * business-domain record (a leave request, a performance review, an employee
 * lifecycle record, …) without WS-26 ever creating, approving or mutating that
 * record — the domain modules remain the sole authority over their data. The
 * link is purely a tenant-scoped, auditable association.
 *
 * Polymorphic and organization-neutral, following the platform's existing
 * pointer idiom (generated_documents.source_type/source_id): `domain_type` is a
 * short string validated by the service against an allow-list, `domain_entity_id`
 * the target row's id in that domain — no domain-specific columns, no FK to a
 * particular business table (so adding a supported domain never needs a
 * migration). Same-tenant validity and authorization are enforced server-side.
 */
import { pgTable, serial, integer, varchar, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { formSubmissionsTable } from "./form-engine";

export const formSubmissionLinksTable = pgTable(
  "form_submission_links",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => formSubmissionsTable.id, { onDelete: "cascade" }),
    /** Domain family of the linked record (e.g. "leave_request", "performance_review", "employee"). Service allow-listed. */
    domainType: varchar("domain_type", { length: 32 }).notNull(),
    /** The linked record's id within that domain (validated same-org by the service; no cross-table FK). */
    domainEntityId: integer("domain_entity_id").notNull(),
    /** How the submission relates to the record (e.g. "represents", "documents"). */
    relationType: varchar("relation_type", { length: 32 }).notNull().default("represents"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("form_submission_links_unique").on(table.submissionId, table.domainType, table.domainEntityId, table.relationType),
    index("form_submission_links_org_idx").on(table.organizationId),
    index("form_submission_links_org_domain_idx").on(table.organizationId, table.domainType, table.domainEntityId),
  ],
);

export type FormSubmissionLink = typeof formSubmissionLinksTable.$inferSelect;
