import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";
import { scheduledJobsTable } from "./scheduled-jobs";

export const notificationTypeEnum = pgEnum("notification_type", [
  "info",
  "success",
  "warning",
  "alert",
]);

// WS-6 (Scheduled Jobs / Notifications Foundation) extends this table rather
// than creating a parallel one. It was already fully wired end to end
// (routes, permission model, frontend bell + list page) before WS-6 — but a
// repo-wide search found zero `.insert(notificationsTable...)` call sites
// anywhere in the codebase's history. This is a live, deployed delivery
// surface that has simply never been populated; WS-6's `reminder.notify` job
// handler (lib/notifications.ts's `notifyUser`) is its first writer. All six
// original columns (id, userId, title, message, type, read, createdAt) are
// unchanged — every existing route and the existing frontend page keep
// working exactly as before against the extended shape.
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: notificationTypeEnum("type").notNull().default("info"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Nullable for the same reason scheduled_jobs.organizationId is nullable
    // — a platform-scoped notification (e.g. a future installation-health
    // alert to a super_admin) has no single owning organization. Every
    // notification WS-6 itself creates sets this; recipient membership in
    // this exact organization is verified before insert (see
    // lib/notifications.ts's `resolveRecipient`) — that check, not this
    // column alone, is what prevents an Org A job from notifying a user who
    // has no relationship to Org A.
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    sourceReferenceType: varchar("source_reference_type", { length: 32 }),
    sourceReferenceId: integer("source_reference_id"),
    // The job that created this notification, when one did. Lets a retried
    // or reclaimed job attempt check "did my own prior attempt already
    // deliver this?" before creating a second row — a second, independent
    // idempotency guard alongside scheduled_jobs' own dedup key.
    sourceJobId: integer("source_job_id").references(() => scheduledJobsTable.id, { onDelete: "set null" }),
    // Deliberately a path/route fragment, never a full URL with query
    // parameters that could carry identifying data into browser history —
    // matching lib/organizationDocuments.ts's own "no PII in URLs" posture.
    actionPath: text("action_path"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("notifications_user_read_idx").on(table.userId, table.read),
    index("notifications_org_idx").on(table.organizationId),
  ],
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
