import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";

// VR-02 — Vehicle Requests: the request, its configurable approval chain, and
// the decisions taken on it. VR-02A installs this whole shape; the behaviour
// that writes to it arrives in VR-02B (submission) and VR-02C (decisions and
// reservation). Release, return, driver and actual times are VR-03 and appear
// nowhere here.
//
// DOMAIN-OWNED APPROVAL, NOT A SHARED ENGINE (the WS-9 precedent).
// `recruitment_approval_stages` is this repository's original configurable
// approval shape — an ordered stage list naming server-defined resolvers, with
// an append-only decision log — and WS-13 deliberately DUPLICATED it rather
// than sharing it, because OD #14 forbids replacing working domain workflows
// with one generic engine. VR-02 follows the same ruling: these tables are
// namespaced to vehicle requests, nothing in Recruitment or WS-13 is
// refactored, and WS-13's `request_approvals` is not reused (it is foreign-keyed
// to `data_change_requests`, so it structurally cannot host this anyway).
// There is no rule DSL, no expression evaluator and no generic state machine.

/**
 * Today there is exactly one thing to approve. The enum exists so a later
 * vehicle-side purpose is an additive enum value rather than a second table,
 * exactly as recruitment carries `requisition`/`hire` in one stage table.
 */
export const vehicleRequestApprovalPurposeEnum = pgEnum("vehicle_request_approval_purpose", ["vehicle_request"]);

/**
 * Server-defined authority resolvers. A stage NAMES one; it cannot supply code.
 * Adding a resolver is a deliberate code change, which is what keeps "who may
 * approve" analyzable — and it is why authority is never inferred from a role
 * NAME. The three kinds are the same three WS-9 settled on:
 *
 *   department_head     — the authoritative `department_heads` relationship for
 *                         the request's OWN requesting department, resolved
 *                         through the shared authority primitives so a
 *                         currently-valid delegate counts too.
 *   permission_holder   — any active member holding a named permission key, for
 *                         organizations whose transport sign-off is a role.
 *   specific_membership — one named person.
 */
export const vehicleRequestAuthorityResolverEnum = pgEnum("vehicle_request_authority_resolver", [
  "department_head",
  "permission_holder",
  "specific_membership",
]);

/** Who the vehicle is being requested for. Office Inventory's vocabulary, deliberately. */
export const vehicleRequestTypeEnum = pgEnum("vehicle_request_type", ["employee", "department"]);

/**
 * `approved` IS the reservation — there is no reservation table and no flag on
 * `vehicles`. A vehicle is reserved for [plannedTimeOut, plannedTimeIn) exactly
 * when an approved row says so, which is what lets a cancellation free it in
 * the same UPDATE that records it, with no second place to drift.
 */
export const vehicleRequestStatusEnum = pgEnum("vehicle_request_status", ["pending", "approved", "rejected", "cancelled"]);

export const vehicleRequestDecisionEnum = pgEnum("vehicle_request_decision", ["approved", "rejected"]);

/**
 * Two authorities may cancel, for different reasons: the submitter withdrawing
 * their own request, and an authorized approver cancelling an approved one for
 * an operational reason. They are different facts about what happened, so the
 * record states which rather than leaving it to be inferred later from a
 * membership comparison (which would be wrong whenever the submitter is also an
 * approver).
 */
export const vehicleRequestCancellationKindEnum = pgEnum("vehicle_request_cancellation_kind", ["submitter", "operational"]);

/**
 * One configured stage in an organization's chain. No stage is mandatory and no
 * sequence is hard-coded: an organization may configure one stage or several.
 * An organization with NO stages cannot have requests submitted at all —
 * VR-02B refuses submission rather than creating a request nobody can ever
 * decide (the `NoHireApprovalStagesConfiguredError` precedent).
 */
export const vehicleRequestApprovalStagesTable = pgTable(
  "vehicle_request_approval_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    purpose: vehicleRequestApprovalPurposeEnum("purpose").notNull(),
    /** 1-based position in the chain. Stages are decided strictly in ascending order. */
    stageOrder: integer("stage_order").notNull(),
    /** The organization's own label, e.g. "Department Head", "Transport Officer". */
    name: text("name").notNull(),
    resolverType: vehicleRequestAuthorityResolverEnum("resolver_type").notNull(),
    /**
     * Resolver input, validated per resolver type by the service:
     *   permission_holder   -> { permissionKey }
     *   specific_membership -> { membershipId }
     *   department_head     -> {} (the request supplies the department)
     */
    resolverConfig: jsonb("resolver_config"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    updatedByMembershipId: integer("updated_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vehicle_request_approval_stages_org_purpose_order_unique").on(table.organizationId, table.purpose, table.stageOrder),
    index("vehicle_request_approval_stages_org_purpose_idx").on(table.organizationId, table.purpose),
  ],
);

/**
 * One vehicle request.
 *
 * WHO SUBMITTED vs WHO IT IS FOR are different columns and both are always
 * answerable. A department is not an authenticated actor, so
 * `submittedByMembershipId` is NOT NULL in both modes and is never inferred
 * from the requester.
 *
 * `requestingDepartmentId` is NOT NULL in BOTH modes and is resolved ONCE at
 * submission — for an employee request, from that employee's own
 * `employees.departmentId` at that moment. It is never re-derived, so an
 * employee who later transfers does not rewrite the history of a request they
 * made from their old department. Deriving it live would be wrong twice over:
 * `employees.departmentId` is nullable AND `ON DELETE set null`, so the join
 * would both follow transfers and silently blank out.
 *
 * The requester chooses the EXACT vehicle and an approver may never substitute
 * it — there is deliberately no "approved vehicle" column to diverge from
 * `vehicleId`.
 */
export const vehicleRequestsTable = pgTable(
  "vehicle_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** Organization-unique, allocated from a numbering sequence — never MAX()+1. */
    requestReference: text("request_reference").notNull(),
    requestType: vehicleRequestTypeEnum("request_type").notNull(),
    /** The human who actually submitted it. Always present, in both modes. */
    submittedByMembershipId: integer("submitted_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    /** Required for an employee request; null for a department request. */
    requesterEmployeeId: integer("requester_employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
    /** Resolved once at submission; never re-derived. Also the approval-routing key. */
    requestingDepartmentId: integer("requesting_department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "restrict" }),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    destination: text("destination"),
    plannedTimeOut: timestamp("planned_time_out", { withTimezone: true }).notNull(),
    /** "Expected Time In". Actual times belong to VR-03 and are not here. */
    plannedTimeIn: timestamp("planned_time_in", { withTimezone: true }).notNull(),
    status: vehicleRequestStatusEnum("status").notNull().default("pending"),
    /**
     * How many stages existed when this request was raised. Frozen at
     * submission so reconfiguring the chain later cannot retroactively change
     * whether an in-flight request is complete — the `hire_authorizations`
     * precedent.
     */
    totalStages: integer("total_stages").notNull(),
    /** The next stage awaiting a decision; null once the request is settled. */
    currentStageOrder: integer("current_stage_order"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the request reaches a terminal decision (final approval or rejection). */
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Required when status is `rejected`; the decision log carries it per stage too. */
    rejectionReason: text("rejection_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByMembershipId: integer("cancelled_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    cancellationKind: vehicleRequestCancellationKindEnum("cancellation_kind"),
    /** Required when cancelling an already-approved request, whichever kind. */
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vehicle_requests_org_reference_unique").on(table.organizationId, table.requestReference),
    // Department accountability and reporting: "every request for Department A".
    index("vehicle_requests_org_department_status_idx").on(table.organizationId, table.requestingDepartmentId, table.status),
    // "Everything this person submitted" — the ESS list.
    index("vehicle_requests_org_submitter_idx").on(table.organizationId, table.submittedByMembershipId),
    // The reservation-overlap probe VR-02C runs under the vehicle advisory lock.
    index("vehicle_requests_org_vehicle_status_idx").on(table.organizationId, table.vehicleId, table.status),
    // The approver queue.
    index("vehicle_requests_org_status_stage_idx").on(table.organizationId, table.status, table.currentStageOrder),
    // The planned window is half-open [out, in), so the two instants may never
    // be equal and "in" may never precede "out". Enforced by the database
    // because a zero-length or inverted reservation would silently break the
    // overlap predicate VR-02C depends on.
    check("vehicle_requests_planned_window_check", sql`${table.plannedTimeIn} > ${table.plannedTimeOut}`),
  ],
);

/**
 * Append-only decision log: one row per stage decision, never updated.
 *
 * The snapshot columns are a permanent record of the authority that existed at
 * the moment of decision. A later Department Head replacement or delegation
 * revocation must never alter an already-recorded decision — the Office
 * Inventory rule, applied here.
 */
export const vehicleRequestApprovalsTable = pgTable(
  "vehicle_request_approvals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // RESTRICT, not cascade. This log is the permanent record of who decided
    // what under whose authority, so a request must never be able to take its
    // own decision history with it — the WS-9 rule, where
    // `hire_authorization_decisions.hire_authorization_id` is restrict for
    // exactly this reason. Nothing deletes a vehicle request today; this is
    // what keeps that true by construction rather than by everyone remembering.
    requestId: integer("request_id")
      .notNull()
      .references(() => vehicleRequestsTable.id, { onDelete: "restrict" }),
    stageOrder: integer("stage_order").notNull(),
    /** The stage's configured label at decision time. Text, because a stage may later be renamed or removed. */
    stageNameSnapshot: text("stage_name_snapshot").notNull(),
    resolverTypeSnapshot: vehicleRequestAuthorityResolverEnum("resolver_type_snapshot").notNull(),
    decision: vehicleRequestDecisionEnum("decision").notNull(),
    decidedByMembershipId: integer("decided_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    decidedByUserId: integer("decided_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** True when a currently-valid delegate decided in the Head's stead. */
    actedAsDelegate: boolean("acted_as_delegate").notNull().default(false),
    delegatorHeadMembershipId: integer("delegator_head_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    /** Required when `decision` is `rejected`. */
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One decision per stage, ever. This is the database-level backstop that
    // makes a double-decide impossible even if two approvers race.
    uniqueIndex("vehicle_request_approvals_request_stage_unique").on(table.requestId, table.stageOrder),
    index("vehicle_request_approvals_org_request_idx").on(table.organizationId, table.requestId),
  ],
);

export const insertVehicleRequestApprovalStageSchema = createInsertSchema(vehicleRequestApprovalStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertVehicleRequestSchema = createInsertSchema(vehicleRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
});
export const insertVehicleRequestApprovalSchema = createInsertSchema(vehicleRequestApprovalsTable).omit({
  id: true,
  decidedAt: true,
});

export type InsertVehicleRequestApprovalStage = z.infer<typeof insertVehicleRequestApprovalStageSchema>;
export type VehicleRequestApprovalStage = typeof vehicleRequestApprovalStagesTable.$inferSelect;
export type InsertVehicleRequest = z.infer<typeof insertVehicleRequestSchema>;
export type VehicleRequest = typeof vehicleRequestsTable.$inferSelect;
export type InsertVehicleRequestApproval = z.infer<typeof insertVehicleRequestApprovalSchema>;
export type VehicleRequestApproval = typeof vehicleRequestApprovalsTable.$inferSelect;
