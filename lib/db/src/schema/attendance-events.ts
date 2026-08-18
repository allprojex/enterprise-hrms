import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";
import { branchesTable } from "./branches";

// Attendance Events (Phase 3B, W64 — Attendance Foundation): the append-only
// source of truth for every clock action (docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md
// §3.2). Never updated or deleted by any route or service function, mirroring
// this codebase's existing immutable-log precedent exactly
// (application_stage_history, requisition_approvals, candidate_consents,
// leave_balance_entries) — a correction is a separate attendance_adjustments
// row (§3.4), never a rewrite in place. No unique constraint forcing exactly
// one clock-in/clock-out pair per day: a genuine multi-segment day (e.g. a
// lunch-break out/in) is a valid sequence of events, not an error — the
// daily summary read-model (a later workstream) decides how to interpret
// them, not this table's own constraints.
export const attendanceEventTypeEnum = pgEnum("attendance_event_type", ["clock_in", "clock_out"]);

// "biometric" is a reserved, schema-valid value from day one (§3.6) — no
// biometric writer exists yet; a future phase can write into this same
// table with source: "biometric" and zero schema change, the same
// "reserved-but-currently-unreachable value" precedent offer_versions.status
// already established for accepted/declined.
export const attendanceEventSourceEnum = pgEnum("attendance_event_source", [
  "self_service",
  "hr_manual",
  "biometric",
  "import",
]);

export const attendanceEventsTable = pgTable(
  "attendance_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    eventType: attendanceEventTypeEnum("event_type").notNull(),
    // The actual instant, always server-authoritative: the server's own
    // clock for a self_service punch, or an explicitly-supplied instant for
    // hr_manual/import sources — never trusted blindly from an untrusted
    // client. Deliberately no DB-level default; the caller (a later
    // workstream's route) always supplies it explicitly, since a schema
    // default of now() would be wrong for a backdated hr_manual/import
    // entry.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: attendanceEventSourceEnum("source").notNull(),
    // Null for a genuine self-service punch; set for an HR-entered event —
    // same nullable-actor-FK convention this codebase already uses
    // uniformly for "who did this" columns on append-only rows (see
    // application_stage_history.movedByMembershipId, requisition_approvals.
    // approverMembershipId), even where the value is conceptually always
    // present at creation time for one of the two paths.
    recordedByMembershipId: integer("recorded_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    // Only meaningful for a multi-branch organization; null otherwise.
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    // Reserved for a future biometric device identifier; unused until a
    // device integration exists (§3.6) — no protocol or vendor logic here.
    deviceReference: text("device_reference"),
    notes: text("notes"),
  },
  (table) => [
    index("attendance_events_org_employee_idx").on(table.organizationId, table.employeeId),
    index("attendance_events_employee_occurred_idx").on(table.employeeId, table.occurredAt),
  ],
);

export const insertAttendanceEventSchema = createInsertSchema(attendanceEventsTable).omit({
  id: true,
});

export type InsertAttendanceEvent = z.infer<typeof insertAttendanceEventSchema>;
export type AttendanceEvent = typeof attendanceEventsTable.$inferSelect;
