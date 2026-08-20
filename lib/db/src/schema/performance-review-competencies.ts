import { pgTable, serial, integer, text, boolean, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { performanceReviewsTable } from "./performance-reviews";

// Performance Review Competencies (Phase 3C, W73 — Performance Foundation):
// child of a review, SNAPSHOTTED from a template at review creation
// (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.8) — label/
// description are copied plain text, deliberately NOT a live FK to
// performance_template_competencies, so a later template edit can never
// rewrite existing review criteria (§9). Carries its own organizationId,
// matching performance_review_goals' same defense-in-depth convention. No
// scoring workflow in W73 — schema only; §11 owns the scoring formula.
export const performanceReviewCompetenciesTable = pgTable(
  "performance_review_competencies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    reviewId: integer("review_id")
      .notNull()
      .references(() => performanceReviewsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    // Copied from template; must sum to 100 across a review's competencies
    // — validated at review creation (snapshot time), unaffected thereafter
    // (§11.5).
    weight: integer("weight").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Self-rating — informational/comparative only, structurally excluded
    // from the scoring formula (Owner Decision 1, §11.1).
    employeeRatingValue: numeric("employee_rating_value", { precision: 5, scale: 2 }),
    employeeComment: text("employee_comment"),
    // Authoritative for scoring (§11.1).
    managerRatingValue: numeric("manager_rating_value", { precision: 5, scale: 2 }),
    managerComment: text("manager_comment"),
    // Manager-only, settable during manager_review; reason required when
    // true (service-layer validated); excluded from weighting via
    // proportional redistribution (§11.3).
    notApplicable: boolean("not_applicable").notNull().default(false),
    notApplicableReason: text("not_applicable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_review_competencies_org_review_idx").on(table.organizationId, table.reviewId)],
);

export const insertPerformanceReviewCompetencySchema = createInsertSchema(performanceReviewCompetenciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPerformanceReviewCompetency = z.infer<typeof insertPerformanceReviewCompetencySchema>;
export type PerformanceReviewCompetency = typeof performanceReviewCompetenciesTable.$inferSelect;
