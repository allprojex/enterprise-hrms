import { pgTable, serial, integer, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { performanceReviewTemplatesTable } from "./performance-review-templates";

// Performance Template Competencies (Phase 3C, W73 — Performance
// Foundation): child of a template (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md
// §8.4). Free text by default; an organization-defined Master Data domain
// may optionally supply typeahead suggestions later — not FK-enforced here.
// Weights within a template must sum to 100, validated at save time (W74).
// Cascades with its owning template (a template's own competency list is
// meaningless without the template; templates themselves are archived, not
// hard-deleted, in practice). No CRUD/business logic in W73 — schema only.
export const performanceTemplateCompetenciesTable = pgTable(
  "performance_template_competencies",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => performanceReviewTemplatesTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    weight: integer("weight").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("performance_template_competencies_template_idx").on(table.templateId)],
);

export const insertPerformanceTemplateCompetencySchema = createInsertSchema(performanceTemplateCompetenciesTable).omit({
  id: true,
});

export type InsertPerformanceTemplateCompetency = z.infer<typeof insertPerformanceTemplateCompetencySchema>;
export type PerformanceTemplateCompetency = typeof performanceTemplateCompetenciesTable.$inferSelect;
