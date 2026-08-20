import { pgTable, serial, integer, text, date, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { performanceReviewTemplatesTable } from "./performance-review-templates";
import { performanceRatingScalesTable } from "./performance-rating-scales";

// Performance Cycles (Phase 3C, W73 — Performance Foundation): org-owned
// review periods with self-assessment / manager-review / HR-finalization
// windows (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.5). Cycle
// state machine (draft -> open -> closed -> archived, §10.5) is independent
// from a review's own state machine. `open` is the only cycle action that
// mutates data (generates review rows) — not implemented until W75. No
// CRUD/business logic in W73 — schema only.
export const performanceCycleTypeEnum = pgEnum("performance_cycle_type", [
  "annual",
  "semiannual",
  "quarterly",
  "monthly",
  "probation",
  "ad_hoc",
]);

export const performanceCycleStatusEnum = pgEnum("performance_cycle_status", ["draft", "open", "closed", "archived"]);

// A distinct enum type from performance_template_applicability_scope,
// deliberately — cycle-level applicability is its own per-cycle override
// (§8.5), not a shared reference to the template's own enum type, keeping
// each schema file self-contained rather than cross-importing a shared
// Postgres enum object.
export const performanceCycleApplicabilityScopeEnum = pgEnum("performance_cycle_applicability_scope", [
  "all_active",
  "department",
  "position",
  "manual",
]);

export const performanceCyclesTable = pgTable(
  "performance_cycles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    cycleType: performanceCycleTypeEnum("cycle_type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    selfAssessmentWindowStart: date("self_assessment_window_start"),
    selfAssessmentWindowEnd: date("self_assessment_window_end"),
    managerReviewWindowStart: date("manager_review_window_start"),
    managerReviewWindowEnd: date("manager_review_window_end"),
    hrFinalizationWindowStart: date("hr_finalization_window_start"),
    hrFinalizationWindowEnd: date("hr_finalization_window_end"),
    // Default template/rating scale for this cycle's generated reviews.
    templateId: integer("template_id")
      .notNull()
      .references(() => performanceReviewTemplatesTable.id, { onDelete: "restrict" }),
    ratingScaleId: integer("rating_scale_id")
      .notNull()
      .references(() => performanceRatingScalesTable.id, { onDelete: "restrict" }),
    applicabilityScope: performanceCycleApplicabilityScopeEnum("applicability_scope").notNull(),
    applicabilityDepartmentIds: jsonb("applicability_department_ids"),
    applicabilityPositionIds: jsonb("applicability_position_ids"),
    status: performanceCycleStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_cycles_org_idx").on(table.organizationId)],
);

export const insertPerformanceCycleSchema = createInsertSchema(performanceCyclesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPerformanceCycle = z.infer<typeof insertPerformanceCycleSchema>;
export type PerformanceCycle = typeof performanceCyclesTable.$inferSelect;
