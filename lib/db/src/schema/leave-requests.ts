import { pgTable, serial, integer, text, date, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { leaveTypesTable } from "./leave-types";
import { leavePoliciesTable } from "./leave-policies";
import { employeeDocumentsTable } from "./employee-documents";
import { usersTable } from "./users";

// Leave Requests (Phase 2B, W33): create/view/withdraw only — no approval
// (W35), no balance deduction (W34). `leavePolicyId` is always resolved
// server-side (never client-supplied) from the requesting employee's
// eligibility against the leave type's policies (Architecture Principle 5),
// so it's a plain FK, not user input. `startDate`/`endDate` are plain
// calendar dates (Architecture Principle 7) — no time-of-day component, so
// a leave day never shifts across a timezone boundary. Public holidays are
// intentionally not referenced here (W37 doesn't exist yet); day-count
// exclusion for holidays is a pure service-layer concern layered on top of
// this same `daysRequested` column later, not a schema change.
//
// Two-stage approval (Leave Approval Workflow Reconciliation): "pending_hr"
// is the only new status value — Department Head vs. HR rejection is
// deliberately NOT a second pair of enum values; it's derived from which of
// the two decision-column groups below got populated, per the platform
// principle of not inventing duplicate statuses when the existing model (a
// few extra nullable columns) already represents the workflow cleanly.
export const leaveRequestStatusEnum = pgEnum("leave_request_status", [
  "pending",
  "pending_hr",
  "approved",
  "rejected",
  "cancelled",
]);

export const leaveRequestsTable = pgTable(
  "leave_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypesTable.id, { onDelete: "restrict" }),
    leavePolicyId: integer("leave_policy_id")
      .notNull()
      .references(() => leavePoliciesTable.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    daysRequested: numeric("days_requested", { precision: 6, scale: 2 }).notNull(),
    status: leaveRequestStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    attachmentDocumentId: integer("attachment_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
    // Approval — now two stages (Leave Approval Workflow Reconciliation):
    // Department Head first, HR final. approvedBy/approvedAt/rejectionReason
    // (unchanged column names) now represent the FINAL/HR-stage decision
    // only; departmentHead*/rejectedBy/rejectedAt below are the new columns
    // this workflow needed. Unlike W35's original single-stage design, both
    // stages' actor identity and timestamp are now stored directly on the
    // row (not left to the audit_events trail alone) so a Department Head's
    // decision is never overwritten or lost when HR subsequently acts, and
    // survives a later Department Head replacement unchanged — the row
    // captures who actually acted, not who currently holds the role.
    departmentHeadApprovedBy: integer("department_head_approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    departmentHeadApprovedAt: timestamp("department_head_approved_at", { withTimezone: true }),
    departmentHeadRejectedBy: integer("department_head_rejected_by").references(() => usersTable.id, { onDelete: "set null" }),
    departmentHeadRejectedAt: timestamp("department_head_rejected_at", { withTimezone: true }),
    departmentHeadRejectionReason: text("department_head_rejection_reason"),
    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedBy: integer("rejected_by").references(() => usersTable.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("leave_requests_org_employee_idx").on(table.organizationId, table.employeeId),
    index("leave_requests_employee_status_idx").on(table.employeeId, table.status),
  ],
);

export const insertLeaveRequestSchema = createInsertSchema(leaveRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;
