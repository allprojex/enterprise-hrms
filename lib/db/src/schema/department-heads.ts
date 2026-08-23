import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { organizationMembershipsTable } from "./organization-memberships";

// Office Inventory, Workstream 1 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §5). Deliberately NOT Inventory-prefixed — Department Headship is a general
// organizational-authority relationship, not an Inventory-specific concept
// (§5.1), matching `primary_hr_assignments`' own precedent as a general
// org-authority table (id/organizationId/membershipId/assignedAt/assignedBy/
// revokedAt/revokedBy, scaled here to per-department via the partial unique
// index below rather than per-organization).
//
// Effective-dated, half-open [validFrom, validTo) interval — the identical
// pattern already proven by employee_number_allocations/
// employee_compensation_components/employee_banking_details: assigning a new
// Head for a department that already has one open row closes the old row's
// validTo to the new row's validFrom in the same transaction, never deletes
// or overwrites it. A department may legitimately have zero open rows
// (vacant) — never auto-filled, never silently routed to a fallback
// approver (§5.3).
//
// headMembershipId (not employeeId) is the authority-holder identity —
// Department Head is an organization-membership-level authority (the same
// identity every other approval/permission concept in this platform uses),
// not an employee-record concept. `employees.id` remains irrelevant here by
// design; this table answers "who has authority," not "which employee."
export const departmentHeadsTable = pgTable(
  "department_heads",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "restrict" }),
    headMembershipId: integer("head_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    assignedByMembershipId: integer("assigned_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly one current (open) Head per department — the frozen rule
    // (§5.2), database-enforced, not merely an application-layer check.
    uniqueIndex("department_heads_dept_open_unique").on(table.organizationId, table.departmentId).where(sql`${table.validTo} is null`),
    index("department_heads_org_dept_idx").on(table.organizationId, table.departmentId),
    index("department_heads_membership_idx").on(table.headMembershipId),
  ],
);

export const insertDepartmentHeadSchema = createInsertSchema(departmentHeadsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDepartmentHead = z.infer<typeof insertDepartmentHeadSchema>;
export type DepartmentHead = typeof departmentHeadsTable.$inferSelect;
