import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";
import { customFormsTable, customFormSubmissionsTable } from "./custom-forms";
import { generatedDocumentsTable } from "./generated-documents";
import { employeeDocumentsTable } from "./employee-documents";

/**
 * WS-13 — HR Service Requests
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §29.12–29.14, OD #10).
 *
 * A SHARED FOUNDATION FOR SUITABLE REQUESTS, NOT A PROCESS DESIGNER. OD #10 and
 * §29.5 are explicit: where a domain already has real business workflow — Leave,
 * Recruitment, Onboarding, Employment Lifecycle, Employee Relations, Payroll,
 * Assets, Office Inventory, Identity & Access — that workflow stays where it is.
 * A service request may REFER a person to it. It may never become an alternate
 * source of truth for it.
 *
 * There is no rule engine here, no branching, no scripting and no arbitrary
 * state machine. A type has a fixed set of behaviours it can switch on.
 *
 * WS-13 OWNS NO DOCUMENT GENERATION (§29.13). An employment-letter request is
 * fulfilled by generating through WS-5 and pointing `generatedDocumentId` at the
 * result. That is also why this is NOT WS-11.1: a request FOR a letter and
 * automatic lifecycle-event letter generation are separate concepts, and the
 * latter remains deferred.
 */

/**
 * A closed set of behaviours, not a designer. `fulfilment_kind` tells the
 * service what "done" means for this type — nothing more.
 *
 *   acknowledgement — HR responds; there is no artifact. (HR enquiry.)
 *   document        — fulfilment produces or attaches a document. (Employment
 *                     letter, document request.)
 */
export const serviceRequestFulfilmentKindEnum = pgEnum("service_request_fulfilment_kind", [
  "acknowledgement",
  "document",
]);

/**
 * Request state. Approval state is kept SEPARATE (`approvalStatus` below)
 * because §29.12 and the brief are explicit that a request being approved does
 * not mean the service has been fulfilled. Folding them into one enum would
 * make "approved but not yet done" unrepresentable.
 *
 * Deliberately small. No ticketing-system states were added merely because they
 * are common elsewhere.
 */
export const serviceRequestStatusEnum = pgEnum("service_request_status", [
  "submitted",
  "acknowledged",
  "in_progress",
  "awaiting_employee",
  "fulfilled",
  "closed",
  "cancelled",
  "withdrawn",
]);

/** `not_required` is the ordinary case: most simple requests need no approval at all. */
export const serviceRequestApprovalStatusEnum = pgEnum("service_request_approval_status", [
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

export const serviceRequestTypesTable = pgTable(
  "service_request_types",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** Stable per organization; referenced by configuration and reporting rather than the label. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    /** Whether employees may raise this type themselves in ESS. */
    employeeVisible: boolean("employee_visible").notNull().default(true),
    approvalRequired: boolean("approval_required").notNull().default(false),
    fulfilmentKind: serviceRequestFulfilmentKindEnum("fulfilment_kind").notNull().default("acknowledgement"),
    /**
     * The WS-8 form supplying this type's own questions (§29.14). WS-13 builds
     * no second form engine; a null means the type needs no extra fields beyond
     * the subject and a note.
     */
    formId: integer("form_id").references(() => customFormsTable.id, { onDelete: "set null" }),
    /** The desk accountable for fulfilling this type. */
    responsibleDepartmentId: integer("responsible_department_id").references(() => departmentsTable.id, {
      onDelete: "set null",
    }),
    /** Informational target used to DERIVE an overdue state; never an escalation engine (§29.22). */
    targetDays: integer("target_days"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("service_request_types_org_code_unique").on(table.organizationId, table.code),
    index("service_request_types_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const serviceRequestsTable = pgTable(
  "service_requests",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    typeId: integer("type_id")
      .notNull()
      .references(() => serviceRequestTypesTable.id, { onDelete: "restrict" }),
    /** Whose request it is. For ESS this is derived from the caller's own employee link. */
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    subject: text("subject").notNull(),
    details: text("details"),
    status: serviceRequestStatusEnum("status").notNull().default("submitted"),
    /** Separate from `status` — see the enum header. */
    approvalStatus: serviceRequestApprovalStatusEnum("approval_status").notNull().default("not_required"),
    stageCountAtRequest: integer("stage_count_at_request").notNull().default(0),
    currentStageOrder: integer("current_stage_order"),
    assignedMembershipId: integer("assigned_membership_id"),
    /**
     * The WS-8 submission carrying this request's own answers (§29.14). A
     * REFERENCE: the submission stays a bare WS-8 record with no status, and
     * WS-13 adds no workflow columns to WS-8's tables.
     */
    formSubmissionId: integer("form_submission_id").references(() => customFormSubmissionsTable.id, {
      onDelete: "set null",
    }),
    /** The WS-5 document produced at fulfilment. WS-13 generates nothing itself (§29.13). */
    generatedDocumentId: integer("generated_document_id").references(() => generatedDocumentsTable.id, {
      onDelete: "set null",
    }),
    /** Employee-supplied evidence, stored in WS-5 like every other document. */
    evidenceDocumentId: integer("evidence_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    fulfilledBy: integer("fulfilled_by").references(() => usersTable.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** What HR told the employee. The one substantive free-text field ESS may read. */
    resolutionSummary: text("resolution_summary"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("service_requests_org_employee_idx").on(table.organizationId, table.employeeId),
    index("service_requests_org_status_idx").on(table.organizationId, table.status, table.submittedAt),
    index("service_requests_org_assigned_idx").on(table.organizationId, table.assignedMembershipId, table.status),
  ],
);

/**
 * Append-only service-request chronology (§29.19), carrying decisions as well as
 * lifecycle for the reason given in `data-change-requests`' sibling comment.
 *
 * `visibleToEmployee` is the ESS allow-list in the database, defaulted to FALSE:
 * an internal note written by a service that has never heard of ESS is private
 * by construction. That is the §28.5 pattern WS-12 proved, applied again.
 */
export const serviceRequestEventTypeEnum = pgEnum("service_request_event_type", [
  "submitted",
  "acknowledged",
  "assigned",
  "reassigned",
  "stage_approved",
  "approved",
  "rejected",
  "information_requested",
  "employee_responded",
  "note_added",
  "fulfilled",
  "closed",
  "cancelled",
  "withdrawn",
]);

export const serviceRequestEventsTable = pgTable(
  "service_request_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => serviceRequestsTable.id, { onDelete: "restrict" }),
    eventType: serviceRequestEventTypeEnum("event_type").notNull(),
    stageOrder: integer("stage_order"),
    stageName: text("stage_name"),
    notes: text("notes"),
    details: jsonb("details"),
    /** Default false. Employee visibility is always a deliberate act (§29.17, §28.5). */
    visibleToEmployee: boolean("visible_to_employee").notNull().default(false),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorMembershipId: integer("actor_membership_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("service_request_events_request_idx").on(table.organizationId, table.requestId, table.occurredAt)],
);

export const insertServiceRequestTypeSchema = createInsertSchema(serviceRequestTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertServiceRequestSchema = createInsertSchema(serviceRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertServiceRequestEventSchema = createInsertSchema(serviceRequestEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertServiceRequestType = z.infer<typeof insertServiceRequestTypeSchema>;
export type ServiceRequestType = typeof serviceRequestTypesTable.$inferSelect;
export type InsertServiceRequest = z.infer<typeof insertServiceRequestSchema>;
export type ServiceRequest = typeof serviceRequestsTable.$inferSelect;
export type InsertServiceRequestEvent = z.infer<typeof insertServiceRequestEventSchema>;
export type ServiceRequestEvent = typeof serviceRequestEventsTable.$inferSelect;
