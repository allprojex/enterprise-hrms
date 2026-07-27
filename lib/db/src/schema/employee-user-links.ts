import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";
import { usersTable } from "./users";
import { organizationMembershipsTable } from "./organization-memberships";

// Bridges an employee record to a login only when one actually exists. This
// row's presence/absence is metadata only — it never grants or implies
// access; access always flows through organization_memberships.
export const employeeUserLinksTable = pgTable(
  "employee_user_links",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    applicationUserId: integer("application_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    organizationMembershipId: integer("organization_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    linkedBy: integer("linked_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("employee_user_links_employee_unique").on(table.employeeId),
    uniqueIndex("employee_user_links_user_membership_unique").on(
      table.applicationUserId,
      table.organizationMembershipId,
    ),
    index("employee_user_links_user_idx").on(table.applicationUserId),
  ],
);

export const insertEmployeeUserLinkSchema = createInsertSchema(employeeUserLinksTable).omit({
  id: true,
  linkedAt: true,
});

export type InsertEmployeeUserLink = z.infer<typeof insertEmployeeUserLinkSchema>;
export type EmployeeUserLink = typeof employeeUserLinksTable.$inferSelect;
