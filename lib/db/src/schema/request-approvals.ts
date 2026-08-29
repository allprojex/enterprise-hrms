import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { dataChangeRequestsTable } from "./data-change-requests";

/**
 * WS-13 — approval configuration, field policy, and the data-change chronology
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §29.4, §29.8, §29.19).
 *
 * §29.8 — THIS IS DELIBERATELY WS-13'S OWN, NOT A SHARED PRIMITIVE.
 * It is modelled on WS-9's proven `recruitment_approval_stages` — configurable
 * ordered stages, server-defined resolvers, a stage count frozen at request
 * time — but it is namespaced to WS-13 and Recruitment is neither refactored
 * nor made to depend on it. Architectural duplication is preferred here to
 * destabilising a completed workstream, exactly as §27.21 and §28.25 require.
 * A future implementation of OD #14 may extract the common primitive
 * deliberately; **WS-13 is not that refactor** (§29.9).
 *
 * There is no rule DSL, no expression evaluator and no generic state machine —
 * the constraint §25.2 placed on Recruitment, applied again.
 */

export const requestApprovalPurposeEnum = pgEnum("request_approval_purpose", ["data_change", "service_request"]);

/**
 * Server-defined authority resolvers. A stage NAMES one; it cannot supply code.
 * Adding a resolver is a deliberate code change, which is what keeps "who may
 * approve" analyzable — and it is why authority is never inferred from a role
 * NAME (§29.18, extending the §25.2 ruling).
 *
 *   department_head   — the authoritative `department_heads` relationship for
 *                       the subject employee's own department.
 *   permission_holder — any active member holding a named permission key.
 *   specific_membership — one named person.
 */
export const requestAuthorityResolverEnum = pgEnum("request_authority_resolver", [
  "department_head",
  "permission_holder",
  "specific_membership",
]);

export const requestApprovalStagesTable = pgTable(
  "request_approval_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    purpose: requestApprovalPurposeEnum("purpose").notNull(),
    /** 1-based position. Stages are decided strictly in ascending order. */
    stageOrder: integer("stage_order").notNull(),
    name: text("name").notNull(),
    resolverType: requestAuthorityResolverEnum("resolver_type").notNull(),
    /**
     * Resolver input, validated per resolver type by the service:
     *   permission_holder   -> { permissionKey }
     *   specific_membership -> { membershipId }
     *   department_head     -> {} (the subject supplies the department)
     */
    resolverConfig: jsonb("resolver_config"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("request_approval_stages_org_purpose_order_unique").on(
      table.organizationId,
      table.purpose,
      table.stageOrder,
    ),
    index("request_approval_stages_org_purpose_idx").on(table.organizationId, table.purpose),
  ],
);

/**
 * WS-13 — per-field approval policy (§29.4).
 *
 * A row says only: for THIS organization, this ELIGIBLE field requires approval
 * (or does not). It cannot introduce a field. The service validates every
 * `fieldKey` against the code-level registry before reading or writing a row
 * here, so **configuration can never convert a specialist-module-owned field
 * into a generic WS-13 field** (§29.3, §29.4). A stale row naming a key that is
 * no longer registered is inert, not an escape hatch.
 *
 * Absence of a row means the product default for that field, which is what
 * keeps "not every HR edit becomes maker-checker" true by construction rather
 * than by an organization remembering to opt out (§29.4).
 */
export const dataChangeFieldPoliciesTable = pgTable(
  "data_change_field_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** Must be a key in the WS-13 eligible-field registry. Validated in the service. */
    fieldKey: text("field_key").notNull(),
    approvalRequired: boolean("approval_required").notNull().default(false),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("data_change_field_policies_org_field_unique").on(table.organizationId, table.fieldKey)],
);

/**
 * WS-13 — the data-change chronology (§29.19).
 *
 * APPEND-ONLY. A later event never overwrites an earlier one. This carries the
 * decisions as well as the lifecycle, so the record of who decided what, when,
 * and at which stage cannot drift from the record of what happened to the
 * request — the same reasoning that made WS-12's case chronologies append-only.
 *
 * §29.26 ITEM 2 RESOLVED — ONE TABLE PER REQUEST KIND, WITH A REAL FOREIGN KEY.
 * A single shared decision table would need a polymorphic (requestKind,
 * requestId) pair, which this repository can only express WITHOUT a foreign key
 * — the shape `document_requirements`' owner pair took, which WS-10 then had to
 * validate in application code because the database could not. Service requests
 * keep their own chronology for the same reason, and their vocabularies
 * genuinely differ: a data change is applied or fails to apply; a service
 * request is fulfilled.
 */
export const dataChangeEventTypeEnum = pgEnum("data_change_event_type", [
  "requested",
  "stage_approved",
  "approved",
  "rejected",
  "returned",
  "resubmitted",
  "withdrawn",
  "stale_detected",
  "reconfirmed",
  "applied",
  "application_failed",
]);

export const dataChangeEventsTable = pgTable(
  "data_change_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => dataChangeRequestsTable.id, { onDelete: "restrict" }),
    eventType: dataChangeEventTypeEnum("event_type").notNull(),
    /** Which stage produced this event, where it came from a stage decision. */
    stageOrder: integer("stage_order"),
    stageName: text("stage_name"),
    notes: text("notes"),
    /**
     * Small typed payload. NEVER a sensitive value in the clear: the service
     * masks before writing here, because audit and chronology have different
     * read rules from the request itself (§29.19, OD #23).
     */
    details: jsonb("details"),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorMembershipId: integer("actor_membership_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("data_change_events_request_idx").on(table.organizationId, table.requestId, table.occurredAt)],
);

export const insertRequestApprovalStageSchema = createInsertSchema(requestApprovalStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDataChangeFieldPolicySchema = createInsertSchema(dataChangeFieldPoliciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertDataChangeEventSchema = createInsertSchema(dataChangeEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRequestApprovalStage = z.infer<typeof insertRequestApprovalStageSchema>;
export type RequestApprovalStage = typeof requestApprovalStagesTable.$inferSelect;
export type InsertDataChangeFieldPolicy = z.infer<typeof insertDataChangeFieldPolicySchema>;
export type DataChangeFieldPolicy = typeof dataChangeFieldPoliciesTable.$inferSelect;
export type InsertDataChangeEvent = z.infer<typeof insertDataChangeEventSchema>;
export type DataChangeEvent = typeof dataChangeEventsTable.$inferSelect;
