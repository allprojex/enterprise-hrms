import { pgTable, serial, integer, text, pgEnum, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { grievanceCasesTable } from "./grievance-cases";

/**
 * WS-12 — Grievance case chronology (§28.4, §28.5).
 *
 * Append-only, for the same reason as the disciplinary chronology, and a
 * separate table for the reason recorded there (§28.27 item 1).
 *
 * THE `visibleToComplainant` COLUMN IS THE ESS ALLOW-LIST, IN THE DATABASE.
 * §28.5 requires the employee-facing visibility model to be designed
 * explicitly, field by field, with "not visible" as the default — and warns
 * that exposing the whole record and hoping the employee is not interested in
 * the rest is not an implementation of that decision. Putting the flag here,
 * defaulted to FALSE, means an investigator's working note is invisible to the
 * complainant unless somebody deliberately marks it as communicated. A note
 * added by a service that has never heard of ESS is private by construction,
 * which is the only version of this that stays true as the code grows.
 */
export const grievanceCaseEventTypeEnum = pgEnum("grievance_case_event_type", [
  "submitted",
  "acknowledged",
  "assigned",
  "reassigned",
  "review_recorded",
  "meeting_held",
  "information_requested",
  "information_provided",
  "finding_recorded",
  "resolution_recorded",
  "escalated",
  "appeal_lodged",
  "appeal_decided",
  "evidence_attached",
  "withdrawn",
  "closed",
  "reopened",
]);

export const grievanceCaseEventsTable = pgTable(
  "grievance_case_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => grievanceCasesTable.id, { onDelete: "restrict" }),
    eventType: grievanceCaseEventTypeEnum("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    details: jsonb("details"),
    /**
     * Default FALSE — see this file's header. An event becomes visible to the
     * complainant only by an explicit authorized act.
     */
    visibleToComplainant: boolean("visible_to_complainant").notNull().default(false),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("grievance_case_events_case_idx").on(table.organizationId, table.caseId, table.occurredAt)],
);

export const insertGrievanceCaseEventSchema = createInsertSchema(grievanceCaseEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertGrievanceCaseEvent = z.infer<typeof insertGrievanceCaseEventSchema>;
export type GrievanceCaseEvent = typeof grievanceCaseEventsTable.$inferSelect;
