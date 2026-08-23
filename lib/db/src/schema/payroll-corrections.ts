import { pgTable, serial, integer, text, numeric, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { payrollRunsTable } from "./payroll-runs";
import { payrollRunLinesTable } from "./payroll-run-lines";
import { employeesTable } from "./employees";
import { payrollStatutoryRuleVersionsTable } from "./payroll-statutory-rule-versions";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 4 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §11,
// §13). Append-only: a correction NEVER edits payroll_run_lines in place —
// it references the original locked run/line and produces its own,
// separately-approved adjustment record, mirroring the personnel-file-
// movement/employee-number-allocation "never mutate history" convention.
//
// Every correction attaches directly to the ORIGINAL run line, never to a
// prior correction — a deliberate, disclosed design choice that prevents
// chain/cycle complexity by construction rather than by an extra
// validation rule (the frozen plan does not specify multi-level correction
// chains, and inventing one would be scope creep).
//
// The corrected figures are computed by re-invoking W3's own
// calculateEmployeePayroll for the ORIGINAL period's payDate (never
// "today") — so a correction naturally re-resolves whatever compensation/
// statutory data is now on file as of that historical date, never assumes
// the newest statutory version, and re-resolves the staff-number snapshot
// via the same as-of logic as the original run (§17 compatibility). The
// original run/line is never touched.
//
// Lifecycle: draft -> approved. Maker-checker enforced the same way as W1's
// statutory rules — a single permission (payroll.run.correct) gates both
// create and approve, with a server-side check that the approving
// membership differs from the creating membership (never merely a missing
// frontend affordance). No further "locked" state is needed: approval is
// itself terminal/immutable for a correction record.
//
// At most one DRAFT (unapproved) correction may be open at a time per
// original run line — the same "at most one open row" partial-unique-index
// pattern used everywhere else in this platform — preventing two
// simultaneously-pending, potentially-conflicting corrections for the same
// line. Multiple SEQUENTIAL corrections (each already approved) for the
// same line remain allowed — not an invented one-correction-per-line limit.
export const payrollCorrectionStatusEnum = pgEnum("payroll_correction_status", ["draft", "approved"]);

export const payrollCorrectionsTable = pgTable(
  "payroll_corrections",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    originalRunId: integer("original_run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "restrict" }),
    originalRunLineId: integer("original_run_line_id")
      .notNull()
      .references(() => payrollRunLinesTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    status: payrollCorrectionStatusEnum("status").notNull().default("draft"),
    reason: text("reason").notNull(),

    // Resolved once, at correction-calculation time, via
    // employee_number_allocations as-of the ORIGINAL period's payDate —
    // identical discipline to payroll_run_lines.staffNumberSnapshot.
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
    // correctedNetPay - originalRunLine.netPay, computed once at creation —
    // spares every historical reader from having to diff two rows by hand.
    netPayDelta: numeric("net_pay_delta", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),

    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    approvedByMembershipId: integer("approved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_corrections_open_draft_per_line_unique")
      .on(table.originalRunLineId)
      .where(sql`${table.status} = 'draft'`),
    index("payroll_corrections_org_idx").on(table.organizationId),
    index("payroll_corrections_original_run_idx").on(table.originalRunId),
    index("payroll_corrections_employee_idx").on(table.employeeId),
  ],
);

export const insertPayrollCorrectionSchema = createInsertSchema(payrollCorrectionsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPayrollCorrection = z.infer<typeof insertPayrollCorrectionSchema>;
export type PayrollCorrection = typeof payrollCorrectionsTable.$inferSelect;
