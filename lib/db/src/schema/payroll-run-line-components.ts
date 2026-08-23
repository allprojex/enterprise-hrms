import { pgTable, serial, integer, text, numeric, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { payrollRunLinesTable } from "./payroll-run-lines";
import { payrollCompensationCategoryEnum, payrollTaxableTreatmentEnum } from "./employee-compensation-components";

// Payroll, Workstream 3 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5). The
// itemized breakdown per payroll_run_lines row — the exact calculation
// trace a later payslip/statutory report can render without recalculating
// history from live data (frozen plan's own "true immutable source of
// truth" for §9.5's payroll_run_line_components, now populated). Every row
// here is a frozen copy of the component as it was resolved at calculation
// time (or a one-off input), never a live reference back to
// employee_compensation_components.
export const payrollRunLineComponentSourceEnum = pgEnum("payroll_run_line_component_source", ["recurring", "one_off"]);

export const payrollRunLineComponentsTable = pgTable(
  "payroll_run_line_components",
  {
    id: serial("id").primaryKey(),
    payrollRunLineId: integer("payroll_run_line_id")
      .notNull()
      .references(() => payrollRunLinesTable.id, { onDelete: "cascade" }),
    category: payrollCompensationCategoryEnum("category").notNull(),
    componentTypeCode: text("component_type_code").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    taxableTreatment: payrollTaxableTreatmentEnum("taxable_treatment").notNull(),
    pensionable: boolean("pensionable").notNull(),
    source: payrollRunLineComponentSourceEnum("source").notNull(),
  },
  (table) => [index("payroll_run_line_components_line_idx").on(table.payrollRunLineId)],
);

export const insertPayrollRunLineComponentSchema = createInsertSchema(payrollRunLineComponentsTable).omit({ id: true });
export type InsertPayrollRunLineComponent = z.infer<typeof insertPayrollRunLineComponentSchema>;
export type PayrollRunLineComponent = typeof payrollRunLineComponentsTable.$inferSelect;
