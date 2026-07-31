import { pgTable, text, serial, timestamp, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { applicationsTable } from "./applications";

// Interviews (Phase 3A, W54 — Interviews & Scheduling): scheduling only —
// this workstream never evaluates an interview (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §23 W54 objective: "Interview scheduling and panel composition"; scoring/
// recommendations/hiring decisions are W55's `interview_scorecards`, a
// separate table entirely). Column list is exactly §9's `interviews` row —
// no `notes`/`timezone`/separate end-time field exists there, so none are
// added here (`scheduledAt` is `timestamptz`, inherently timezone-aware;
// an end time is derived from `scheduledAt + durationMinutes`, never stored).
//
// Status model (§4.5): `scheduled -> completed | cancelled | no_show`.
// "Rescheduled" is not a stored status — rescheduling cancels the existing
// row and creates a brand new one (immutable history, same "never edit
// history in place" discipline as `application_stage_history`), rather than
// mutating a scheduled interview's date in place.
export const interviewTypeEnum = pgEnum("interview_type", ["phone", "virtual", "in_person"]);
export const interviewStatusEnum = pgEnum("interview_status", ["scheduled", "completed", "cancelled", "no_show"]);

export const interviewsTable = pgTable(
  "interviews",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => applicationsTable.id, { onDelete: "cascade" }),
    interviewType: interviewTypeEnum("interview_type").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    location: text("location"),
    meetingLink: text("meeting_link"),
    status: interviewStatusEnum("status").notNull().default("scheduled"),
    // Nullable, set only once the interview transitions to completed — a
    // short free-text summary of what happened (e.g. "interview completed as
    // planned"), never a score/recommendation/hiring signal (W55's scope).
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("interviews_org_idx").on(table.organizationId), index("interviews_application_idx").on(table.applicationId)],
);

export const insertInterviewSchema = createInsertSchema(interviewsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInterview = z.infer<typeof insertInterviewSchema>;
export type Interview = typeof interviewsTable.$inferSelect;
