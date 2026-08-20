import { pgTable, serial, integer, text, boolean, numeric, date, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { performanceReviewsTable } from "./performance-reviews";

// Performance Review Goals (Phase 3C, W73 — Performance Foundation): child
// of a review (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.7).
// Goal rows are review-owned from creation — inherently a SNAPSHOT, no
// separate "goal library" to diverge from (§9). Cascades with its review
// (a review's own goal list is meaningless without the review). Carries its
// own organizationId (redundant with the reviewId FK chain, matching this
// codebase's established defense-in-depth convention for child tables —
// see application_scores.ts) so a cross-tenant link can never be created by
// a straightforward relational constraint alone, not merely by service
// code. No CRUD/approval/scoring behavior in W73 — schema only; W76 owns
// goal management, §11 owns the scoring formula.
export const performanceGoalMeasurementTypeEnum = pgEnum("performance_goal_measurement_type", [
  "numeric",
  "percentage",
  "currency",
  "boolean",
  "rating",
  "qualitative",
]);

export const performanceGoalStatusEnum = pgEnum("performance_goal_status", [
  "not_started",
  "in_progress",
  "completed",
  "missed",
]);

// Replaces the draft's "createdBy" — who authored the goal (§8.7/§12).
export const performanceGoalOriginTypeEnum = pgEnum("performance_goal_origin_type", ["manager", "employee_proposed"]);

// Manager-created goals are inserted 'accepted' immediately (official once
// saved, Owner Decision 4); employee-proposed goals are inserted 'proposed'
// and become official only once the manager accepts during manager_review
// (§12). 'rejected' goals are retained, never deleted, and excluded from
// weighting/scoring. Deliberately no DB-level default — the caller (a
// later workstream's route) always supplies the correct value explicitly
// based on originType, mirroring attendance_events.occurredAt's own
// "no default, caller always supplies it" precedent.
export const performanceGoalApprovalStatusEnum = pgEnum("performance_goal_approval_status", [
  "accepted",
  "proposed",
  "rejected",
]);

export const performanceReviewGoalsTable = pgTable(
  "performance_review_goals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => performanceReviewsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    measurementType: performanceGoalMeasurementTypeEnum("measurement_type").notNull(),
    // Nullable, per type. actualResult is the manager-verified official
    // value (settable only during manager_review) — the employee's own
    // claim lives in employeeComment, not a separate structured column
    // (§8.7 — avoids duplicating structured data for no added scoring
    // value).
    target: numeric("target", { precision: 12, scale: 2 }),
    actualResult: numeric("actual_result", { precision: 12, scale: 2 }),
    unit: text("unit"),
    // Must be 0 for qualitative goals; accepted, non-N/A goals' weights
    // must sum to 100 (§11) — both validated at the service layer (W76),
    // not a DB CHECK constraint, matching how goalsWeight+competenciesWeight
    // summing to 100 is likewise validated at save time, not DB-enforced.
    weight: integer("weight").notNull().default(0),
    dueDate: date("due_date"),
    status: performanceGoalStatusEnum("status").notNull().default("not_started"),
    employeeComment: text("employee_comment"),
    managerComment: text("manager_comment"),
    // Normalized 0-100, computed at manager-submit time (§11); null while
    // approvalStatus != 'accepted'.
    computedScore: numeric("computed_score", { precision: 5, scale: 2 }),
    originType: performanceGoalOriginTypeEnum("origin_type").notNull(),
    approvalStatus: performanceGoalApprovalStatusEnum("approval_status").notNull(),
    // Manager-only, settable during manager_review; reason required when
    // true (service-layer validated); excluded from weighting via
    // proportional redistribution (§11.3).
    notApplicable: boolean("not_applicable").notNull().default(false),
    notApplicableReason: text("not_applicable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_review_goals_org_review_idx").on(table.organizationId, table.reviewId)],
);

export const insertPerformanceReviewGoalSchema = createInsertSchema(performanceReviewGoalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPerformanceReviewGoal = z.infer<typeof insertPerformanceReviewGoalSchema>;
export type PerformanceReviewGoal = typeof performanceReviewGoalsTable.$inferSelect;
