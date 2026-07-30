import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Talent Pools (Phase 3A, W53 — Candidate Notes, Tags, and Talent Pools):
// named, reusable candidate collections
// (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9) — deliberately
// never scoped to a single vacancy or requisition; a pool exists
// independently and candidates are added/removed from it across whatever
// campaigns come and go. Active/archived lifecycle mirrors
// `recruitment_workflows.ts`'s exact shape (org-scoped unique name,
// isActive boolean) — the same established pattern for a simple named,
// archivable collection in this codebase.
export const talentPoolsTable = pgTable(
  "talent_pools",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("talent_pools_org_name_unique").on(table.organizationId, table.name), index("talent_pools_org_idx").on(table.organizationId)],
);

export const insertTalentPoolSchema = createInsertSchema(talentPoolsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTalentPool = z.infer<typeof insertTalentPoolSchema>;
export type TalentPool = typeof talentPoolsTable.$inferSelect;
