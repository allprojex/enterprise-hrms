import { pgTable, serial, integer, text, numeric, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollPaymentBatchesTable } from "./payroll-payment-batches";
import { payrollRunLinesTable } from "./payroll-run-lines";
import { payrollCorrectionsTable } from "./payroll-corrections";
import { employeesTable } from "./employees";

// Payroll, Frozen Workstream 8 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6).
// One row per employee included in a payment batch. `amount`/`bankCode`/
// `accountNumber`/`accountName`/`branch` are all snapshotted at batch-
// creation time — amount from the run line's (or, if one exists, the
// latest approved correction's) already-authoritative net pay, banking
// from employee_banking_details' currently-open row at that instant — never
// a live join thereafter. If the employee later changes bank accounts, this
// row is untouched (§7/§30 of this workstream's own prompt: "do not
// silently rewrite an approved/exported payment instruction").
//
// `employeeId` (employees.id) is the sole identity; `staffNumberSnapshot`
// is copied from the source run line for display only — a reused staff
// number can never cause this row to be misattributed to a later holder.
export const payrollPaymentBatchLinesTable = pgTable(
  "payroll_payment_batch_lines",
  {
    id: serial("id").primaryKey(),
    paymentBatchId: integer("payment_batch_id")
      .notNull()
      .references(() => payrollPaymentBatchesTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    payrollRunLineId: integer("payroll_run_line_id")
      .notNull()
      .references(() => payrollRunLinesTable.id, { onDelete: "restrict" }),
    // Which approved correction (if any) this line's snapshotted amount was
    // sourced from — null means the original run line's own net pay was
    // used. Preserves full traceability without inventing delta-payment
    // accounting (§12/§24 — never silently blended).
    sourceCorrectionId: integer("source_correction_id").references(() => payrollCorrectionsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    staffNumberSnapshot: text("staff_number_snapshot"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    branch: text("branch"),
    paymentReference: text("payment_reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payroll_payment_batch_lines_batch_line_unique").on(table.paymentBatchId, table.payrollRunLineId),
    uniqueIndex("payroll_payment_batch_lines_reference_unique").on(table.paymentReference),
    index("payroll_payment_batch_lines_batch_idx").on(table.paymentBatchId),
    index("payroll_payment_batch_lines_org_idx").on(table.organizationId),
    index("payroll_payment_batch_lines_employee_idx").on(table.employeeId),
  ],
);

export const insertPayrollPaymentBatchLineSchema = createInsertSchema(payrollPaymentBatchLinesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPayrollPaymentBatchLine = z.infer<typeof insertPayrollPaymentBatchLineSchema>;
export type PayrollPaymentBatchLine = typeof payrollPaymentBatchLinesTable.$inferSelect;
