import { pgTable, text, serial, timestamp, integer, boolean, date, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Public Holidays (Phase 2B, W37): org-configurable holidays excluded from
// leave day-counting (W33's calculateLeaveDays already has a
// publicHolidayDates parameter reserved for exactly this). `scope` exists
// now so branch/region/national support can be added later without a
// destructive migration or backfill, but this phase only ever writes
// "organization" — enforced in the service layer, not the schema, per the
// frozen plan's explicit "no code assuming it always will" instruction.
// `date` is the calendar date (no time-of-day component, same as
// leave_requests' startDate/endDate — Architecture Principle 7); for a
// recurring holiday it's a month/day template, the year is only its first
// occurrence. `effectiveYear` is required for a one-off holiday (mirrors
// `date`'s year, but as a plain integer so "holidays for year X" queries
// don't need to extract a year from a date column) and left null for a
// recurring one, which has no single applicable year. `observedDate` only
// applies to a one-off holiday shifted to a weekday — a recurring holiday's
// per-year observed shift isn't representable by one column, so it's
// rejected at the service layer for recurring entries.
export const publicHolidayScopeEnum = pgEnum("public_holiday_scope", ["organization", "branch", "region", "national"]);
export const publicHolidayStatusEnum = pgEnum("public_holiday_status", ["active", "inactive"]);

export const publicHolidaysTable = pgTable(
  "public_holidays",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    date: date("date").notNull(),
    scope: publicHolidayScopeEnum("scope").notNull().default("organization"),
    recurring: boolean("recurring").notNull().default(false),
    observedDate: date("observed_date"),
    effectiveYear: integer("effective_year"),
    description: text("description"),
    status: publicHolidayStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("public_holidays_org_date_name_unique").on(table.organizationId, table.date, table.name),
    index("public_holidays_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertPublicHolidaySchema = createInsertSchema(publicHolidaysTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPublicHoliday = z.infer<typeof insertPublicHolidaySchema>;
export type PublicHoliday = typeof publicHolidaysTable.$inferSelect;
