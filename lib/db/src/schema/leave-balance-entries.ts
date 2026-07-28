import { pgTable, serial, integer, text, date, numeric, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { leaveTypesTable } from "./leave-types";
import { leavePoliciesTable } from "./leave-policies";
import { leaveRequestsTable } from "./leave-requests";
import { usersTable } from "./users";

// Leave Balance Ledger (Phase 2B, W34): append-only, immutable source of
// truth for leave balances — never a directly editable balance row. A
// displayed balance is always SUM(amount) reconstructed from this table; no
// application code path updates or deletes a posted row. Mistakes are
// corrected with a compensating `reversal` entry, never an UPDATE/DELETE.
// `leavePolicyId` is always resolved server-side at posting time (same
// precedent as W33's `leave_requests.leavePolicyId`) and snapshots whichever
// policy applied *then* — a later policy change must never reinterpret an
// already-posted entry (Historical Consistency).
export const leaveBalanceEntryTypeEnum = pgEnum("leave_balance_entry_type", [
  "opening_balance",
  "accrual",
  "carry_forward",
  "usage",
  "reversal",
  "expiry",
  "manual_adjustment",
]);

export const leaveBalanceEntriesTable = pgTable(
  "leave_balance_entries",
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
    entryType: leaveBalanceEntryTypeEnum("entry_type").notNull(),
    // Signed decimal: positive credits the balance, negative debits it.
    // Direction per entryType is enforced in the service layer, not the
    // schema (opening_balance/accrual/carry_forward > 0; usage/expiry < 0;
    // reversal/manual_adjustment may be either, per what they're correcting).
    amount: numeric("amount", { precision: 8, scale: 2 }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),
    relatedLeaveRequestId: integer("related_leave_request_id").references(() => leaveRequestsTable.id, {
      onDelete: "restrict",
    }),
    // Idempotency key for postings not tied to a specific leave request
    // (opening balance, accrual, carry-forward, expiry) — e.g.
    // "accrual:2027:policy-3". Manual adjustments leave this null since each
    // one is a deliberate, distinct entry, not a repeatable/retryable post.
    sourceReference: text("source_reference"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    approvedBy: integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("leave_balance_entries_org_employee_type_idx").on(table.organizationId, table.employeeId, table.leaveTypeId),
    // One usage/reversal posting per leave request per entry type — guards
    // against duplicate deduction and double reversal under retry or
    // concurrent calls.
    uniqueIndex("leave_balance_entries_request_type_unique")
      .on(table.relatedLeaveRequestId, table.entryType)
      .where(sql`${table.relatedLeaveRequestId} is not null`),
    // One posting per (employee, leave type, entry type, source reference) —
    // guards against duplicate opening balances and duplicate accrual for
    // the same employee/policy/period under retry or concurrent calls.
    uniqueIndex("leave_balance_entries_source_reference_unique")
      .on(table.organizationId, table.employeeId, table.leaveTypeId, table.entryType, table.sourceReference)
      .where(sql`${table.sourceReference} is not null`),
  ],
);

export const insertLeaveBalanceEntrySchema = createInsertSchema(leaveBalanceEntriesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertLeaveBalanceEntry = z.infer<typeof insertLeaveBalanceEntrySchema>;
export type LeaveBalanceEntry = typeof leaveBalanceEntriesTable.$inferSelect;
