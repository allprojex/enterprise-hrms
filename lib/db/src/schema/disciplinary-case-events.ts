import { pgTable, serial, integer, text, pgEnum, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { disciplinaryCasesTable } from "./disciplinary-cases";

/**
 * WS-12 — Disciplinary case chronology (§28.3).
 *
 * APPEND-ONLY. A later event never overwrites an earlier one — the same rule the
 * legacy `employee_disciplinary_records` table adopted, and for the same reason:
 * in this domain the sequence of what was alleged, answered, heard and decided
 * IS the record. There is no update or delete path in the service.
 *
 * §28.27 ITEM 1 RESOLVED — SEPARATE CHRONOLOGY TABLES, NOT ONE SHARED TABLE.
 * A shared table would need a polymorphic (caseType, caseId) pair, which this
 * repository can only express WITHOUT a foreign key — the exact shape
 * `document_requirements`' owner pair took, and which WS-10 had to validate in
 * application code because the database could not. Two small tables keep a real
 * FK to a real parent on both sides. The vocabularies also genuinely differ:
 * a disciplinary case has allegations, notices and appeals; a grievance has
 * acknowledgement, assignment and resolution. Merging them would produce one
 * enum where most values are illegal for half the rows.
 */
export const disciplinaryCaseEventTypeEnum = pgEnum("disciplinary_case_event_type", [
  "case_opened",
  "allegation_recorded",
  "notice_issued",
  "response_received",
  "investigation_recorded",
  "hearing_held",
  "finding_recorded",
  "outcome_recorded",
  "stage_changed",
  "appeal_lodged",
  "appeal_decided",
  "evidence_attached",
  "case_closed",
  "case_reopened",
]);

export const disciplinaryCaseEventsTable = pgTable(
  "disciplinary_case_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => disciplinaryCasesTable.id, { onDelete: "restrict" }),
    eventType: disciplinaryCaseEventTypeEnum("event_type").notNull(),
    /**
     * When the thing actually happened, which is not when it was typed in — a
     * hearing held last Tuesday is recorded today. §28's effective-dating rule:
     * never rely on createdAt alone.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    /**
     * Small typed payload for what the event changed (e.g. previous and new
     * stage). Deliberately not an employee snapshot — §28 stores enough to
     * reconstruct the change, not the whole world at that instant.
     */
    details: jsonb("details"),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("disciplinary_case_events_case_idx").on(table.organizationId, table.caseId, table.occurredAt),
  ],
);

export const insertDisciplinaryCaseEventSchema = createInsertSchema(disciplinaryCaseEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDisciplinaryCaseEvent = z.infer<typeof insertDisciplinaryCaseEventSchema>;
export type DisciplinaryCaseEvent = typeof disciplinaryCaseEventsTable.$inferSelect;
