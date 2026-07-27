import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { usersTable } from "./users";

export const primaryHrAssignmentsTable = pgTable(
  "primary_hr_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    membershipId: integer("membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: integer("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => [
    // Database-enforced guarantee: at most one active (non-revoked) Primary HR
    // per organization. This is the actual source of truth — application code
    // must not be the only thing enforcing "exactly one Primary HR."
    uniqueIndex("primary_hr_assignments_active_org_unique")
      .on(table.organizationId)
      .where(sql`${table.revokedAt} is null`),
    index("primary_hr_assignments_membership_idx").on(table.membershipId),
  ],
);

export const insertPrimaryHrAssignmentSchema = createInsertSchema(primaryHrAssignmentsTable).omit({
  id: true,
  assignedAt: true,
});

export type InsertPrimaryHrAssignment = z.infer<typeof insertPrimaryHrAssignmentSchema>;
export type PrimaryHrAssignment = typeof primaryHrAssignmentsTable.$inferSelect;
