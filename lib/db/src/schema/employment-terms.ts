import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

/**
 * WS-11 — Employment terms (contract terms)
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §27.5–27.7, OD #8).
 *
 * WHY THIS TABLE EXISTS AT ALL. §27.5 settled it from evidence: a live term
 * cannot live in `employment_periods` (an append-only event log with no
 * current-state fields, so it cannot answer "when does this contract
 * expire?"), cannot be a single `employees.contractEndDate` (that destroys
 * history, which OD #8's "historical integrity" forbids), and cannot be
 * `employment_particulars` (an offer-keyed snapshot frozen at issuance, which
 * cannot serve an employee who never had an offer).
 *
 * §27.22 ITEM 1 RESOLVED — ONE TABLE, NOT AN ENVELOPE/VERSION PAIR.
 * The offers/offer_versions and organization_documents/versions shape models
 * *revisions of one thing*. A renewal is not a revision: the old term genuinely
 * ended and a new one genuinely began, with its own dates and its own legal
 * meaning. Modelling that as versions of a single envelope would misstate what
 * happened. The chain is therefore a linked list of distinct terms via
 * `renewedFromTermId`, which keeps every historical term intact and readable
 * end to end (§27.7).
 *
 * `status` carries only what cannot be derived. Whether a term is current,
 * expiring soon or expired is computed from its dates and the current instant
 * (§27.6) and is deliberately NOT stored — a persisted "expired" flag would be
 * wrong the moment the clock moved. What IS stored is the lifecycle fact that
 * no clock can produce: whether this term is the live one, was replaced by a
 * renewal, or was explicitly closed.
 *
 * NOTHING HERE TERMINATES ANYONE. An `endDate` in the past does not separate an
 * employee and never triggers separation (§27.6): renewal, extension,
 * administrative delay or a statutory requirement may all intervene, and the
 * system cannot know which.
 */

export const employmentTermTypeEnum = pgEnum("employment_term_type", ["permanent", "fixed_term"]);

/**
 * Lifecycle state, not expiry state.
 *   active     — the live term for this employee.
 *   superseded — replaced by a renewal; preserved, never rewritten.
 *   closed     — explicitly ended by an authorized action.
 */
export const employmentTermStatusEnum = pgEnum("employment_term_status", ["active", "superseded", "closed"]);

export const employmentTermsTable = pgTable(
  "employment_terms",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    termType: employmentTermTypeEnum("term_type").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    /** Null for a permanent term. Required for a fixed term (enforced in the service). */
    endDate: timestamp("end_date", { withTimezone: true }),
    status: employmentTermStatusEnum("status").notNull().default("active"),
    /** The renewal chain. Self-referencing, nullable for an original term. */
    renewedFromTermId: integer("renewed_from_term_id").references((): AnyPgColumn => employmentTermsTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: integer("closed_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * At most one ACTIVE term per employee, guaranteed by the database rather
     * than by a read-then-write check two concurrent renewals could both pass.
     * Superseded and closed terms are excluded, so the full history remains.
     */
    uniqueIndex("employment_terms_active_per_employee_unique")
      .on(table.organizationId, table.employeeId)
      .where(sql`status = 'active'`),
    index("employment_terms_org_employee_idx").on(table.organizationId, table.employeeId),
    /** Supports the contract-expiry sweep without scanning every term. */
    index("employment_terms_expiry_idx").on(table.organizationId, table.endDate),
    index("employment_terms_renewed_from_idx").on(table.renewedFromTermId),
  ],
);

export const insertEmploymentTermSchema = createInsertSchema(employmentTermsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmploymentTerm = z.infer<typeof insertEmploymentTermSchema>;
export type EmploymentTerm = typeof employmentTermsTable.$inferSelect;
