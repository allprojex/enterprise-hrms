import { pgTable, serial, integer, timestamp, text, jsonb, index, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";

// WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #17):
// central category taxonomy every event_type prefix resolves to — see
// lib/auditCategories.ts for the actual prefix→category mapping (kept out
// of the schema so new prefixes never require a migration). "security"
// deliberately doubles as the fail-closed default for any future event
// type nobody has categorized yet, including a future break-glass session
// (Owner Decision #31) — see lib/auditCategories.ts's own comment.
export const auditCategoryEnum = pgEnum("audit_category", [
  "hr",
  "payroll",
  "security",
  "documents",
  "assets_inventory",
  "platform_configuration",
]);

// WS-3 (Owner Decision #16/§9): narrow, optional outcome — populated only by
// call sites that have a real reason to distinguish a denied/failed
// sensitive action (e.g. a reveal attempt) from an ordinary successful
// mutation. Left null for the ~340 pre-existing call sites, which represent
// success implicitly by having been recorded at all; this is not a
// business-audit-wide "log every attempt" mechanism (see the same file's
// comment on why routine 403s are not audited here).
export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "failure", "denied"]);

// Append-only. Nothing in application code should update or delete rows here
// — enforced by this workstream's DB-level trigger (see
// 0057_audit_events_tamper_protection.sql), not by application discipline
// alone. Actor/org/membership FKs are nullable + ON DELETE SET NULL so the
// audit trail survives even after the referenced row is gone — denormalize
// human-readable context into `metadata` so a null FK doesn't lose meaning.
export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorApplicationUserId: integer("actor_application_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorMembershipId: integer("actor_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    // WS-3 additions below — all populated automatically by recordAuditEvent()
    // itself (lib/auditLog.ts), never required from the ~340 pre-existing
    // call sites.
    category: auditCategoryEnum("category").notNull().default("security"),
    // Correlates every audit row written during one HTTP request back to
    // that request — see lib/requestContext.ts. Null for background/
    // non-HTTP callers (seeds, backfills), which have no request to
    // correlate to; this is a plain server-generated identifier (pino-http's
    // own per-request id), never a secret, safe to hand to support/ops.
    requestId: text("request_id"),
    outcome: auditOutcomeEnum("outcome"),
  },
  (table) => [
    index("audit_events_org_time_idx").on(table.organizationId, table.occurredAt),
    index("audit_events_actor_time_idx").on(table.actorApplicationUserId, table.occurredAt),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
    index("audit_events_category_idx").on(table.organizationId, table.category, table.occurredAt),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  occurredAt: true,
});

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
