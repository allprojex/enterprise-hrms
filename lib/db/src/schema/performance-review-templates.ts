import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { performanceRatingScalesTable } from "./performance-rating-scales";

// Performance Review Templates (Phase 3C, W73 — Performance Foundation):
// reusable, snapshot-preserved competency sets + weighting + rating scale
// reference (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.3).
// Editing an active template only affects reviews created *after* the edit
// — existing reviews already snapshotted their competencies/weights (§9),
// so no template-versioning table is needed. `goalsWeight`+
// `competenciesWeight` must sum to 100, validated at save time (W74) —
// schema only ensures the columns exist, not the invariant. No CRUD/
// business logic in W73 — schema only.
export const performanceTemplateStatusEnum = pgEnum("performance_template_status", ["draft", "active", "archived"]);

export const performanceTemplateApplicabilityScopeEnum = pgEnum("performance_template_applicability_scope", [
  "all_active",
  "department",
  "position",
  "manual",
]);

export const performanceReviewTemplatesTable = pgTable(
  "performance_review_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    ratingScaleId: integer("rating_scale_id")
      .notNull()
      .references(() => performanceRatingScalesTable.id, { onDelete: "restrict" }),
    goalsWeight: integer("goals_weight").notNull(),
    competenciesWeight: integer("competencies_weight").notNull(),
    applicabilityScope: performanceTemplateApplicabilityScopeEnum("applicability_scope").notNull(),
    // jsonb integer arrays — filter config, not a relational entity (§8.3).
    applicabilityDepartmentIds: jsonb("applicability_department_ids"),
    applicabilityPositionIds: jsonb("applicability_position_ids"),
    status: performanceTemplateStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_review_templates_org_idx").on(table.organizationId)],
);

export const insertPerformanceReviewTemplateSchema = createInsertSchema(performanceReviewTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPerformanceReviewTemplate = z.infer<typeof insertPerformanceReviewTemplateSchema>;
export type PerformanceReviewTemplate = typeof performanceReviewTemplatesTable.$inferSelect;
