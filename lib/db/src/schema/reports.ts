import { pgTable, serial, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The Reporting Foundation's registry (ADR-016): which reports exist, what
// they're called, and which permission gates running them — mirrors the
// `modules` (W3) / `master_data_domains` (W7) registry pattern. Request-time
// code queries this table, never a seed-time code constant directly. Actual
// report computation lives in artifacts/api-server/src/lib/reporting.ts,
// keyed by `key`.
export const reportsTable = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    description: text("description").notNull().default(""),
    category: varchar("category", { length: 64 }).notNull(),
    // A permission key from the existing catalog (e.g. "employee.read") —
    // reuses per-domain permissions rather than inventing a new one, since
    // every initial report just aggregates data an existing permission
    // already gates read access to.
    requiredPermissionKey: varchar("required_permission_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("reports_key_unique").on(table.key)],
);

export const insertReportSchema = createInsertSchema(reportsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
