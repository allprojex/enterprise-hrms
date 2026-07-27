import { pgTable, serial, integer, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "active",
  "suspended",
  "expired",
  "revoked",
]);

export const organizationMembershipsTable = pgTable(
  "organization_memberships",
  {
    id: serial("id").primaryKey(),
    applicationUserId: integer("application_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    status: membershipStatusEnum("status").notNull().default("active"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One mutable row per (user, org) pair — status transitions update this row;
    // history lives in audit_events, not in duplicate membership rows.
    uniqueIndex("organization_memberships_user_org_unique").on(table.applicationUserId, table.organizationId),
    index("organization_memberships_user_idx").on(table.applicationUserId),
    index("organization_memberships_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertOrganizationMembershipSchema = createInsertSchema(organizationMembershipsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationMembership = z.infer<typeof insertOrganizationMembershipSchema>;
export type OrganizationMembership = typeof organizationMembershipsTable.$inferSelect;
