import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 2 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8). Highly
// sensitive — gated by the distinct, narrow payroll.banking.read/.manage
// permissions (never employee.read, never master_data.manage, never
// personnel_file.*). Reads of this table are audit-logged, a deliberate
// exception to the platform's general read-silence convention (frozen plan
// Decision 9). Effective-dated (an employee can change banks); at most one
// OPEN row per employee, enforced by the partial unique index below —
// changing a bank account closes the prior row rather than overwriting it.
export const employeeBankingDetailsTable = pgTable(
  "employee_banking_details",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    // Free-text code from the "payroll_bank" Master Data domain — same
    // established precedent as employee_compensation_components'
    // componentTypeCode / employees.separationReason.
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    branch: text("branch"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
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
    uniqueIndex("employee_banking_details_open_unique").on(table.employeeId).where(sql`${table.validTo} is null`),
    index("employee_banking_details_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

export const insertEmployeeBankingDetailSchema = createInsertSchema(employeeBankingDetailsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeBankingDetail = z.infer<typeof insertEmployeeBankingDetailSchema>;
export type EmployeeBankingDetail = typeof employeeBankingDetailsTable.$inferSelect;
