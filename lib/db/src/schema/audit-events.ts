import { pgTable, serial, integer, timestamp, text, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";

// Append-only. Nothing in application code should update or delete rows here.
// Actor/org/membership FKs are nullable + ON DELETE SET NULL so the audit
// trail survives even after the referenced row is gone — denormalize
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
  },
  (table) => [
    index("audit_events_org_time_idx").on(table.organizationId, table.occurredAt),
    index("audit_events_actor_time_idx").on(table.actorApplicationUserId, table.occurredAt),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  occurredAt: true,
});

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
