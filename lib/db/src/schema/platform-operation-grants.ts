import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// WS-17 Slice 1 — narrow platform-operations authority.
//
// WHY THIS CANNOT USE THE ORDINARY PERMISSION SYSTEM
//
// `hasPermission(membershipId, key)` resolves roles through
// `membership_roles`, which requires an `organization_memberships` row. Platform
// operations have no organization: a deployment, a backup and an installation's
// health belong to an INSTALLATION, which may serve many tenants or none. Using
// the membership axis would mean an organization membership could confer
// platform authority — precisely what the frozen architecture forbids.
//
// So the GRANT axis here is the platform user, following the shape
// `break_glass_grants` already established for user-scoped platform authority
// (actorUserId, reason, expiry, revocation, audit). The permission KEY axis
// still reuses the ordinary `permissions` catalogue and its seeding
// convention, so there is one place to read every key this platform defines —
// no parallel naming scheme, only a different grant relationship.
//
// AUTHORITY IS ALWAYS A CONJUNCTION
//
// Holding a grant is never sufficient on its own. Every protected operation
// requires platform context (super-admin) AND the specific grant. Super-admin
// role alone must not confer every dangerous mutation, which is the whole
// reason this table exists; and a grant alone must never let a non-platform
// user act.
//
// FUTURE RESTORE DEPENDS ON THIS SHAPE. Restore will need
// `platform.restore.request` and `platform.restore.approve` as SEPARATE keys so
// a requester cannot approve their own production restore. Nothing here grants
// those or gives them behaviour — the table simply has to be able to express
// them when that gated pass arrives.
export const platformOperationGrantsTable = pgTable(
  "platform_operation_grants",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // A key from the ordinary `permissions` catalogue, seeded alongside every
    // other permission. Deliberately text rather than a foreign key: the
    // catalogue is seed data keyed by string everywhere else in this codebase
    // (`hasPermission` takes a string), and matching that keeps one convention
    // rather than two.
    permissionKey: text("permission_key").notNull(),
    grantedBy: integer("granted_by").references(() => usersTable.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    // Optional expiry, following break-glass's own time-limitation principle.
    // Null means "until revoked", which is legitimate for a standing operator.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one live grant of a key per user. Re-granting a revoked key is
    // allowed — the revoked row stays as history.
    uniqueIndex("platform_operation_grants_live_unique")
      .on(table.userId, table.permissionKey)
      .where(sql`${table.revokedAt} is null`),
    index("platform_operation_grants_user_idx").on(table.userId),
  ],
);

export const insertPlatformOperationGrantSchema = createInsertSchema(platformOperationGrantsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPlatformOperationGrant = z.infer<typeof insertPlatformOperationGrantSchema>;
export type PlatformOperationGrant = typeof platformOperationGrantsTable.$inferSelect;
