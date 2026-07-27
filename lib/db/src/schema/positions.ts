import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";

// Structured job titles, distinct from the free-text jobTitle this replaced
// on employees — lets an org reuse "Registered Nurse" across many employees
// instead of re-typing it, and gives item #8 (Positions and job titles) a
// real entity rather than a text field.
export const positionsTable = pgTable(
  "positions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("positions_org_title_unique").on(table.organizationId, table.title),
    index("positions_org_idx").on(table.organizationId),
  ],
);

export const insertPositionSchema = createInsertSchema(positionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positionsTable.$inferSelect;
