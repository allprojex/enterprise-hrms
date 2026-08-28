import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { organizationDocumentsTable } from "./organization-documents";
import { branchesTable } from "./branches";
import { departmentsTable } from "./departments";
import { positionsTable } from "./positions";
import { employmentTypeEnum } from "./employees";
import { usersTable } from "./users";

/**
 * WS-10 — Onboarding template configuration
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §26.6-26.13).
 *
 * OD #14 forbids replacing working domain workflows with one generic workflow
 * engine, so there is no rule DSL, no expression evaluator and no scripting
 * here. A template version is an ordered list of task definitions whose every
 * behavioural choice — who is responsible, when it is due, what it references —
 * is a server-defined enum plus narrow configuration, never caller-supplied
 * code.
 *
 * The envelope/version split follows the precedent already established by
 * offers/offer_versions and organization_documents/organization_document_versions
 * rather than inventing a third versioning shape.
 */

export const onboardingTemplateStatusEnum = pgEnum("onboarding_template_status", ["draft", "active", "archived"]);

/**
 * Server-defined task kinds (§26.24). Each kind is not decoration: it selects
 * which authoritative domain the task REFERENCES and therefore how completion
 * is verified. Adding a kind is a deliberate code change, which is what keeps
 * "what can an onboarding task do" analyzable.
 *
 *   general                  — a plain instruction with no external authority.
 *   document                 — satisfied through a WS-5 `document_requirements`
 *                              row. WS-10 creates no document-requirement table
 *                              of its own (§26.15).
 *   acknowledgement          — satisfied when the employee acknowledges a
 *                              specific organization document version.
 *   induction                — carries an `onboarding_induction_details` row.
 *   asset_reference          — observes `asset_assignments`. Never creates one.
 *   inventory_reference      — observes Office Inventory custody. Never moves
 *                              stock (§26.24).
 *   access_reference         — observes the WS-2 employee/user link. Never
 *                              provisions identity.
 *   payroll_reference        — only meaningful where the Payroll module is
 *                              enabled and the caller holds Payroll authority.
 *   personnel_file_reference — observes whether a PIF exists. Never allocates
 *                              or reassigns a PIF number (§26.16).
 */
export const onboardingTaskKindEnum = pgEnum("onboarding_task_kind", [
  "general",
  "document",
  "acknowledgement",
  "induction",
  "asset_reference",
  "inventory_reference",
  "access_reference",
  "payroll_reference",
  "personnel_file_reference",
]);

/**
 * Server-defined responsibility resolvers (§26.11). A task definition names one
 * of these; it cannot supply code.
 *
 * The organization administrator named in §26.11 is deliberately NOT a resolver
 * of its own: it is addressed through `permission_holder` with an appropriate
 * key. A dedicated "org admin" resolver could only be implemented by matching a
 * role NAME, which is precisely what §26.11 (and §25.2 before it) forbids.
 */
export const onboardingResponsibilityResolverEnum = pgEnum("onboarding_responsibility_resolver", [
  "employee_self",
  "reporting_manager",
  "department_head",
  "permission_holder",
  "specific_membership",
]);

/**
 * Constrained due-date bases (§26.13). There is no offset expression language —
 * a basis plus a bounded whole-day offset is the entire model.
 */
export const onboardingDueBasisEnum = pgEnum("onboarding_due_basis", [
  "onboarding_start",
  "commencement_date",
  "dependency_completion",
]);

/**
 * The stable template envelope. Applicability lives here rather than on the
 * version because it answers "which employees is this template FOR", not "what
 * does this template DO" — and editing it cannot affect an in-flight onboarding,
 * whose tasks were already snapshotted from a version.
 *
 * Every applicability column is nullable and means "any" when null, so a
 * template with all four null applies organization-wide. No organization's
 * onboarding is hard-coded (§26.6).
 */
export const onboardingTemplatesTable = pgTable(
  "onboarding_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
    positionId: integer("position_id").references(() => positionsTable.id, { onDelete: "set null" }),
    employmentType: employmentTypeEnum("employment_type"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("onboarding_templates_org_name_unique").on(table.organizationId, table.name),
    index("onboarding_templates_org_idx").on(table.organizationId),
  ],
);

/**
 * A versioned definition. Only an `active` version may start new onboarding,
 * and at most one version per template may be active at a time — enforced by a
 * partial unique index rather than by application discipline alone, the same
 * guarantee `organization_document_versions` gives its own current version.
 *
 * Archiving a version never rewrites the instances that already snapshotted it
 * (§26.7).
 */
export const onboardingTemplateVersionsTable = pgTable(
  "onboarding_template_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => onboardingTemplatesTable.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: onboardingTemplateStatusEnum("status").notNull().default("draft"),
    changeNote: text("change_note"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activatedBy: integer("activated_by").references(() => usersTable.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: integer("archived_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("onboarding_template_versions_number_unique").on(table.templateId, table.versionNumber),
    uniqueIndex("onboarding_template_versions_active_unique")
      .on(table.templateId)
      .where(sql`status = 'active'`),
    index("onboarding_template_versions_org_idx").on(table.organizationId),
  ],
);

/**
 * One task definition inside a version. `dependsOnTemplateTaskId` is a
 * self-reference used only by the `dependency_completion` due basis; it is a
 * single predecessor, not a graph, because §26.9 forbids growing this into a
 * project-management system.
 */
export const onboardingTemplateTasksTable = pgTable(
  "onboarding_template_tasks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => onboardingTemplateVersionsTable.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    taskKind: onboardingTaskKindEnum("task_kind").notNull().default("general"),
    required: boolean("required").notNull().default(true),
    responsibleResolver: onboardingResponsibilityResolverEnum("responsible_resolver").notNull().default("employee_self"),
    /** Narrow resolver configuration: a permission key, or a membership id. Never code. */
    responsiblePermissionKey: text("responsible_permission_key"),
    responsibleMembershipId: integer("responsible_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    dueBasis: onboardingDueBasisEnum("due_basis"),
    dueOffsetDays: integer("due_offset_days"),
    dependsOnTemplateTaskId: integer("depends_on_template_task_id").references((): AnyPgColumn => onboardingTemplateTasksTable.id, {
      onDelete: "set null",
    }),
    /** For `document` tasks: the WS-5 document category the requirement is raised against. */
    documentCategoryCode: text("document_category_code"),
    /** For `acknowledgement` tasks: which organization document must be acknowledged. */
    acknowledgementDocumentId: integer("acknowledgement_document_id").references(() => organizationDocumentsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("onboarding_template_tasks_version_idx").on(table.templateVersionId, table.displayOrder),
    index("onboarding_template_tasks_org_idx").on(table.organizationId),
  ],
);

export const insertOnboardingTemplateSchema = createInsertSchema(onboardingTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOnboardingTemplateVersionSchema = createInsertSchema(onboardingTemplateVersionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOnboardingTemplateTaskSchema = createInsertSchema(onboardingTemplateTasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOnboardingTemplate = z.infer<typeof insertOnboardingTemplateSchema>;
export type OnboardingTemplate = typeof onboardingTemplatesTable.$inferSelect;
export type InsertOnboardingTemplateVersion = z.infer<typeof insertOnboardingTemplateVersionSchema>;
export type OnboardingTemplateVersion = typeof onboardingTemplateVersionsTable.$inferSelect;
export type InsertOnboardingTemplateTask = z.infer<typeof insertOnboardingTemplateTaskSchema>;
export type OnboardingTemplateTask = typeof onboardingTemplateTasksTable.$inferSelect;
