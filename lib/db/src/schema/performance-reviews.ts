import { pgTable, serial, integer, text, boolean, numeric, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { positionsTable } from "./positions";
import { performanceCyclesTable } from "./performance-cycles";
import { performanceReviewTemplatesTable } from "./performance-review-templates";
import { performanceRatingScalesTable } from "./performance-rating-scales";

// Performance Reviews (Phase 3C, W73 — Performance Foundation): the
// instance — one per employee per cycle
// (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.6). `status` is the
// SOLE authoritative workflow-stage field (§10) — the *SubmittedAt/
// *FinalizedAt/acknowledgedAt timestamps below are informational metadata
// only, never read by any authorization/business-logic check to infer
// stage; no route or service function anywhere may branch on a nullable
// timestamp instead of `status` (enforced at the function-signature level
// from W76 onward, per §36's Definition of Done). No transitions are
// implemented in W73 — schema only.
//
// Historical integrity (§9): employeeId is a LIVE REFERENCE (identity is
// permanent, never snapshotted); reviewerEmployeeId/departmentIdSnapshot/
// positionIdSnapshot are SNAPSHOTs of the employee's state at assignment
// time, fixed even if the employee's manager/department/position later
// changes; templateId/ratingScaleId are retained for traceability only,
// never re-consulted for content after creation — the rating scale itself
// stays a safe live reference only because it is structurally immutable
// once used (see performance-rating-scales.ts).
export const performanceReviewStatusEnum = pgEnum("performance_review_status", [
  "draft",
  "self_assessment",
  "manager_review",
  "hr_review",
  "finalized",
  "acknowledged",
]);

export const performanceReviewsTable = pgTable(
  "performance_reviews",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => performanceCyclesTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => performanceReviewTemplatesTable.id, { onDelete: "restrict" }),
    ratingScaleId: integer("rating_scale_id")
      .notNull()
      .references(() => performanceRatingScalesTable.id, { onDelete: "restrict" }),
    // Historical business record — restrict, never cascade, so deleting an
    // employee record can never silently erase review history.
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    // Snapshot of employees.reportingManagerId at assignment time — fixed
    // for this review even if the employee's manager later changes (§9).
    reviewerEmployeeId: integer("reviewer_employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
    departmentIdSnapshot: integer("department_id_snapshot").references(() => departmentsTable.id, { onDelete: "restrict" }),
    positionIdSnapshot: integer("position_id_snapshot").references(() => positionsTable.id, { onDelete: "restrict" }),
    // Copied from the template at review creation (§9) — never re-read from
    // the template afterward.
    goalsWeight: integer("goals_weight").notNull(),
    competenciesWeight: integer("competencies_weight").notNull(),
    // Copied from the `performance` organization_settings namespace at
    // creation time — a later org-wide change never alters an existing
    // review (§9).
    scoringPrecisionSnapshot: integer("scoring_precision_snapshot").notNull(),
    acknowledgementRequiredSnapshot: boolean("acknowledgement_required_snapshot").notNull(),
    status: performanceReviewStatusEnum("status").notNull().default("draft"),
    // Informational metadata only — see file header. Never authoritative.
    selfAssessmentSubmittedAt: timestamp("self_assessment_submitted_at", { withTimezone: true }),
    managerReviewSubmittedAt: timestamp("manager_review_submitted_at", { withTimezone: true }),
    hrFinalizedAt: timestamp("hr_finalized_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    employeeFinalComment: text("employee_final_comment"),
    // Always the scoring formula's output (§11) — never overwritten by an
    // HR override; the override is stored separately below.
    computedOverallScore: numeric("computed_overall_score", { precision: 5, scale: 2 }),
    hrOverrideScore: numeric("hr_override_score", { precision: 5, scale: 2 }),
    hrOverrideReason: text("hr_override_reason"),
    // Incremented by 1 on every HR reopen action (§10.4) — a lightweight,
    // purely informational counter; full change detail lives in
    // audit_events' beforeState/afterState, not a new revision-row table.
    revisionNumber: integer("revision_number").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("performance_reviews_cycle_employee_unique").on(table.cycleId, table.employeeId),
    index("performance_reviews_org_employee_idx").on(table.organizationId, table.employeeId),
    index("performance_reviews_org_reviewer_idx").on(table.organizationId, table.reviewerEmployeeId),
    index("performance_reviews_org_cycle_status_idx").on(table.organizationId, table.cycleId, table.status),
  ],
);

export const insertPerformanceReviewSchema = createInsertSchema(performanceReviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPerformanceReview = z.infer<typeof insertPerformanceReviewSchema>;
export type PerformanceReview = typeof performanceReviewsTable.$inferSelect;
