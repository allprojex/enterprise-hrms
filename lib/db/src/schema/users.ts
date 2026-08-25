import { pgTable, text, serial, timestamp, integer, pgEnum, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "org_admin",
  "hr_manager",
  "employee",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: userRoleEnum("role").notNull().default("employee"),
  organizationId: integer("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  avatarUrl: text("avatar_url"),
  jobTitle: text("job_title"),
  department: text("department"),
  phoneNumber: text("phone_number"),
  // Forgot Password (W19): raw token + expiry, mirrors organization_memberships'
  // inviteToken/inviteTokenExpiresAt pair (ADR-014). Cleared on successful
  // reset so a used or expired link can't be replayed.
  passwordResetToken: text("password_reset_token").unique(),
  passwordResetTokenExpiresAt: timestamp("password_reset_token_expires_at", { withTimezone: true }),
  // Platform-level disablement (WS-2, Owner Decision #20): a NULL disabledAt
  // is the "active" state; a non-null value IS the disabled state — no
  // separate boolean/status column, mirroring the exact revokedAt/revokedBy
  // pattern organization_memberships and primary_hr_assignments already use,
  // rather than inventing a redundant enum. Distinct from, and does not
  // replace, organization_memberships.status ("suspended"/"revoked" on one
  // membership only disables access to ONE organization) — this disables the
  // platform account itself, across every organization. Checked live on
  // every authenticated request by requireAuth (never cached), so a user
  // disabled mid-session cannot continue on a stale token.
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledBy: integer("disabled_by").references((): AnyPgColumn => usersTable.id, { onDelete: "set null" }),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
