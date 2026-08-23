import { pgTable, serial, integer, text, numeric, boolean, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 2 — Employee Compensation
// (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.4). The SOLE payroll authority for
// compensation — never `offer_versions.compensationSummary`, never
// `job_requisitions.salaryRange*`, both of which remain exactly what they
// already are (unstructured, recruitment-time, never read by Payroll).
//
// `employeeId` -> employees.id, never a staff/PIF number (Phase 3H
// compatibility, frozen plan §17) — a reused staff number must never cause
// this table to misattribute compensation between the former and current
// holder, since nothing here ever references the number at all.
//
// `category` + `componentTypeCode` together identify which master-data item
// (payroll_earning_component_type or payroll_deduction_component_type) this
// row's component is — free-text code validated against master_data_items
// in the service layer, not FK-enforced, mirroring employees.separationReason's
// own established "free-text code from a Master Data domain" precedent
// (no composite FK is natively expressible against that table's own
// domain+code partial-unique pattern).
//
// Effective-dating: half-open validFrom/validTo, resolved as-of a pay date
// via a pickAllocationAsOf-style helper (lib/payrollCompensation.ts) — the
// exact pattern already proven twice (employee_number_allocations,
// leave_policies). The partial unique index below guarantees at most one
// OPEN row per (employee, category, componentTypeCode) — changing basic
// salary never overwrites the prior amount, it closes the prior row and
// opens a new one, preserving full historical reproducibility.
export const payrollCompensationCategoryEnum = pgEnum("payroll_compensation_category", ["earning", "deduction"]);
export const payrollTaxableTreatmentEnum = pgEnum("payroll_taxable_treatment", [
  "ordinary",
  "benefit_in_kind",
  "bonus",
  "overtime",
]);

export const employeeCompensationComponentsTable = pgTable(
  "employee_compensation_components",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    category: payrollCompensationCategoryEnum("category").notNull(),
    componentTypeCode: text("component_type_code").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    // Recurring vs one-off, per the frozen plan's explicit W2 boundary — a
    // one-off PAYROLL-PERIOD input (e.g. a single bonus tied to one specific
    // run) belongs to payroll_input_references in a later workstream; this
    // flag here only distinguishes a recurring compensation component from
    // a standing one-off compensation adjustment entered the same way as
    // any other component (still effective-dated, still historically
    // resolved) — never a run-time input.
    recurring: boolean("recurring").notNull().default(true),
    taxableTreatment: payrollTaxableTreatmentEnum("taxable_treatment").notNull().default("ordinary"),
    // Whether this component counts toward the pension (SSNIT/Tier 2)
    // contribution base — frozen plan §4.2 confirms "basic salary" is the
    // consistently-used contribution base; other components are not
    // automatically pensionable. Reconciled addition to §9.4's field list
    // (the frozen text names taxableTreatment but not this flag) per this
    // workstream's own explicit "pensionable/non-pensionable classification"
    // requirement — disclosed, not silently invented.
    pensionable: boolean("pensionable").notNull().default(false),
    // Nullable, explicit-only pointer (e.g. to an employment_periods row),
    // never auto-populated — mirrors the frozen plan's own "never auto-infer"
    // instruction (Owner Decision 2's own principle, applied here).
    sourceReferenceType: text("source_reference_type"),
    sourceReferenceId: integer("source_reference_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
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
    uniqueIndex("employee_compensation_components_open_unique")
      .on(table.employeeId, table.category, table.componentTypeCode)
      .where(sql`${table.validTo} is null`),
    index("employee_compensation_components_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

export const insertEmployeeCompensationComponentSchema = createInsertSchema(employeeCompensationComponentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeCompensationComponent = z.infer<typeof insertEmployeeCompensationComponentSchema>;
export type EmployeeCompensationComponent = typeof employeeCompensationComponentsTable.$inferSelect;
