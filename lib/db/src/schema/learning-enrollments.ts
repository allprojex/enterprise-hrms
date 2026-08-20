import { pgTable, serial, integer, text, boolean, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { learningCoursesTable, learningCourseDeliveryModeEnum } from "./learning-courses";
import { learningCourseSessionsTable } from "./learning-course-sessions";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { positionsTable } from "./positions";
import { organizationMembershipsTable } from "./organization-memberships";

// Learning Enrollments (Phase 3D, W85 — Learning Foundation): the core
// record — one employee's assignment to a course, optionally a specific
// session (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.3). `status` is
// the SOLE authoritative workflow-stage field (§10.3) — set to 'assigned'
// at creation in every case, regardless of approvalStatus; approval gates
// *actionability*, not row existence (§0's own "request->assigned
// mechanics"). No route or service function anywhere may branch on a
// nullable timestamp instead of `status` (enforced at the function-
// signature level from a later workstream onward, per §36's Definition of
// Done). No transitions are implemented in W85 — schema only.
//
// TWO INDEPENDENT AXES (§10.3): approvalStatus (only meaningful for
// employee_requested originType — hr_assigned/manager_assigned are always
// auto_approved at creation, per Owner Decision 1's workflow
// clarifications) and status (the authoritative execution/progress field).
// A rejected approvalStatus enrollment is permanently inert at
// status = 'assigned' — never advances, never physically deleted.
//
// IMMUTABLE TERMINAL OUTCOMES (Owner Decision 8, §10.6): once status
// reaches completed/failed/cancelled, no further transition is ever
// permitted. There is no reopen path in V1 — retraining always creates a
// NEW row. Uniqueness is therefore scoped to at most one non-terminal
// enrollment per (employeeId, courseId)/(employeeId, sessionId), never a
// permanent unique constraint that would block legitimate retraining.
//
// HISTORICAL INTEGRITY (§9): every field ending in "Snapshot", plus
// mandatoryAtAssignment, is copied from the course/employee at creation
// time and never re-read from the live course/employee row afterward — a
// later course edit or employee department/position/manager change never
// rewrites an existing enrollment's own historical meaning.
export const learningEnrollmentOriginTypeEnum = pgEnum("learning_enrollment_origin_type", [
  "hr_assigned",
  "manager_assigned",
  "employee_requested",
]);

export const learningEnrollmentApprovalStatusEnum = pgEnum("learning_enrollment_approval_status", [
  "auto_approved",
  "pending",
  "approved",
  "rejected",
]);

export const learningEnrollmentStatusEnum = pgEnum("learning_enrollment_status", [
  "assigned",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const learningEnrollmentsTable = pgTable(
  "learning_enrollments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => learningCoursesTable.id, { onDelete: "restrict" }),
    // Null for self-paced; required for instructor-led (validated at
    // creation by a later workstream).
    sessionId: integer("session_id").references(() => learningCourseSessionsTable.id, { onDelete: "restrict" }),
    // Historical business record — restrict, never cascade, matching
    // performance_reviews.employeeId exactly.
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    // --- Historical snapshots (§9), copied at creation, never re-read live ---
    courseTitleSnapshot: text("course_title_snapshot").notNull(),
    // The category's own display label at assignment time (not merely the
    // Master Data code), so a later label rename never rewrites what the
    // employee was actually shown.
    categorySnapshot: text("category_snapshot").notNull(),
    deliveryModeSnapshot: learningCourseDeliveryModeEnum("delivery_mode_snapshot").notNull(),
    hasAssessmentSnapshot: boolean("has_assessment_snapshot").notNull(),
    issuesCertificateSnapshot: boolean("issues_certificate_snapshot").notNull(),
    // Only meaningful when issuesCertificateSnapshot = true.
    certificateValidityMonthsSnapshot: integer("certificate_validity_months_snapshot"),
    departmentIdSnapshot: integer("department_id_snapshot").references(() => departmentsTable.id, { onDelete: "restrict" }),
    positionIdSnapshot: integer("position_id_snapshot").references(() => positionsTable.id, { onDelete: "restrict" }),
    // Snapshot of employees.reportingManagerId at creation — the "manager
    // of record" for learning.review.write dispatch and approval authority
    // (Owner Decision 1); a later manager change never reassigns an
    // in-flight or historical enrollment.
    managerEmployeeIdSnapshot: integer("manager_employee_id_snapshot").references(() => employeesTable.id, { onDelete: "restrict" }),
    // Snapshotted from course.mandatoryDefault, overridable by the assigner
    // at creation (Owner Decision 2).
    mandatoryAtAssignment: boolean("mandatory_at_assignment").notNull().default(false),
    // --- Origin / assignment ---
    originType: learningEnrollmentOriginTypeEnum("origin_type").notNull(),
    assignedByMembershipId: integer("assigned_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    // Optional compliance deadline; informational, drives an "overdue"
    // signal only — never a lifecycle gate.
    dueDate: timestamp("due_date", { withTimezone: true }),
    // --- Approval axis (§10.3) ---
    approvalStatus: learningEnrollmentApprovalStatusEnum("approval_status").notNull().default("auto_approved"),
    approvalDecidedByMembershipId: integer("approval_decided_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    approvalDecidedAt: timestamp("approval_decided_at", { withTimezone: true }),
    // --- Execution axis (§10.3) — the sole authoritative field ---
    status: learningEnrollmentStatusEnum("status").notNull().default("assigned"),
    // Instructor-led only; a fact, not a status — recording it never by
    // itself transitions `status`.
    attended: boolean("attended"),
    attendanceMarkedByMembershipId: integer("attendance_marked_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    attendanceMarkedAt: timestamp("attendance_marked_at", { withTimezone: true }),
    // Only meaningful when hasAssessmentSnapshot = true. No pass threshold
    // is stored anywhere (§11) — recorded directly by the instructor of
    // record or HR/L&D, never auto-derived from `score`.
    passed: boolean("passed"),
    score: numeric("score", { precision: 7, scale: 2 }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Required whenever status is set to cancelled by anyone other than the
    // enrolled employee cancelling their own not-yet-started, non-mandatory
    // request; always required, with no exception, when
    // mandatoryAtAssignment = true (§10.5).
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("learning_enrollments_org_employee_idx").on(table.organizationId, table.employeeId),
    index("learning_enrollments_org_manager_idx").on(table.organizationId, table.managerEmployeeIdSnapshot),
    index("learning_enrollments_org_course_status_idx").on(table.organizationId, table.courseId, table.status),
    index("learning_enrollments_org_session_idx").on(table.organizationId, table.sessionId),
  ],
);

export const insertLearningEnrollmentSchema = createInsertSchema(learningEnrollmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLearningEnrollment = z.infer<typeof insertLearningEnrollmentSchema>;
export type LearningEnrollment = typeof learningEnrollmentsTable.$inferSelect;
