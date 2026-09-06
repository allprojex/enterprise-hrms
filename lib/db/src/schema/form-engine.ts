/**
 * WS-26 — Tenant Form, Workflow & Signature Engine (WS-26A foundation).
 *
 * Tenant-scoped official forms (a Leave Application, a Personal Information
 * Form, an Evaluation, a Probationary Assessment, or anything an organization
 * later defines) with immutable published versions, per-version workflow
 * stages, submissions with append-only revisions and a chronology.
 *
 * Deliberately NOT built on WS-8's `custom_forms`: those compose custom-field
 * definitions into a bare submission with no lifecycle, no rating matrices,
 * no signature slots and no print layout. WS-13 set the precedent of building
 * lifecycle ABOVE WS-8 rather than adding columns to it; WS-26 does the same
 * with its own tables. Their versioning idiom — `(parent, version_number)`
 * unique, one published version by partial index, published rows immutable —
 * is copied exactly.
 *
 * Tenant boundary: every table carries `organization_id NOT NULL`; the
 * migration enables RLS deny-by-default on each (CI's RLS coverage gate);
 * services scope every query by the organization id proven by
 * requireMembership. There is no template-sharing table: an organization sees
 * exactly the templates whose organization_id is its own.
 *
 * Signatures (WS-26B) will reference `form_submissions` / revisions; the
 * version's `signature_policy` and the `signature_applied`/`signature_revoked`
 * event types are the WS-26A hooks so the enum never needs altering later.
 */
import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, uniqueIndex, index, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { usersTable } from "./users";
import { generatedDocumentsTable } from "./generated-documents";

export const formTemplateTypeEnum = pgEnum("form_template_type", [
  "leave_application",
  "personal_information",
  "staff_evaluation",
  "probationary_assessment",
  "generic",
]);
export const formTemplateStatusEnum = pgEnum("form_template_status", ["active", "archived"]);
export const formTemplateVersionStatusEnum = pgEnum("form_template_version_status", ["draft", "published", "archived"]);

/** Who a stage is FOR (the label the form uses); resolution is a separate concern. */
export const formStageParticipantEnum = pgEnum("form_stage_participant", [
  "employee",
  "supervisor",
  "department_head",
  "hr",
  "final_approver",
  "assessor",
]);

/**
 * How the actor for a stage is resolved. The three WS-13 resolvers are reused
 * by vocabulary and by implementation; `subject_employee` (the person the
 * form is about, via their employee link) and `reporting_manager` (the
 * subject's reporting manager, via that manager's employee link) are the two
 * a form needs that a data-change request never did.
 */
export const formStageResolverEnum = pgEnum("form_stage_resolver", [
  "subject_employee",
  "reporting_manager",
  "department_head",
  "permission_holder",
  "specific_membership",
]);

export const formSubmissionStatusEnum = pgEnum("form_submission_status", [
  "draft",
  "submitted",
  "pending_approval",
  "returned",
  "rejected",
  "resubmitted",
  "approved",
  "finalized",
  "archived",
]);

export const formRevisionKindEnum = pgEnum("form_revision_kind", ["draft", "submitted", "resubmitted", "stage_update"]);

export const formSubmissionEventTypeEnum = pgEnum("form_submission_event_type", [
  "created",
  "draft_saved",
  "submitted",
  "stage_completed",
  "returned",
  "rejected",
  "resubmitted",
  "approved",
  "signature_applied",
  "signature_revoked",
  "final_document_generated",
  "finalized",
  "archived",
  "downloaded",
]);

export const formTemplatesTable = pgTable(
  "form_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** Stable organization-local key, e.g. "wwm_leave_application". */
    templateKey: text("template_key").notNull(),
    formType: formTemplateTypeEnum("form_type").notNull(),
    /** When set, the module must be enabled for the organization for the template to be usable. */
    moduleKey: text("module_key"),
    title: text("title").notNull(),
    description: text("description"),
    status: formTemplateStatusEnum("status").notNull().default("active"),
    currentPublishedVersionId: integer("current_published_version_id"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByMembershipId: integer("archived_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("form_templates_org_key_unique").on(table.organizationId, table.templateKey),
    index("form_templates_org_type_idx").on(table.organizationId, table.formType),
    index("form_templates_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const formTemplateVersionsTable = pgTable(
  "form_template_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => formTemplatesTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: formTemplateVersionStatusEnum("status").notNull().default("draft"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    /** Server-validated document model — sections, items, bindings, print header. See lib/formEngine/definition.ts. */
    definition: jsonb("definition").notNull(),
    /** SHA-256 of the canonical JSON of `definition`; a published version's hash never changes. */
    definitionSha256: text("definition_sha256").notNull(),
    /** Signature slots and methods (WS-26B consumes; WS-26A validates and renders blank lines). */
    signaturePolicy: jsonb("signature_policy"),
    /** Print configuration: status-marker placement, page size, header options. */
    renderConfig: jsonb("render_config"),
    changeNote: text("change_note"),
    /** Set when the first submission references this version; the definition is frozen from then on. */
    firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByMembershipId: integer("published_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("form_template_versions_template_number_unique").on(table.templateId, table.versionNumber),
    uniqueIndex("form_template_versions_one_published_unique")
      .on(table.templateId)
      .where(sql`${table.status} = 'published'`),
    index("form_template_versions_org_idx").on(table.organizationId),
    index("form_template_versions_template_idx").on(table.templateId),
  ],
);

export const formWorkflowStagesTable = pgTable(
  "form_workflow_stages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => formTemplateVersionsTable.id, { onDelete: "cascade" }),
    stageOrder: integer("stage_order").notNull(),
    name: text("name").notNull(),
    participant: formStageParticipantEnum("participant").notNull(),
    resolver: formStageResolverEnum("resolver").notNull(),
    resolverConfig: jsonb("resolver_config"),
    /** Section keys this stage may write; other sections are read-only for it. */
    editableSectionKeys: jsonb("editable_section_keys").notNull(),
    /** Subset of: complete | approve | return | reject. */
    allowedActions: jsonb("allowed_actions").notNull(),
    /** Signature slot this stage's actor signs (WS-26B). */
    signatureSlotKey: text("signature_slot_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("form_workflow_stages_version_order_unique").on(table.templateVersionId, table.stageOrder),
    index("form_workflow_stages_org_idx").on(table.organizationId),
  ],
);

export const formSubmissionsTable = pgTable(
  "form_submissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => formTemplatesTable.id, { onDelete: "restrict" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => formTemplateVersionsTable.id, { onDelete: "restrict" }),
    subjectEmployeeId: integer("subject_employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    status: formSubmissionStatusEnum("status").notNull().default("draft"),
    currentStageOrder: integer("current_stage_order"),
    /** Frozen at first submit so a later workflow change never alters an in-flight submission (WS-13 rule). */
    stageCountSnapshot: integer("stage_count_snapshot"),
    currentRevisionId: integer("current_revision_id"),
    /** Optional link to the business record the form represents (leave_request, performance_review, employment_period). */
    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: integer("linked_entity_id"),
    createdByMembershipId: integer("created_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalDocumentId: integer("final_document_id").references(() => generatedDocumentsTable.id, { onDelete: "restrict" }),
    finalSha256: text("final_sha256"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("form_submissions_org_template_idx").on(table.organizationId, table.templateId),
    index("form_submissions_org_subject_idx").on(table.organizationId, table.subjectEmployeeId),
    index("form_submissions_org_status_idx").on(table.organizationId, table.status),
    index("form_submissions_org_linked_idx").on(table.organizationId, table.linkedEntityType, table.linkedEntityId),
  ],
);

/** Append-only. A revision is never updated; the submission's currentRevisionId advances. */
export const formSubmissionRevisionsTable = pgTable(
  "form_submission_revisions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => formSubmissionsTable.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    kind: formRevisionKindEnum("kind").notNull(),
    /** User-entered values keyed by item key. Never contains bound read-only values. */
    answers: jsonb("answers").notNull(),
    /** Values pulled from authoritative records at the instant of the save. */
    autofillSnapshot: jsonb("autofill_snapshot").notNull(),
    /** Server-computed values (totals) for this revision. */
    computed: jsonb("computed").notNull(),
    stageOrder: integer("stage_order"),
    savedByMembershipId: integer("saved_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("form_submission_revisions_submission_number_unique").on(table.submissionId, table.revisionNumber),
    index("form_submission_revisions_org_idx").on(table.organizationId),
  ],
);

/** Chronology — one row per fact, WS-13's shape; `details` never carries form content. */
export const formSubmissionEventsTable = pgTable(
  "form_submission_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    submissionId: integer("submission_id")
      .notNull()
      .references(() => formSubmissionsTable.id, { onDelete: "cascade" }),
    eventType: formSubmissionEventTypeEnum("event_type").notNull(),
    stageOrder: integer("stage_order"),
    stageName: text("stage_name"),
    revisionId: integer("revision_id").references(() => formSubmissionRevisionsTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    details: jsonb("details"),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorMembershipId: integer("actor_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("form_submission_events_submission_idx").on(table.submissionId, table.occurredAt),
    index("form_submission_events_org_idx").on(table.organizationId),
  ],
);

export const insertFormTemplateSchema = createInsertSchema(formTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFormTemplate = z.infer<typeof insertFormTemplateSchema>;
export type FormTemplate = typeof formTemplatesTable.$inferSelect;
export type FormTemplateVersion = typeof formTemplateVersionsTable.$inferSelect;
export type FormWorkflowStage = typeof formWorkflowStagesTable.$inferSelect;
export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
export type FormSubmissionRevision = typeof formSubmissionRevisionsTable.$inferSelect;
export type FormSubmissionEvent = typeof formSubmissionEventsTable.$inferSelect;
export type FormTemplateType = FormTemplate["formType"];
export type FormSubmissionStatus = FormSubmission["status"];
export type FormStageParticipant = FormWorkflowStage["participant"];
export type FormStageResolver = FormWorkflowStage["resolver"];
