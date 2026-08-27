import { pgTable, serial, integer, numeric, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

/**
 * WS-7 closure — Payroll Opening Balances (Owner Decision: "opening balances
 * must become a distinct Payroll migration concept").
 *
 * WHAT THIS IS: brought-forward payroll/statutory totals for payroll that was
 * already processed OUTSIDE this HRMS, before the organization's cutover into
 * it partway through a tax year. It establishes the employee's starting
 * position for year-to-date reporting and statutory returns.
 *
 * WHAT THIS IS NOT: it is not compensation, not a salary, not a payroll run,
 * not a payslip, not a payment and not a journal. Nothing here is ever paid.
 * `employee_compensation_components` — an effective-dated RATE resolved on
 * every run — remains the sole authority for what an employee is paid, and is
 * deliberately untouched by this table.
 *
 * WHY THE FIELD SET IS EXACTLY THIS: it mirrors, one-for-one, the
 * statutory-meaningful measures `payroll_run_lines` already records for a
 * period. A year-to-date figure is the sum of those measures across a tax
 * year, so brought-forward values must be denominated in the same terms or
 * they cannot be added to in-HRMS runs. Nothing speculative is stored:
 * `netPay` and `otherDeductions` are deliberately OMITTED because neither is
 * a statutory return figure and neither has a consumer.
 *
 * WHY NOTHING FEEDS THE CALCULATION ENGINE: verified against the live engine
 * rather than assumed — Ghana PAYE here is graduated bands applied to the
 * CURRENT period's taxable income (`calculateGraduatedTax`), the SSNIT
 * ceiling clamps the CURRENT period's pensionable earnings
 * (`clampMinor(pensionableEarningsRaw, min, max)`), and bonus tax annualises
 * the CURRENT basic salary (`basicSalaryMinor * 12n`). No calculation input
 * is cumulative, and a repository-wide search found zero existing
 * year-to-date computation. These values therefore feed REPORTING only, which
 * is also what structurally guarantees they can never be re-paid.
 *
 * TAX YEAR: a plain integer, deliberately not a new calendar entity. Payroll
 * periods already carry their year inside `periodKey` ("2026-01") and
 * `startDate`; inventing a second year/calendar model would duplicate that.
 */
export const payrollOpeningBalancesTable = pgTable(
  "payroll_opening_balances",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    /** Calendar tax year these brought-forward totals belong to, e.g. 2026. */
    taxYear: integer("tax_year").notNull(),
    /**
     * The date from which this HRMS becomes authoritative for this employee's
     * payroll. Everything before it is represented by these totals; everything
     * on/after it is represented by real payroll runs in this system.
     */
    cutoverDate: timestamp("cutover_date", { withTimezone: true }).notNull(),
    currency: text("currency").notNull(),

    // Brought-forward totals, same denomination as payroll_run_lines.
    grossEarnings: numeric("gross_earnings", { precision: 14, scale: 2 }).notNull(),
    taxableIncome: numeric("taxable_income", { precision: 14, scale: 2 }).notNull(),
    payeAmount: numeric("paye_amount", { precision: 14, scale: 2 }).notNull(),
    pensionableEarnings: numeric("pensionable_earnings", { precision: 14, scale: 2 }).notNull(),
    employeePensionDeduction: numeric("employee_pension_deduction", { precision: 14, scale: 2 }).notNull(),
    employerPensionContribution: numeric("employer_pension_contribution", { precision: 14, scale: 2 }).notNull(),

    /**
     * Migration traceability (never the source spreadsheet itself): which
     * batch and which row of it produced this record. Also the idempotency
     * key — see the unique index below.
     */
    sourceReferenceType: text("source_reference_type"),
    sourceReferenceId: integer("source_reference_id"),
    sourceRowNumber: integer("source_row_number"),

    /**
     * Set once a locked payroll run has existed for this employee in this tax
     * year — from that point the brought-forward figures have informed
     * finalized payroll history and must not be silently rewritten.
     */
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    updatedByMembershipId: integer("updated_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Exactly one authoritative brought-forward record per employee per tax
    // year. This is the database-level guarantee against contradictory
    // opening balances, and it is also what makes a replayed migration
    // harmless: a retry collides here rather than creating a second record.
    uniqueIndex("payroll_opening_balances_employee_year_unique").on(table.organizationId, table.employeeId, table.taxYear),
    index("payroll_opening_balances_org_year_idx").on(table.organizationId, table.taxYear),
  ],
);

export const insertPayrollOpeningBalanceSchema = createInsertSchema(payrollOpeningBalancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollOpeningBalance = z.infer<typeof insertPayrollOpeningBalanceSchema>;
export type PayrollOpeningBalance = typeof payrollOpeningBalancesTable.$inferSelect;
