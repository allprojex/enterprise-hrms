import { pgTable, serial, integer, text, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 3 — Payroll Periods & Calculation Engine
// (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.3, §13). Org-scoped calendar
// definition. `periodKey` is a stable, explicit cycle identity computed at
// creation time from frequency + startDate (e.g. "2026-01" for monthly,
// "2026-W03" for weekly) — the frozen plan's own "one period per
// (org, frequency-cycle)" uniqueness rule, enforced by the unique index
// below. Explicit startDate/endDate/payDate — never inferred later from
// whatever the organization's current numbering/payroll config happens to
// be at query time (frozen plan's own "never a live join" discipline,
// applied here to period boundaries).
export const payrollPeriodFrequencyEnum = pgEnum("payroll_period_frequency", ["monthly", "bi_weekly", "weekly"]);

export const payrollPeriodsTable = pgTable(
  "payroll_periods",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    frequency: payrollPeriodFrequencyEnum("frequency").notNull(),
    periodKey: text("period_key").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    payDate: timestamp("pay_date", { withTimezone: true }).notNull(),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payroll_periods_org_frequency_key_unique").on(table.organizationId, table.frequency, table.periodKey),
    index("payroll_periods_org_idx").on(table.organizationId),
  ],
);

export const insertPayrollPeriodSchema = createInsertSchema(payrollPeriodsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollPeriod = z.infer<typeof insertPayrollPeriodSchema>;
export type PayrollPeriod = typeof payrollPeriodsTable.$inferSelect;
