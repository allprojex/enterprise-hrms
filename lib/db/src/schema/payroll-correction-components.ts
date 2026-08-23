import { pgTable, serial, integer, text, numeric, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { payrollCorrectionsTable } from "./payroll-corrections";
import { payrollCompensationCategoryEnum, payrollTaxableTreatmentEnum } from "./employee-compensation-components";
import { payrollRunLineComponentSourceEnum } from "./payroll-run-line-components";

// Payroll, Workstream 4 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §11).
// The itemized breakdown per payroll_corrections row — mirrors
// payroll_run_line_components exactly, so a correction's own calculation
// trace is just as fully preserved and historically reproducible as an
// original run's. Every row here is a frozen copy captured at correction-
// calculation time, never a live reference back to compensation.
export const payrollCorrectionComponentsTable = pgTable(
  "payroll_correction_components",
  {
    id: serial("id").primaryKey(),
    payrollCorrectionId: integer("payroll_correction_id")
      .notNull()
      .references(() => payrollCorrectionsTable.id, { onDelete: "cascade" }),
    category: payrollCompensationCategoryEnum("category").notNull(),
    componentTypeCode: text("component_type_code").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    taxableTreatment: payrollTaxableTreatmentEnum("taxable_treatment").notNull(),
    pensionable: boolean("pensionable").notNull(),
    source: payrollRunLineComponentSourceEnum("source").notNull(),
  },
  (table) => [index("payroll_correction_components_correction_idx").on(table.payrollCorrectionId)],
);

export const insertPayrollCorrectionComponentSchema = createInsertSchema(payrollCorrectionComponentsTable).omit({ id: true });
export type InsertPayrollCorrectionComponent = z.infer<typeof insertPayrollCorrectionComponentSchema>;
export type PayrollCorrectionComponent = typeof payrollCorrectionComponentsTable.$inferSelect;
