import { pgTable, serial, integer, text, numeric, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { officeInventoryItemsTable } from "./office-inventory-items";
import { officeInventoryApprovalDelegationsTable } from "./office-inventory-approval-delegations";

// Office Inventory, Workstream 3
// (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.4, §10, §11). An
// employee or department request for stock — never itself a stock
// movement. Approval (this workstream) never touches the ledger; only
// Workstream 4's own Issue/Fulfilment action ever appends a movement row,
// referencing an approved line via `sourceReferenceType='request_line'`.
// `forDepartmentId` is ALWAYS resolved and NOT NULL, even for an employee
// request — from the employee's own current `employees.departmentId` at
// submission time (never re-derived later; a subsequent department change
// does not retroactively alter an already-submitted request's authority
// context, per §32's custody-non-transfer precedent applied here too).
// `requestedByMembershipId` is the submitter — never automatically the
// beneficiary/custodian, per §5/§10's explicit instruction.
export const officeInventoryRequestTypeEnum = pgEnum("office_inventory_request_type", ["employee", "department"]);
export const officeInventoryRequestStatusEnum = pgEnum("office_inventory_request_status", [
  "pending",
  "partially_approved",
  "approved",
  "rejected",
  "fulfilled",
  "partially_fulfilled",
  "cancelled",
]);

export const officeInventoryRequestsTable = pgTable(
  "office_inventory_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requestReference: text("request_reference").notNull(),
    requestedByMembershipId: integer("requested_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    requestType: officeInventoryRequestTypeEnum("request_type").notNull(),
    forEmployeeId: integer("for_employee_id").references(() => employeesTable.id, { onDelete: "restrict" }),
    forDepartmentId: integer("for_department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "restrict" }),
    reason: text("reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    status: officeInventoryRequestStatusEnum("status").notNull().default("pending"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByMembershipId: integer("cancelled_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("office_inventory_requests_org_reference_unique").on(table.organizationId, table.requestReference),
    index("office_inventory_requests_org_department_status_idx").on(table.organizationId, table.forDepartmentId, table.status),
    index("office_inventory_requests_org_requester_idx").on(table.organizationId, table.requestedByMembershipId),
    index("office_inventory_requests_for_employee_idx").on(table.forEmployeeId),
  ],
);

export const insertOfficeInventoryRequestSchema = createInsertSchema(officeInventoryRequestsTable).omit({
  id: true,
  submittedAt: true,
});

export type InsertOfficeInventoryRequest = z.infer<typeof insertOfficeInventoryRequestSchema>;
export type OfficeInventoryRequest = typeof officeInventoryRequestsTable.$inferSelect;

// office_inventory_request_lines — per-item, per-line approval decisions.
// `approvedByMembershipId`/`actedAsDelegate`/`delegatorHeadMembershipId`/
// `delegationId` are a permanent, never-rewritten SNAPSHOT of the approval
// authority that existed at the moment of decision (§6, §12) — a later
// Department Head replacement or delegation revocation must never alter an
// already-recorded line's own history. `quantityIssuedSoFar` exists in the
// frozen schema now for Workstream 4 to maintain; this workstream never
// writes to it (it stays "0.00" for every line, since nothing is ever
// issued yet) — included now so no later migration is needed to add it.
export const officeInventoryRequestLineApprovalStatusEnum = pgEnum("office_inventory_request_line_approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const officeInventoryRequestLinesTable = pgTable(
  "office_inventory_request_lines",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => officeInventoryRequestsTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => officeInventoryItemsTable.id, { onDelete: "restrict" }),
    quantityRequested: numeric("quantity_requested", { precision: 12, scale: 2 }).notNull(),
    approvalStatus: officeInventoryRequestLineApprovalStatusEnum("approval_status").notNull().default("pending"),
    approvedQuantity: numeric("approved_quantity", { precision: 12, scale: 2 }),
    approvedByMembershipId: integer("approved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    actedAsDelegate: boolean("acted_as_delegate").notNull().default(false),
    delegatorHeadMembershipId: integer("delegator_head_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    delegationId: integer("delegation_id").references(() => officeInventoryApprovalDelegationsTable.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    quantityIssuedSoFar: numeric("quantity_issued_so_far", { precision: 12, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    index("office_inventory_request_lines_request_idx").on(table.requestId),
    index("office_inventory_request_lines_org_item_idx").on(table.organizationId, table.itemId),
  ],
);

export const insertOfficeInventoryRequestLineSchema = createInsertSchema(officeInventoryRequestLinesTable).omit({
  id: true,
});

export type InsertOfficeInventoryRequestLine = z.infer<typeof insertOfficeInventoryRequestLineSchema>;
export type OfficeInventoryRequestLine = typeof officeInventoryRequestLinesTable.$inferSelect;
