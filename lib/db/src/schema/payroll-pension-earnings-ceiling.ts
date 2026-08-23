import { pgTable, serial, integer, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { payrollStatutoryRuleVersionsTable } from "./payroll-statutory-rule-versions";

// Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.2). Exactly
// one row per payroll_statutory_rule_versions row (ruleType =
// "pension_earnings_ceiling") — deliberately its own rule type/version
// lineage, independent of payroll_pension_rates, because SSNIT is confirmed
// (docs/PAYROLL_IMPLEMENTATION_PLAN.md §4.2) to revise this ceiling
// annually via its own Public Notice mechanism, on a cadence independent of
// the percentage rates. Both fields nullable: a floor is not confirmed to
// exist at all as of this workstream, and neither is seeded here regardless.
export const payrollPensionEarningsCeilingTable = pgTable(
  "payroll_pension_earnings_ceiling",
  {
    id: serial("id").primaryKey(),
    statutoryRuleVersionId: integer("statutory_rule_version_id")
      .notNull()
      .references(() => payrollStatutoryRuleVersionsTable.id, { onDelete: "cascade" }),
    minimumInsurableEarnings: numeric("minimum_insurable_earnings", { precision: 14, scale: 2 }),
    maximumInsurableEarnings: numeric("maximum_insurable_earnings", { precision: 14, scale: 2 }),
  },
  (table) => [uniqueIndex("payroll_pension_earnings_ceiling_version_unique").on(table.statutoryRuleVersionId)],
);

export const insertPayrollPensionEarningsCeilingSchema = createInsertSchema(payrollPensionEarningsCeilingTable).omit({
  id: true,
});
export type InsertPayrollPensionEarningsCeiling = z.infer<typeof insertPayrollPensionEarningsCeilingSchema>;
export type PayrollPensionEarningsCeiling = typeof payrollPensionEarningsCeilingTable.$inferSelect;
