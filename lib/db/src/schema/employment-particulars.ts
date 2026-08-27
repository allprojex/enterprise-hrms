import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { offerVersionsTable } from "./offer-versions";
import { organizationMembershipsTable } from "./organization-memberships";

/**
 * WS-9 — Employment Particulars (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.8–25.9).
 *
 * The written statement of main employment terms. Ghana's Labour Act, 2003
 * (Act 651) §13 requires an employer to furnish this to a worker within two
 * months of commencement, in the form set out in Schedule 1, signed by both
 * parties. Nothing in this table is branded as a jurisdiction-specific form —
 * the fields use ordinary HR terminology and are usable by any organization;
 * only a *generated document* would carry statutory form wording.
 *
 * ARCHITECTURE DECISION (§25.9 left this open; recorded here with its reason).
 * This is a **separate, strictly linked versioned record** rather than ~16 more
 * columns on `offer_versions`. Three reasons, in order of weight:
 *
 *   1. `offer_versions` is already the immutable revision of the *offer*. An
 *      offer and the employment terms it proposes are different concepts with
 *      different lifetimes — later workstreams (confirmation, promotion,
 *      transfer, service letters) need particulars without an offer at all,
 *      and a one-to-one row keyed on `offerVersionId` today can gain a second
 *      nullable owner column later without disturbing offers.
 *   2. Normalization: sixteen mostly-text columns describing employment terms
 *      are not attributes of an offer revision; they are a document's content.
 *   3. Document generation reads one coherent record rather than a projection
 *      spread across an offer version and several live policy tables.
 *
 * SNAPSHOT DISCIPLINE (§25.9). Before issuance, particulars may be *derived*
 * from authoritative owners (organization, position, compensation, Leave
 * policy, pension configuration). At issuance the resolved text is written
 * here and never changes again. That is the whole point: if an organization
 * edits its leave policy next year, a statement already furnished to a worker
 * must still read exactly as furnished. `derivedFrom` records which
 * authoritative sources were consulted, for traceability — it is provenance,
 * not a live reference.
 *
 * Schedule 1 numbers notice as a single item with employer and worker
 * sub-parts; that legal meaning is preserved by two columns rather than
 * forcing one (§25.8), which is a representation choice, not a change of
 * meaning.
 */
export const employmentParticularsTable = pgTable(
  "employment_particulars",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /**
     * The offer revision these terms belong to. One-to-one: a revision
     * proposes exactly one set of terms. Nullable owner columns for
     * non-offer origins (confirmation, promotion) can be added additively by
     * a later workstream without touching what is here.
     */
    offerVersionId: integer("offer_version_id")
      .notNull()
      .references(() => offerVersionsTable.id, { onDelete: "cascade" }),

    // --- Schedule 1 content, in ordinary HR terminology -------------------
    employerName: text("employer_name"),
    workerName: text("worker_name"),
    /** Schedule 1's "date of first appointment". */
    dateOfFirstAppointment: timestamp("date_of_first_appointment", { withTimezone: true }),
    jobTitleOrGrade: text("job_title_or_grade"),
    /** Rate, method and intervals of pay — kept as three fields so a document can render them separately. */
    payRate: text("pay_rate"),
    payMethod: text("pay_method"),
    payInterval: text("pay_interval"),
    hoursOfWork: text("hours_of_work"),
    /** Holiday periods and holiday-pay details. Derived from Leave configuration, then frozen. */
    holidayTerms: text("holiday_terms"),
    /** Sickness/injury incapacity conditions and sick-pay details, "if any" per Schedule 1. */
    sickPayTerms: text("sick_pay_terms"),
    /** Social-security or pension scheme details. Never duplicates Payroll's statutory identifiers. */
    pensionTerms: text("pension_terms"),
    /** Schedule 1 item: notice, with employer and worker sub-parts. */
    noticeByEmployer: text("notice_by_employer"),
    noticeByWorker: text("notice_by_worker"),
    disciplinaryRules: text("disciplinary_rules"),
    grievanceProcedure: text("grievance_procedure"),
    /** Overtime payment details, "if any" per Schedule 1. */
    overtimeTerms: text("overtime_terms"),
    /**
     * Probation terms as they apply to THIS employment. Deliberately free
     * text with no default: §25.9 forbids hard-coding any universal duration,
     * and the reconciliation records that no numeric Ghana limit was
     * established from primary text.
     */
    probationTerms: text("probation_terms"),

    /**
     * Provenance only: which authoritative records the drafted values were
     * derived from (e.g. `{ leavePolicyId, positionId, compensationSource }`).
     * Never read as a live reference once issued — see this file's header.
     */
    derivedFrom: jsonb("derived_from"),

    /**
     * Null while the particulars are still a draft attached to a draft offer.
     * Once set, the row is frozen: the service refuses every further edit,
     * which is what makes an already-furnished statement reproducible.
     */
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedByMembershipId: integer("issued_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),

    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("employment_particulars_offer_version_unique").on(table.offerVersionId),
    index("employment_particulars_org_idx").on(table.organizationId),
  ],
);

export const insertEmploymentParticularsSchema = createInsertSchema(employmentParticularsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmploymentParticulars = z.infer<typeof insertEmploymentParticularsSchema>;
export type EmploymentParticulars = typeof employmentParticularsTable.$inferSelect;
