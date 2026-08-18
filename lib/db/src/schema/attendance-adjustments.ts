import { pgTable, serial, integer, text, timestamp, date, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Attendance Adjustments (Phase 3B, W64 — Attendance Foundation): the
// correction/approval workflow for a single civil date's attendance record
// (docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §3.4). W64 owns only this
// table's schema — no workflow logic, no approval routes; those belong to a
// later workstream (this table's own "Backend/API impact: none yet" per the
// frozen plan's W64 entry).
export const attendanceAdjustmentTypeEnum = pgEnum("attendance_adjustment_type", [
  "manual_clock_in",
  "manual_clock_out",
  "mark_present",
  "mark_absent",
  "excuse_absence",
]);

// Deliberately only 3 values (no "cancelled"), matching the frozen plan's
// §3.4 list exactly rather than leave_requests' 4-value status enum.
export const attendanceAdjustmentStatusEnum = pgEnum("attendance_adjustment_status", [
  "pending",
  "approved",
  "rejected",
]);

export const attendanceAdjustmentsTable = pgTable(
  "attendance_adjustments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    // The civil date being corrected, not an instant — mirrors
    // leave_requests.startDate/endDate's plain `date` column convention.
    date: date("date").notNull(),
    adjustmentType: attendanceAdjustmentTypeEnum("adjustment_type").notNull(),
    correctedClockIn: timestamp("corrected_clock_in", { withTimezone: true }),
    correctedClockOut: timestamp("corrected_clock_out", { withTimezone: true }),
    reason: text("reason").notNull(),
    status: attendanceAdjustmentStatusEnum("status").notNull().default("pending"),
    // Nullable + set-null on delete, matching this codebase's uniform
    // actor-membership-FK convention (application_stage_history.
    // movedByMembershipId, requisition_approvals.approverMembershipId) even
    // though a requester is conceptually always present at creation time.
    requestedByMembershipId: integer("requested_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    decidedByMembershipId: integer("decided_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attendance_adjustments_org_employee_idx").on(table.organizationId, table.employeeId),
    index("attendance_adjustments_employee_date_idx").on(table.employeeId, table.date),
  ],
);

export const insertAttendanceAdjustmentSchema = createInsertSchema(attendanceAdjustmentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAttendanceAdjustment = z.infer<typeof insertAttendanceAdjustmentSchema>;
export type AttendanceAdjustment = typeof attendanceAdjustmentsTable.$inferSelect;
