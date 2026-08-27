import { pgTable, serial, integer, text, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { jobRequisitionsTable } from "./job-requisitions";
import { organizationMembershipsTable } from "./organization-memberships";

// Requisition Approval Workflow (Phase 3A, W47 in the frozen plan's own
// numbering — this session's W46): a single required approval step per
// requisition submission (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9's requisition_approvals row shape). `sequence` exists now so a later
// workstream can extend to a genuine multi-step chain without a schema
// change, but this workstream only ever writes sequence = 1 — mirrors
// job_requisitions' own precedent of defining the full shape early while
// writing only a narrow subset now. One row per (requisitionId, sequence);
// the row is mutated in place from "pending" to a final decision — it is
// never re-created — matching the frozen plan's "append, one active
// pending row at a time" (a decided row is never edited further, only the
// next sequence's row, if any, is ever inserted next).
export const requisitionApprovalDecisionEnum = pgEnum("requisition_approval_decision", [
  "pending",
  "approved",
  "rejected",
]);

export const requisitionApprovalsTable = pgTable(
  "requisition_approvals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requisitionId: integer("requisition_id")
      .notNull()
      .references(() => jobRequisitionsTable.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(1),
    // Who is authorized to decide is resolved at decision time (organization-
    // wide requisition.approve holders, per this workstream's narrowed
    // approver model — see the service layer) — this column records who
    // actually decided, not a pre-assigned approver, since no delegated-
    // approver configuration exists yet in this codebase.
    approverMembershipId: integer("approver_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    decision: requisitionApprovalDecisionEnum("decision").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    // --- WS-9 additive columns (MASTER_OWNER_REVIEW §25.2-25.3) -----------
    // The `sequence` column above anticipated a real multi-step chain; WS-9
    // supplies it. These four record WHICH configured stage a row belongs to
    // and WHY its actor was entitled to decide, snapshotted at decision time.
    //
    // They are snapshots on purpose: current authority and historical decision
    // identity are different facts. Replacing a department head, revoking a
    // role or reconfiguring the chain must never change what an existing
    // decision record says. All four are nullable so every pre-WS-9 row stays
    // valid exactly as written — enforcement is prospective (§25.4).
    stageName: text("stage_name"),
    resolverType: text("resolver_type"),
    /** Human-readable statement of the authority relied on, e.g. "Department head of Finance". */
    authorityBasis: text("authority_basis"),
    /** Actor's name as at decision time — survives renames and membership removal. */
    decidedByNameSnapshot: text("decided_by_name_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("requisition_approvals_requisition_sequence_unique").on(table.requisitionId, table.sequence),
    index("requisition_approvals_org_decision_idx").on(table.organizationId, table.decision),
    index("requisition_approvals_requisition_idx").on(table.requisitionId),
  ],
);

export const insertRequisitionApprovalSchema = createInsertSchema(requisitionApprovalsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRequisitionApproval = z.infer<typeof insertRequisitionApprovalSchema>;
export type RequisitionApproval = typeof requisitionApprovalsTable.$inferSelect;
