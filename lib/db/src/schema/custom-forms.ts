import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { customFieldScopeEnum } from "./custom-fields";

/**
 * WS-8 — Form Builder (§24.20–24.23).
 *
 * A form composes custom fields, sections, headings and help text into a
 * data-entry surface. It never creates tables, never executes code, never runs
 * a workflow and never bypasses a domain service.
 *
 * Layout is stored as a single validated JSONB document rather than a table
 * per visual element — §24.21 asks for an ordered-section editor, not a page
 * designer, and a table per heading would be structure without purpose. The
 * service validates the layout's shape and, critically, that every field it
 * references is a real, active custom field belonging to this organization
 * and this form's scope.
 */

/** §24.20 — the four approved initial form types. */
export const customFormTypeEnum = pgEnum("custom_form_type", [
  "internal_hr",
  "employee_ess",
  "onboarding",
  "candidate_application",
]);

export const customFormVersionStatusEnum = pgEnum("custom_form_version_status", ["draft", "published", "archived"]);

export const customFormStatusEnum = pgEnum("custom_form_status", ["active", "archived"]);

/**
 * Stable form identity (§24.22). Like a field definition, the identity outlives
 * every revision, so a submission captured under version 1 still resolves to
 * the same logical form after version 7 is published.
 */
export const customFormsTable = pgTable(
  "custom_forms",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    formKey: text("form_key").notNull(),
    formType: customFormTypeEnum("form_type").notNull(),
    /** The entity context submissions attach to — kept on the form so it cannot drift between versions. */
    scope: customFieldScopeEnum("scope").notNull(),
    status: customFormStatusEnum("status").notNull().default("active"),
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
    uniqueIndex("custom_forms_org_key_unique").on(table.organizationId, table.formKey),
    index("custom_forms_org_type_idx").on(table.organizationId, table.formType),
  ],
);

/**
 * One revision of a form's composition.
 *
 * A published version is effectively frozen: editing a live form creates the
 * next draft rather than mutating what people have already submitted against
 * (§24.22). At most one version per form may be `published`, enforced by a
 * partial unique index added in the migration.
 */
export const customFormVersionsTable = pgTable(
  "custom_form_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    formId: integer("form_id")
      .notNull()
      .references(() => customFormsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * `{ sections: [{ key, heading, helpText, items: [{ kind: "field", definitionId } | { kind: "heading" | "help", text }] }] }`
     * Shape and every referenced definition are validated server-side before
     * a version is stored — a layout is never trusted from the client (§24.24).
     */
    layout: jsonb("layout").notNull(),
    status: customFormVersionStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("custom_form_versions_form_number_unique").on(table.formId, table.versionNumber),
    index("custom_form_versions_form_idx").on(table.formId),
    index("custom_form_versions_org_idx").on(table.organizationId),
  ],
);

/**
 * A submitted form — business data, append-oriented (§24.22).
 *
 * `answers` snapshots what was submitted TOGETHER WITH the field-definition
 * version each answer was captured under:
 *
 *   [{ definitionId, definitionVersionId, fieldKey, label, type, value }]
 *
 * Carrying the label and type in the snapshot is deliberate: it is what lets a
 * historical submission render exactly as it was submitted even after the live
 * definition's label or options have changed (§24.22, and the renderer
 * requirement that old submission screens must not shift under later edits).
 *
 * `entityId` is nullable because the `onboarding` scope has no authoritative
 * entity until WS-10 builds one. WS-8 supports defining and composing
 * onboarding forms without fabricating onboarding records to attach them to.
 */
export const customFormSubmissionsTable = pgTable(
  "custom_form_submissions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    formId: integer("form_id")
      .notNull()
      .references(() => customFormsTable.id, { onDelete: "restrict" }),
    formVersionId: integer("form_version_id")
      .notNull()
      .references(() => customFormVersionsTable.id, { onDelete: "restrict" }),
    scope: customFieldScopeEnum("scope").notNull(),
    entityId: integer("entity_id"),
    answers: jsonb("answers").notNull(),
    submittedByMembershipId: integer("submitted_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("custom_form_submissions_org_form_idx").on(table.organizationId, table.formId),
    index("custom_form_submissions_org_scope_entity_idx").on(table.organizationId, table.scope, table.entityId),
  ],
);

export const insertCustomFormSchema = createInsertSchema(customFormsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomForm = z.infer<typeof insertCustomFormSchema>;
export type CustomForm = typeof customFormsTable.$inferSelect;
export type CustomFormVersion = typeof customFormVersionsTable.$inferSelect;
export type CustomFormSubmission = typeof customFormSubmissionsTable.$inferSelect;
export type CustomFormType = CustomForm["formType"];
