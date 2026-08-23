import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollPeriodsTable } from "./payroll-periods";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";
import { payrollCompensationCategoryEnum, payrollTaxableTreatmentEnum } from "./employee-compensation-components";

// Payroll, Workstream 3 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6, §13). The
// explicit, non-automatic bridge from Attendance/Leave/any other module (or
// a direct one-off entry) into a payroll calculation — never an implicit
// join. `sourceType`/`sourceId` mirror employment_periods.eventType's own
// "free-text discriminator, extensible without a schema change" precedent.
// Resolved (Owner Review, W2 report): every input's authority comes from
// the run's own future approval (Workstream 4), covering every input
// transitively — `approvedByMembershipId` stays null throughout W3, unused
// by any route here, reserved should a later workstream want per-input
// approval instead.
export const payrollInputReferencesTable = pgTable(
  "payroll_input_references",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    payrollPeriodId: integer("payroll_period_id")
      .notNull()
      .references(() => payrollPeriodsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    // Free-text discriminator for where this input came from — "manual" for
    // a direct one-off entry, or a future module's own event-type string.
    // Never auto-populated by any existing HR module in this workstream.
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id"),
    category: payrollCompensationCategoryEnum("category").notNull(),
    componentTypeCode: text("component_type_code").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    taxableTreatment: payrollTaxableTreatmentEnum("taxable_treatment").notNull().default("ordinary"),
    description: text("description"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    approvedByMembershipId: integer("approved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payroll_input_references_org_period_idx").on(table.organizationId, table.payrollPeriodId),
    index("payroll_input_references_employee_idx").on(table.employeeId),
  ],
);

export const insertPayrollInputReferenceSchema = createInsertSchema(payrollInputReferencesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPayrollInputReference = z.infer<typeof insertPayrollInputReferenceSchema>;
export type PayrollInputReference = typeof payrollInputReferencesTable.$inferSelect;
