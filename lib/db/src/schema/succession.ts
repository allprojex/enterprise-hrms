import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { positionsTable } from "./positions";
import { usersTable } from "./users";
import { employeeDocumentsTable } from "./employee-documents";
import { learningCoursesTable } from "./learning-courses";
import { learningEnrollmentsTable } from "./learning-enrollments";
import { skillsTable } from "./skills-catalogue";

/**
 * WS-14 — succession (see §30.11–30.18, OD #7).
 *
 * THREE EXCLUSIONS ARE AS LOAD-BEARING AS ANYTHING THIS FILE CONTAINS.
 *
 *   NO NUMERIC SUCCESSOR RANKING (§30.12). Candidates are an unranked pool.
 *   There is deliberately no `rank`, `order`, `score` or `priority` column, and
 *   readiness must never be reconstructible into a hidden rank. Ranking people
 *   for succession carries real employment consequences, and the Owner declined
 *   to create that artifact.
 *
 *   NO POTENTIAL, NO 9-BOX (§30.13). Performance Management ships with
 *   `computedOverallScore` and `hrOverrideScore`, so a performance-plus-
 *   potential grid is genuinely buildable — which is precisely why its absence
 *   is recorded as a decision rather than a gap. Nothing here stores potential,
 *   and nothing infers it from a performance score.
 *
 *   SUCCESSION NEVER TOUCHES EMPLOYMENT STATE (§30.16). No code path in WS-14
 *   promotes, transfers, appoints, separates, rehires, creates an acting
 *   appointment, changes a position or changes a reporting line. WS-11 remains
 *   authoritative, and "ready now" is not an appointment. `separateEmployee`,
 *   `promoteEmployee`, `transferEmployee` and the assignment services are not
 *   imported anywhere in this module.
 *
 * Recruitment Talent Pools are untouched: they key on `candidateId` and have no
 * employee dimension, so OD #7's "distinct from Talent Pools" is already true
 * in the data (§30.1(8)).
 */

/**
 * Organization-configurable readiness. Named levels with an ordering used ONLY
 * for grouping and reporting (§30.13) — the ordering must never be presented as
 * a successor rank, which is why candidates carry no rank of their own.
 *
 * Readiness is HUMAN-OWNED. Nothing computes it from a performance score, a
 * capability gap, tenure, learning completion or AI.
 */
export const readinessLevelsTable = pgTable(
  "readiness_levels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** 1-based grouping order. Lower means nearer-term readiness. */
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("readiness_levels_org_ordinal_unique").on(table.organizationId, table.ordinal),
    index("readiness_levels_org_idx").on(table.organizationId, table.active),
  ],
);

/**
 * Succession plans exist only for organization-selected CRITICAL positions
 * (§30.11). No plan is required for every position, and creating one does not
 * change anything about the position itself — `positions` is not modified.
 */
export const successionPlanStatusEnum = pgEnum("succession_plan_status", ["active", "under_review", "closed"]);

export const successionPlansTable = pgTable(
  "succession_plans",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    positionId: integer("position_id")
      .notNull()
      .references(() => positionsTable.id, { onDelete: "restrict" }),
    status: successionPlanStatusEnum("status").notNull().default("active"),
    /** Why this position is treated as critical. Confidential; not employee-facing. */
    criticalityNotes: text("criticality_notes"),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: integer("closed_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /**
     * At most one OPEN plan per position, as a database guarantee rather than a
     * read-then-write check two concurrent creations could both pass. Closed
     * plans are excluded, so a position's full succession history is preserved.
     */
    uniqueIndex("succession_plans_open_per_position_unique")
      .on(table.organizationId, table.positionId)
      .where(sql`status in ('active', 'under_review')`),
    index("succession_plans_org_status_idx").on(table.organizationId, table.status),
  ],
);

/**
 * A successor candidate.
 *
 * MULTIPLE CANDIDATES PER PLAN, AND ONE EMPLOYEE MAY BE A CANDIDATE FOR
 * MULTIPLE PLANS (§30.11). Neither is limited.
 *
 * `status` preserves removal rather than deleting it: a candidate who is taken
 * off a plan leaves a record that they were once on it, which is what makes the
 * nomination history in `succession_candidate_events` meaningful.
 */
export const successionCandidateStatusEnum = pgEnum("succession_candidate_status", ["active", "removed", "appointed"]);

export const successionCandidatesTable = pgTable(
  "succession_candidates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => successionPlansTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    status: successionCandidateStatusEnum("status").notNull().default("active"),
    /**
     * Human-owned readiness (§30.13). Null means nobody has judged it yet — NOT
     * "not ready", a distinction the UI must preserve.
     *
     * Note what is absent: there is no rank, order, score or priority column,
     * and adding one is the change §30.12 forbids.
     */
    readinessLevelId: integer("readiness_level_id").references(() => readinessLevelsTable.id, { onDelete: "set null" }),
    /** The rationale a human recorded. Confidential (§30.17). */
    rationale: text("rationale"),
    nominatedByUserId: integer("nominated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    nominatedAt: timestamp("nominated_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: integer("removed_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** At most one ACTIVE candidacy per employee per plan; prior removals survive. */
    uniqueIndex("succession_candidates_active_unique")
      .on(table.organizationId, table.planId, table.employeeId)
      .where(sql`status = 'active'`),
    index("succession_candidates_plan_idx").on(table.organizationId, table.planId, table.status),
    index("succession_candidates_employee_idx").on(table.organizationId, table.employeeId),
  ],
);

/**
 * Append-only candidacy and readiness history (§30.13, §30.23).
 *
 * Readiness changes, nominations and removals are all recorded here and never
 * overwritten — the same balance §27, §28 and §29 struck: a mutable projection
 * on the row above for reading, an append-only record here for truth.
 */
export const successionCandidateEventTypeEnum = pgEnum("succession_candidate_event_type", [
  "nominated",
  "readiness_changed",
  "rationale_updated",
  "removed",
  "reinstated",
  "appointed_elsewhere",
]);

export const successionCandidateEventsTable = pgTable(
  "succession_candidate_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => successionCandidatesTable.id, { onDelete: "restrict" }),
    eventType: successionCandidateEventTypeEnum("event_type").notNull(),
    previousReadinessLevelId: integer("previous_readiness_level_id").references(() => readinessLevelsTable.id, {
      onDelete: "set null",
    }),
    newReadinessLevelId: integer("new_readiness_level_id").references(() => readinessLevelsTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    actorMembershipId: integer("actor_membership_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("succession_candidate_events_candidate_idx").on(table.organizationId, table.candidateId, table.occurredAt),
  ],
);

/**
 * WS-14 — development actions (§30.14).
 *
 * WS-14 LINKS TO LEARNING; IT DOES NOT BECOME LEARNING. A full Learning module
 * already ships (courses, sessions, enrolments, evidence, certificates), so
 * this table records the ACTION and optionally points at an existing course or
 * enrolment. It never creates a course, never enrols anybody, never issues a
 * certificate and never changes enrolment state — and nothing enrols
 * automatically merely because a gap exists.
 */
export const developmentActionStatusEnum = pgEnum("development_action_status", [
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

export const developmentActionsTable = pgTable(
  "development_actions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    /** The capability gap this action addresses, where it came from one. */
    skillId: integer("skill_id").references(() => skillsTable.id, { onDelete: "set null" }),
    /** The succession context, where the action came from a readiness discussion. */
    successionCandidateId: integer("succession_candidate_id").references(() => successionCandidatesTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    status: developmentActionStatusEnum("status").notNull().default("open"),
    targetDate: timestamp("target_date", { withTimezone: true }),
    /** References into the EXISTING Learning module. Validated for organization ownership; never mutated. */
    learningCourseId: integer("learning_course_id").references(() => learningCoursesTable.id, { onDelete: "set null" }),
    learningEnrollmentId: integer("learning_enrollment_id").references(() => learningEnrollmentsTable.id, {
      onDelete: "set null",
    }),
    evidenceDocumentId: integer("evidence_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    responsibleMembershipId: integer("responsible_membership_id"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("development_actions_org_employee_idx").on(table.organizationId, table.employeeId, table.status),
    index("development_actions_org_status_idx").on(table.organizationId, table.status, table.targetDate),
  ],
);

export const insertReadinessLevelSchema = createInsertSchema(readinessLevelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSuccessionPlanSchema = createInsertSchema(successionPlansTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSuccessionCandidateSchema = createInsertSchema(successionCandidatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertSuccessionCandidateEventSchema = createInsertSchema(successionCandidateEventsTable).omit({
  id: true,
  createdAt: true,
});
export const insertDevelopmentActionSchema = createInsertSchema(developmentActionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertReadinessLevel = z.infer<typeof insertReadinessLevelSchema>;
export type ReadinessLevel = typeof readinessLevelsTable.$inferSelect;
export type InsertSuccessionPlan = z.infer<typeof insertSuccessionPlanSchema>;
export type SuccessionPlan = typeof successionPlansTable.$inferSelect;
export type InsertSuccessionCandidate = z.infer<typeof insertSuccessionCandidateSchema>;
export type SuccessionCandidate = typeof successionCandidatesTable.$inferSelect;
export type InsertSuccessionCandidateEvent = z.infer<typeof insertSuccessionCandidateEventSchema>;
export type SuccessionCandidateEvent = typeof successionCandidateEventsTable.$inferSelect;
export type InsertDevelopmentAction = z.infer<typeof insertDevelopmentActionSchema>;
export type DevelopmentAction = typeof developmentActionsTable.$inferSelect;
