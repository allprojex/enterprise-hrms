import { pgTable, serial, integer, text, timestamp, pgEnum, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { installationsTable } from "./installations";

// WS-4 (Break-Glass Access Foundation, Owner Decision #31): the explicit,
// reason-bound, time-limited, revocable, fully-audited grant that lets a
// platform-level actor (isSuperAdmin) exercise a narrow, named set of
// permissions against ONE organization's data through the ordinary
// requireMembership/requirePermission chain (see middlewares/
// requireMembership.ts) — which otherwise flatly denies platform actors, by
// design, since Owner Decision #31 requires that platform-owner status must
// NOT imply standing customer-data access. A grant changes WHO may call a
// normal service; it never changes WHAT that service validates (domain
// invariants, maker-checker, module gating are all still enforced
// identically).
//
// There is no separate request/approval workflow in this foundation
// workstream (that would be a future, explicitly-deferred customer-approval
// feature — see docs/INSTALLATION_AND_BREAK_GLASS.md) — a grant is
// activated by the same platform actor who creates it, so requestedAt and
// activatedAt are set together at creation time. "Ended"/"expired" are
// deliberately NOT stored columns: a grant's live status is always derived
// from (status = 'revoked') OR (now() > expiresAt) at revalidation time,
// never from a background sweep (no scheduled jobs — WS-1 boundary) or a
// second timestamp that could drift out of sync with expiresAt/revokedAt.
export const breakGlassGrantStatusEnum = pgEnum("break_glass_grant_status", ["active", "revoked"]);

export const breakGlassGrantsTable = pgTable(
  "break_glass_grants",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    targetOrganizationId: integer("target_organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    targetInstallationId: integer("target_installation_id").references(() => installationsTable.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    // Explicit permission-key allow-list (§22 option A) — e.g.
    // ["employee.read", "payroll.banking.read"]. Never "all permissions";
    // validated server-side at creation against real, existing, read-only
    // permission keys (lib/breakGlass.ts) — never trusted as-is from the
    // request body.
    scope: jsonb("scope").$type<string[]>().notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
    status: breakGlassGrantStatusEnum("status").notNull().default("active"),
    // Safe, non-sensitive context only (e.g. a support-ticket reference) —
    // never customer HR data. Enforced by convention/review, not schema.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("break_glass_grants_actor_idx").on(table.actorUserId),
    index("break_glass_grants_target_org_idx").on(table.targetOrganizationId, table.status),
  ],
);

export const insertBreakGlassGrantSchema = createInsertSchema(breakGlassGrantsTable).omit({
  id: true,
  requestedAt: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBreakGlassGrant = z.infer<typeof insertBreakGlassGrantSchema>;
export type BreakGlassGrant = typeof breakGlassGrantsTable.$inferSelect;
