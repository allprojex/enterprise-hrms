import { pgTable, serial, integer, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { payrollStatutoryRuleVersionsTable } from "./payroll-statutory-rule-versions";

// Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.2). Exactly
// one row per payroll_statutory_rule_versions row (ruleType =
// "pension_rates") — four independently-stored percentages, never collapsed
// into one, per the frozen plan's explicit instruction. Independently
// effective-dated from payroll_pension_earnings_ceiling on purpose: SSNIT is
// known (docs/PAYROLL_IMPLEMENTATION_PLAN.md §4.2) to revise the earnings
// ceiling on its own annual cadence, separate from these percentages. No
// numeric Ghana figures are seeded by this workstream.
export const payrollPensionRatesTable = pgTable(
  "payroll_pension_rates",
  {
    id: serial("id").primaryKey(),
    statutoryRuleVersionId: integer("statutory_rule_version_id")
      .notNull()
      .references(() => payrollStatutoryRuleVersionsTable.id, { onDelete: "cascade" }),
    employeeRatePercent: numeric("employee_rate_percent", { precision: 5, scale: 2 }).notNull(),
    employerRatePercent: numeric("employer_rate_percent", { precision: 5, scale: 2 }).notNull(),
    tier1AllocationPercent: numeric("tier1_allocation_percent", { precision: 5, scale: 2 }).notNull(),
    tier2AllocationPercent: numeric("tier2_allocation_percent", { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [uniqueIndex("payroll_pension_rates_version_unique").on(table.statutoryRuleVersionId)],
);

export const insertPayrollPensionRateSchema = createInsertSchema(payrollPensionRatesTable).omit({ id: true });
export type InsertPayrollPensionRate = z.infer<typeof insertPayrollPensionRateSchema>;
export type PayrollPensionRate = typeof payrollPensionRatesTable.$inferSelect;
