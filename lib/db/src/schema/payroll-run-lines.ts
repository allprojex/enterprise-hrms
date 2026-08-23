import { pgTable, serial, integer, text, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollRunsTable } from "./payroll-runs";
import { employeesTable } from "./employees";
import { payrollStatutoryRuleVersionsTable } from "./payroll-statutory-rule-versions";

// Payroll, Workstream 3 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §17). One
// row per (run, employee) — never a live join back to compensation or
// statutory tables. `staffNumberSnapshot` is resolved via
// employee_number_allocations AS OF the period's pay date at calculation
// time and stored here — a reused staff number can never cause a later
// holder's payslip to display, or be confused with, a former holder's
// payroll, because this snapshot is permanent and employeeId (employees.id)
// remains the only real identity. The three statutory-rule-version FK
// columns record exactly which approved version was actually used, so a
// later statutory change can never silently alter an already-calculated
// historical line (frozen plan's own "never retroactively recalculates"
// invariant, enforced at the schema level here, not just by convention).
export const payrollRunLinesTable = pgTable(
  "payroll_run_lines",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    payrollRunId: integer("payroll_run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    // Resolved once, at calculation time, via employee_number_allocations
    // as-of the period's payDate — never employees.employeeNumber directly.
    staffNumberSnapshot: text("staff_number_snapshot"),

    payeBandsVersionId: integer("paye_bands_version_id").references(() => payrollStatutoryRuleVersionsTable.id, {
      onDelete: "restrict",
    }),
    pensionRatesVersionId: integer("pension_rates_version_id").references(() => payrollStatutoryRuleVersionsTable.id, {
      onDelete: "restrict",
    }),
    pensionEarningsCeilingVersionId: integer("pension_earnings_ceiling_version_id").references(
      () => payrollStatutoryRuleVersionsTable.id,
      { onDelete: "restrict" },
    ),

    grossEarnings: numeric("gross_earnings", { precision: 12, scale: 2 }).notNull(),
    pensionableEarnings: numeric("pensionable_earnings", { precision: 12, scale: 2 }).notNull(),
    employeePensionDeduction: numeric("employee_pension_deduction", { precision: 12, scale: 2 }).notNull(),
    employerPensionContribution: numeric("employer_pension_contribution", { precision: 12, scale: 2 }).notNull(),
    tier1Amount: numeric("tier1_amount", { precision: 12, scale: 2 }).notNull(),
    tier2Amount: numeric("tier2_amount", { precision: 12, scale: 2 }).notNull(),
    taxableIncome: numeric("taxable_income", { precision: 12, scale: 2 }).notNull(),
    payeAmount: numeric("paye_amount", { precision: 12, scale: 2 }).notNull(),
    otherDeductions: numeric("other_deductions", { precision: 12, scale: 2 }).notNull(),
    netPay: numeric("net_pay", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),

    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payroll_run_lines_run_employee_unique").on(table.payrollRunId, table.employeeId),
    index("payroll_run_lines_org_idx").on(table.organizationId),
    index("payroll_run_lines_employee_idx").on(table.employeeId),
  ],
);

export const insertPayrollRunLineSchema = createInsertSchema(payrollRunLinesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollRunLine = z.infer<typeof insertPayrollRunLineSchema>;
export type PayrollRunLine = typeof payrollRunLinesTable.$inferSelect;
