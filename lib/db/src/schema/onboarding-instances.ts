import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { candidatesTable } from "./candidates";
import { documentRequirementsTable } from "./document-requirements";
import { usersTable } from "./users";
import {
  onboardingTemplatesTable,
  onboardingTemplateVersionsTable,
  onboardingTemplateTasksTable,
  onboardingTaskKindEnum,
  onboardingResponsibilityResolverEnum,
} from "./onboarding-templates";

/**
 * WS-10 — Employee onboarding instances and their tasks
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §26.4, §26.8-26.12, §26.28).
 *
 * Formal onboarding attaches to `employees.id` and nothing else (§26.4). There
 * is deliberately no onboarding-specific person record, no temporary identity
 * and no duplicate of the employee row — an onboarding instance is a pointer to
 * the canonical employee plus its own progress.
 *
 * `overdue` is absent from every status enum below on purpose. It is DERIVED at
 * read time from `dueAt` + an unfinished status + the current instant (§26.8),
 * so it cannot drift out of step with the clock the way a persisted flag would.
 */

export const onboardingInstanceStatusEnum = pgEnum("onboarding_instance_status", [
  "not_started",
  "in_progress",
  "completed",
  "cancelled",
]);

export const onboardingTaskStatusEnum = pgEnum("onboarding_task_status", ["pending", "completed", "waived", "cancelled"]);

export const inductionDeliveryModeEnum = pgEnum("induction_delivery_mode", ["in_person", "virtual", "hybrid"]);

/**
 * One employee's onboarding.
 *
 * `templateVersionId` is the snapshot anchor required by §26.7: the tasks below
 * were copied from that exact version, and later edits to the template create a
 * NEW version rather than reaching back into this instance.
 *
 * `commencementDate` is copied from the employee's hire date when the instance
 * starts rather than joined at read time, because due dates were resolved
 * against the value that was true then; re-reading a later-corrected hire date
 * would silently move historical deadlines.
 *
 * `candidateId` is provenance only and is nullable — §26.35 requires that an
 * existing, migrated or manually created employee can be onboarded with no
 * Recruitment record at all.
 */
export const onboardingInstancesTable = pgTable(
  "onboarding_instances",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => onboardingTemplatesTable.id, { onDelete: "restrict" }),
    templateVersionId: integer("template_version_id")
      .notNull()
      .references(() => onboardingTemplateVersionsTable.id, { onDelete: "restrict" }),
    status: onboardingInstanceStatusEnum("status").notNull().default("not_started"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
    commencementDate: timestamp("commencement_date", { withTimezone: true }),
    candidateId: integer("candidate_id").references(() => candidatesTable.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: integer("cancelled_by").references(() => usersTable.id, { onDelete: "set null" }),
    cancellationReason: text("cancellation_reason"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * At most one OPEN onboarding per employee, guaranteed by the database
     * rather than by a read-then-write check that two concurrent conversion
     * retries could both pass (§26.34's idempotency requirement).
     * Completed and cancelled instances are excluded, so an organization may
     * legitimately re-onboard someone later.
     */
    uniqueIndex("onboarding_instances_open_per_employee_unique")
      .on(table.organizationId, table.employeeId)
      .where(sql`status in ('not_started', 'in_progress')`),
    index("onboarding_instances_org_status_idx").on(table.organizationId, table.status),
    index("onboarding_instances_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

/**
 * A task belonging to one instance, snapshotted from a template task.
 *
 * Title, description, requiredness, kind and resolver are COPIED rather than
 * joined so that editing the template never rewrites work already issued
 * (§26.7). `templateTaskId` is kept as a nullable provenance pointer only.
 *
 * Responsibility is stored as the RESOLVER, not as a resolved person: pending
 * work must re-resolve to whoever currently holds the relationship (§26.12).
 * The resolved identity is captured only at the moment of completion or waiver,
 * where `completedByName`/`waivedByName` freeze it as historical evidence — the
 * same authority-snapshot discipline WS-9 proved for approval decisions.
 */
export const onboardingTasksTable = pgTable(
  "onboarding_tasks",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    instanceId: integer("instance_id")
      .notNull()
      .references(() => onboardingInstancesTable.id, { onDelete: "cascade" }),
    templateTaskId: integer("template_task_id").references(() => onboardingTemplateTasksTable.id, { onDelete: "set null" }),
    displayOrder: integer("display_order").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    taskKind: onboardingTaskKindEnum("task_kind").notNull().default("general"),
    required: boolean("required").notNull().default(true),
    responsibleResolver: onboardingResponsibilityResolverEnum("responsible_resolver").notNull().default("employee_self"),
    responsiblePermissionKey: text("responsible_permission_key"),
    responsibleMembershipId: integer("responsible_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: onboardingTaskStatusEnum("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by").references(() => usersTable.id, { onDelete: "set null" }),
    completedByName: text("completed_by_name"),
    completionNotes: text("completion_notes"),
    waivedAt: timestamp("waived_at", { withTimezone: true }),
    waivedBy: integer("waived_by").references(() => usersTable.id, { onDelete: "set null" }),
    waivedByName: text("waived_by_name"),
    waiverReason: text("waiver_reason"),
    /**
     * For `document` tasks: the WS-5 requirement that satisfies this task. WS-10
     * stores a pointer and nothing else — required/provided/verified/rejected
     * and expiry all remain WS-5's own state (§26.15).
     */
    documentRequirementId: integer("document_requirement_id").references(() => documentRequirementsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("onboarding_tasks_instance_idx").on(table.instanceId, table.displayOrder),
    index("onboarding_tasks_org_status_idx").on(table.organizationId, table.status),
    index("onboarding_tasks_due_idx").on(table.organizationId, table.dueAt),
  ],
);

/**
 * Induction specialization (§26.22).
 *
 * A linked 1:1 detail row rather than columns on `onboarding_tasks`, for the
 * same reason WS-9 made employment particulars a separate record instead of
 * sixteen columns on `offer_versions`: these fields are meaningless — and would
 * be NULL — on every task that is not an induction, and the reschedule fields
 * are the kind that keep growing. Induction remains a KIND of onboarding task,
 * not a second workflow engine: its status, requiredness, responsibility,
 * due date and completion all live on the task row above.
 *
 * There is no course catalogue, enrollment or curriculum here. Learning stays a
 * separate module.
 */
export const onboardingInductionDetailsTable = pgTable(
  "onboarding_induction_details",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    taskId: integer("task_id")
      .notNull()
      .references(() => onboardingTasksTable.id, { onDelete: "cascade" }),
    facilitatorMembershipId: integer("facilitator_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    deliveryMode: inductionDeliveryModeEnum("delivery_mode"),
    location: text("location"),
    meetingDetails: text("meeting_details"),
    attendedAt: timestamp("attended_at", { withTimezone: true }),
    attendanceNotes: text("attendance_notes"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    lastRescheduledAt: timestamp("last_rescheduled_at", { withTimezone: true }),
    lastRescheduleReason: text("last_reschedule_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("onboarding_induction_details_task_unique").on(table.taskId),
    index("onboarding_induction_details_org_idx").on(table.organizationId),
  ],
);

export const insertOnboardingInstanceSchema = createInsertSchema(onboardingInstancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOnboardingTaskSchema = createInsertSchema(onboardingTasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOnboardingInductionDetailSchema = createInsertSchema(onboardingInductionDetailsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOnboardingInstance = z.infer<typeof insertOnboardingInstanceSchema>;
export type OnboardingInstance = typeof onboardingInstancesTable.$inferSelect;
export type InsertOnboardingTask = z.infer<typeof insertOnboardingTaskSchema>;
export type OnboardingTask = typeof onboardingTasksTable.$inferSelect;
export type InsertOnboardingInductionDetail = z.infer<typeof insertOnboardingInductionDetailSchema>;
export type OnboardingInductionDetail = typeof onboardingInductionDetailsTable.$inferSelect;
