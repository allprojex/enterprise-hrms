import { pgTable, serial, integer, text, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { performanceRatingScalesTable } from "./performance-rating-scales";

// Performance Rating Scale Levels (Phase 3C, W73 — Performance Foundation):
// ordered levels within a scale (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md
// §8.2) — e.g. "Exceeds Expectations" = 5. `value` need not be sequential.
// `ratingScaleId` restricts deletion (not cascade) since a scale is never
// hard-deleted once it has levels, only archived (§8.1). No CRUD/business
// logic in W73 — schema only.
export const performanceRatingScaleLevelsTable = pgTable(
  "performance_rating_scale_levels",
  {
    id: serial("id").primaryKey(),
    ratingScaleId: integer("rating_scale_id")
      .notNull()
      .references(() => performanceRatingScalesTable.id, { onDelete: "restrict" }),
    value: numeric("value", { precision: 5, scale: 2 }).notNull(),
    label: text("label").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("performance_rating_scale_levels_scale_value_unique").on(table.ratingScaleId, table.value),
    index("performance_rating_scale_levels_scale_idx").on(table.ratingScaleId),
  ],
);

export const insertPerformanceRatingScaleLevelSchema = createInsertSchema(performanceRatingScaleLevelsTable).omit({
  id: true,
});

export type InsertPerformanceRatingScaleLevel = z.infer<typeof insertPerformanceRatingScaleLevelSchema>;
export type PerformanceRatingScaleLevel = typeof performanceRatingScaleLevelsTable.$inferSelect;
