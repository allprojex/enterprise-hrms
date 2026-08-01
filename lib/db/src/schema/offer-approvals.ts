import { pgTable, serial, integer, text, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { offerVersionsTable } from "./offer-versions";
import { organizationMembershipsTable } from "./organization-memberships";

// Offer Approval Workflow (Phase 3A, W57 — Offers): a single required
// approval step per offer version submission
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9's own text —
// "mirrors requisition_approvals"). Shape, column-naming, and the
// "sequence exists for a future multi-step chain but this workstream only
// ever writes sequence = 1" precedent are copied directly from
// requisition-approvals.ts. One row per (offerVersionId, sequence); the
// row is mutated in place from "pending" to a final decision, never
// re-created.
//
// §10 names only submit-for-approval / approve / issue / withdraw — no
// "reject" API route exists in this workstream's scope. `decision` still
// carries the same three-value enum as requisition_approvals (per §9's own
// "mirrors" instruction), so "rejected" is a structurally valid but
// currently API-unreachable value, not invented from nothing — reserved
// the same way letterTemplateId is reserved on offer_versions.
export const offerApprovalDecisionEnum = pgEnum("offer_approval_decision", ["pending", "approved", "rejected"]);

export const offerApprovalsTable = pgTable(
  "offer_approvals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    offerVersionId: integer("offer_version_id")
      .notNull()
      .references(() => offerVersionsTable.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(1),
    // Who is authorized to decide is resolved at decision time (organization-
    // wide offer.approve holders) — this column records who actually
    // decided, not a pre-assigned approver, mirroring requisition_approvals'
    // own narrowed approver model (no delegated-approver configuration
    // exists yet in this codebase).
    approverMembershipId: integer("approver_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    decision: offerApprovalDecisionEnum("decision").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("offer_approvals_offer_version_sequence_unique").on(table.offerVersionId, table.sequence),
    index("offer_approvals_org_decision_idx").on(table.organizationId, table.decision),
    index("offer_approvals_offer_version_idx").on(table.offerVersionId),
  ],
);

export const insertOfferApprovalSchema = createInsertSchema(offerApprovalsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOfferApproval = z.infer<typeof insertOfferApprovalSchema>;
export type OfferApproval = typeof offerApprovalsTable.$inferSelect;
