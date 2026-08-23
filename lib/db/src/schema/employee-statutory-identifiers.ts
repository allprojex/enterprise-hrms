import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 2 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.8). SSNIT
// number / TIN — sensitive statutory personal identifiers, deliberately kept
// off the core `employees` table (which Phase 3H's own W120 verification
// already confirmed carries zero speculative sensitive fields) and gated by
// the distinct, narrow payroll.statutory_identifiers.read/.manage
// permissions. Reads are audit-logged (frozen plan Decision 9), same
// treatment as employee_banking_details. Effective-dated for correction/
// re-issuance; at most one OPEN row per employee.
export const employeeStatutoryIdentifiersTable = pgTable(
  "employee_statutory_identifiers",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    ssnitNumber: text("ssnit_number"),
    tin: text("tin"),
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
    uniqueIndex("employee_statutory_identifiers_open_unique").on(table.employeeId).where(sql`${table.validTo} is null`),
    index("employee_statutory_identifiers_org_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

export const insertEmployeeStatutoryIdentifierSchema = createInsertSchema(employeeStatutoryIdentifiersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeStatutoryIdentifier = z.infer<typeof insertEmployeeStatutoryIdentifierSchema>;
export type EmployeeStatutoryIdentifier = typeof employeeStatutoryIdentifiersTable.$inferSelect;
