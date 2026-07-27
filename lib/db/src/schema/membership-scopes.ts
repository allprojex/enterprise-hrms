import { pgTable, serial, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationMembershipsTable } from "./organization-memberships";
import { branchesTable } from "./branches";
import { departmentsTable } from "./departments";

// "custom" is reserved for future predicate-based scoping; no application
// logic consumes it yet. Zero rows for a membership means org-wide scope.
export const membershipScopeTypeEnum = pgEnum("membership_scope_type", [
  "organization",
  "branch",
  "department",
  "self",
  "custom",
]);

export const membershipScopesTable = pgTable(
  "membership_scopes",
  {
    id: serial("id").primaryKey(),
    membershipId: integer("membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "cascade" }),
    scopeType: membershipScopeTypeEnum("scope_type").notNull(),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("membership_scopes_membership_idx").on(table.membershipId),
    index("membership_scopes_branch_idx").on(table.branchId),
    index("membership_scopes_department_idx").on(table.departmentId),
  ],
);

export const insertMembershipScopeSchema = createInsertSchema(membershipScopesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMembershipScope = z.infer<typeof insertMembershipScopeSchema>;
export type MembershipScope = typeof membershipScopesTable.$inferSelect;
