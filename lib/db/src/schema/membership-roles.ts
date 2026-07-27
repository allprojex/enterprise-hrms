import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationMembershipsTable } from "./organization-memberships";
import { rolesTable } from "./roles";

export const membershipRolesTable = pgTable(
  "membership_roles",
  {
    id: serial("id").primaryKey(),
    membershipId: integer("membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("membership_roles_membership_role_unique").on(table.membershipId, table.roleId),
    index("membership_roles_role_idx").on(table.roleId),
  ],
);

export const insertMembershipRoleSchema = createInsertSchema(membershipRolesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMembershipRole = z.infer<typeof insertMembershipRoleSchema>;
export type MembershipRole = typeof membershipRolesTable.$inferSelect;
