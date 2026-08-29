import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

/**
 * WS-13 — Employee data change requests
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §29.2–29.11, OD #11).
 *
 * ONE ARCHITECTURE, TWO ORIGINS (§29.2). An employee raising a correction to
 * their own record and an HR officer proposing a change to somebody else's run
 * through the same request, the same decision path and the same application
 * code. Two parallel engines were explicitly forbidden, and `origin` is stored
 * so policy, reporting and audit can still tell them apart.
 *
 * WHY THIS TABLE EXISTS AT ALL. §29.1(2) settled it from evidence: an employee
 * cannot change their own record anywhere in this platform today — the only
 * self-service writes are profile-picture upload and delete, and every field
 * edit goes through `PATCH /employees/:id` behind `employee.write`. So this is
 * not a gate placed over an existing self-service path. It IS the path.
 *
 * WHAT MAY BE REQUESTED IS NOT STORED HERE. The set of changeable fields is a
 * code-level registry (§29.3), not a column, not configuration and never a
 * client-supplied column name. `employees` mixes personal fields, WS-11
 * lifecycle fields and pointers to payroll-owned records in one row, so a
 * registry keyed on "this column exists" would hand this table a route into
 * separation, promotion and banking.
 */

/** Recorded server-side from HOW the request was raised, never accepted from a client. */
export const dataChangeOriginEnum = pgEnum("data_change_origin", ["employee_self_service", "hr_originated"]);

/**
 * `approved` and `applied` are deliberately distinct (§29.10). An approved
 * request whose application failed must not read as though the employee record
 * was written — that is the difference between a decision and its effect.
 *
 *   pending          — awaiting decision.
 *   returned         — sent back to the requester for more information.
 *   approved         — decided, not yet written.
 *   applied          — the authoritative record was actually changed.
 *   rejected         — decided against. Terminal.
 *   withdrawn        — pulled by the requester. Terminal.
 *   stale            — an authoritative value moved underneath the request
 *                      (§29.10). NOT terminal: it awaits audited
 *                      re-confirmation, and is never silently applied.
 *   application_failed — approved, attempted, and the write did not succeed.
 *                      Preserved rather than pretending success.
 */
export const dataChangeStatusEnum = pgEnum("data_change_status", [
  "pending",
  "returned",
  "approved",
  "applied",
  "rejected",
  "withdrawn",
  "stale",
  "application_failed",
]);

export const dataChangeRequestsTable = pgTable(
  "data_change_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** The employee whose record would change. For ESS this is derived from the caller's own link. */
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    origin: dataChangeOriginEnum("origin").notNull(),
    status: dataChangeStatusEnum("status").notNull().default("pending"),
    reason: text("reason"),
    /**
     * How many approval stages existed when this request was raised. Frozen
     * here so reconfiguring the chain later cannot retroactively change whether
     * an in-flight request is complete — WS-9's proven safeguard (§29.8).
     */
    stageCountAtRequest: integer("stage_count_at_request").notNull().default(0),
    /** 1-based pointer into the frozen chain. Null once no stage is outstanding. */
    currentStageOrder: integer("current_stage_order"),
    requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    requestedByMembershipId: integer("requested_by_membership_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The four instants §29.11 keeps apart. `createdAt` is none of them.
     * `effectiveDate` is recorded for the business record; it does NOT licence a
     * scheduled job to apply the change later — see the service.
     */
    effectiveDate: timestamp("effective_date", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedByUserId: integer("applied_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** Why an approved request could not be written. Kept, not swallowed (§29.10). */
    applicationFailureReason: text("application_failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("data_change_requests_org_employee_idx").on(table.organizationId, table.employeeId),
    index("data_change_requests_org_status_idx").on(table.organizationId, table.status, table.requestedAt),
  ],
);

/**
 * One proposed change to one registered field.
 *
 * `previousValue` is captured WHEN THE REQUEST IS RAISED and is the authority
 * for stale detection (§29.10): at decision time the service re-reads the live
 * value and compares against this, per field. A change to some unrelated column
 * on the same employee row must not invalidate an untouched request, which is
 * exactly why `employees.updatedAt` is only a coarse supporting signal here and
 * never the concurrency authority.
 *
 * Values are stored as JSON so a date, a string and an emergency-contact array
 * all round-trip through one column without a second type system. SENSITIVE
 * VALUES ARE NOT STORED IN THE CLEAR ANYWHERE ELSE: audit serialization masks
 * them (§29.19), and the approval DTO masks them (§29.7).
 */
export const dataChangeRequestFieldsTable = pgTable(
  "data_change_request_fields",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => dataChangeRequestsTable.id, { onDelete: "cascade" }),
    /**
     * Denormalized from the parent request. It exists ONLY so the partial
     * unique index below can be expressed — a unique constraint cannot reach
     * through a join. The service always copies it from the request and never
     * accepts it from a caller.
     */
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    /**
     * True while the parent request is in an ACTIVE status, false once it
     * reaches a terminal one. Also denormalized purely to make the partial
     * unique index expressible, and maintained by the service inside the same
     * transaction as every status change.
     */
    activeStatus: boolean("active_status").notNull().default(true),
    /** A key from the code-level registry (§29.3). Never a raw column name from a client. */
    fieldKey: text("field_key").notNull(),
    previousValue: jsonb("previous_value"),
    requestedValue: jsonb("requested_value"),
    /** Set when the live value no longer matches `previousValue`. */
    staleDetectedAt: timestamp("stale_detected_at", { withTimezone: true }),
    /** The value found live at the moment staleness was detected, for the re-confirmer to see. */
    staleCurrentValue: jsonb("stale_current_value"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("data_change_request_fields_request_idx").on(table.organizationId, table.requestId),
    /**
     * AT MOST ONE ACTIVE REQUEST PER (organization, employee, field) — §29.10.
     *
     * A database guarantee rather than a read-then-write check two concurrent
     * submissions could both pass. It is a partial index over the ACTIVE
     * statuses only, so the full history of decided requests is preserved: an
     * employee may have twenty rejected requests for the same field and still
     * raise a new one. The denormalized `employeeId` and `activeStatus` columns
     * exist solely to make that index expressible.
     */
    uniqueIndex("data_change_request_fields_active_unique")
      .on(table.organizationId, table.employeeId, table.fieldKey)
      .where(sql`active_status = true`),
    index("data_change_request_fields_field_idx").on(table.organizationId, table.fieldKey),
  ],
);

export const insertDataChangeRequestSchema = createInsertSchema(dataChangeRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDataChangeRequestFieldSchema = createInsertSchema(dataChangeRequestFieldsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertDataChangeRequest = z.infer<typeof insertDataChangeRequestSchema>;
export type DataChangeRequest = typeof dataChangeRequestsTable.$inferSelect;
export type InsertDataChangeRequestField = z.infer<typeof insertDataChangeRequestFieldSchema>;
export type DataChangeRequestField = typeof dataChangeRequestFieldsTable.$inferSelect;
