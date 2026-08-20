import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Performance Rating Scales (Phase 3C, W73 — Performance Foundation):
// organization-owned, reusable rating scales (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md
// §8.1) — not hardcoded 1-5. Immutable once any review references it: a
// scale with usageCount > 0 (derived live from performance_cycles/
// performance_review_templates/performance_reviews FK references, never a
// stored counter — mirrors leave_balance_entries' "reconstructed live,
// never stored" discipline) can only be archived, never have its levels
// edited; enforcement is W74's job (CRUD), this table only needs to support
// it structurally. No CRUD/business logic in W73 — schema only.
export const performanceRatingScaleStatusEnum = pgEnum("performance_rating_scale_status", ["active", "archived"]);

export const performanceRatingScalesTable = pgTable(
  "performance_rating_scales",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: performanceRatingScaleStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("performance_rating_scales_org_idx").on(table.organizationId)],
);

export const insertPerformanceRatingScaleSchema = createInsertSchema(performanceRatingScalesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPerformanceRatingScale = z.infer<typeof insertPerformanceRatingScaleSchema>;
export type PerformanceRatingScale = typeof performanceRatingScalesTable.$inferSelect;
