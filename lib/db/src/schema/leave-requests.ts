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
export const leaveRequestStatusEnum = pgEnum("leave_request_status", [
  "pending",
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
    // Approval (W35): a single-level decision, exactly the three columns the
    // frozen plan specifies. approvedBy/approvedAt are set only on an actual
    // approval; a rejection's actor/timestamp is deliberately not duplicated
    // here — it already lives in the audit_events row the decision is
    // recorded through (Architecture Principle 6), the same reasoning that
    // keeps routine ledger postings out of the audit log in the other
    // direction.
    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
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
