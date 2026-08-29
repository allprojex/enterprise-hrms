import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { positionsTable } from "./positions";
import { usersTable } from "./users";
import { employeeDocumentsTable } from "./employee-documents";
import { employeeCertificationsTable } from "./employee-certifications";
import { skillsTable, proficiencyLevelsTable } from "./skills-catalogue";

/**
 * WS-14 — employee capability: claim, assessment, verification and the current
 * projection (see §30.5–30.10).
 *
 * FOUR THINGS, NOT ONE MUTABLE COLUMN (§30.7). The shipped `employee_skills`
 * table collapses everything into a free-text `proficiencyLevel` with no
 * assessor, date, evidence or history — §30.1(1) records that as the gap this
 * workstream exists to close. So the model here keeps them apart:
 *
 *   the CLAIM        — what the employee says (this table, `claimedLevelId`);
 *   an ASSESSMENT    — an authorized assessor's observed proficiency at a point
 *                      in time (`employee_skill_assessments`, append-only);
 *   a VERIFICATION   — the organization confirming a capability as
 *                      authoritative (also an assessment row, `kind` =
 *                      verification, with its own decision);
 *   the CURRENT      — the projection everything else compares against
 *   VERIFIED         (`verifiedLevelId` here, written only from a verification).
 *
 * `employee_skills` (Phase 2A, W24) IS NOT TOUCHED. It keeps its rows, its
 * routes and its `employee.write` gate exactly as shipped (§30.22); this is a
 * new typed record beside it, and no legacy row is reinterpreted, migrated or
 * given a fabricated ordinal, assessor or verification.
 */

/**
 * The lifecycle of one employee-skill record. Deliberately small.
 *
 *   claimed  — the employee (or HR) asserted it; NOT authoritative (§30.5).
 *   assessed — an assessor has recorded an observed level, but the
 *              organization has not confirmed it. A manager assessment does
 *              NOT automatically become verification (§30.8).
 *   verified — organization-verified. This is the only state whose level may
 *              satisfy a position requirement (§30.6).
 *   rejected — the claim was considered and declined. Retained, never deleted.
 */
export const employeeSkillStatusEnum = pgEnum("employee_skill_status", ["claimed", "assessed", "verified", "rejected"]);

/** Where the record originated. Recorded server-side from the route, never accepted from a client. */
export const employeeSkillSourceEnum = pgEnum("employee_skill_source", [
  "employee_self_service",
  "hr_entry",
  "assessment",
  "import",
]);

export const employeeSkillRecordsTable = pgTable(
  "employee_skill_records",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skillsTable.id, { onDelete: "restrict" }),
    status: employeeSkillStatusEnum("status").notNull().default("claimed"),
    source: employeeSkillSourceEnum("source").notNull(),
    /** What the employee or HR asserted. Never satisfies a requirement on its own. */
    claimedLevelId: integer("claimed_level_id").references(() => proficiencyLevelsTable.id, { onDelete: "set null" }),
    /**
     * THE AUTHORITATIVE PROJECTION (§30.6). Written only by a verification, and
     * null until one happens. Every gap calculation, capability report and
     * succession evidence read uses this and nothing else.
     */
    verifiedLevelId: integer("verified_level_id").references(() => proficiencyLevelsTable.id, { onDelete: "set null" }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedByUserId: integer("verified_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** Optional WS-5 evidence. WS-14 stores no documents of its own (§30.19). */
    evidenceDocumentId: integer("evidence_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    /**
     * Optional link to an EXISTING certification record (§30.20). A reference,
     * never a copy: `employee_certifications` remains authoritative, including
     * its `expiryDate`, and an expired certification makes this evidence no
     * longer current — derived at read time, never stored here.
     */
    certificationId: integer("certification_id").references(() => employeeCertificationsTable.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** One record per employee per skill; its history lives in the assessments table. */
    uniqueIndex("employee_skill_records_employee_skill_unique").on(
      table.organizationId,
      table.employeeId,
      table.skillId,
    ),
    index("employee_skill_records_org_employee_idx").on(table.organizationId, table.employeeId),
    index("employee_skill_records_org_skill_idx").on(table.organizationId, table.skillId, table.status),
  ],
);

/**
 * Append-only assessment and verification history (§30.7).
 *
 * A NEW ASSESSMENT NEVER ERASES THE PREVIOUS ONE. There is no update or delete
 * path for a row here anywhere in WS-14 — the same discipline WS-12 applied to
 * case chronology and WS-13 to decision history. The current projection lives
 * on the record above; the truth of who judged what, when, lives here.
 */
export const employeeSkillAssessmentKindEnum = pgEnum("employee_skill_assessment_kind", [
  "assessment",
  "verification",
  "rejection",
]);

/** Which authority the actor exercised. Resolved server-side, never claimed by the client. */
export const assessorRoleEnum = pgEnum("assessor_role", ["hr", "reporting_manager"]);

export const employeeSkillAssessmentsTable = pgTable(
  "employee_skill_assessments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    recordId: integer("record_id")
      .notNull()
      .references(() => employeeSkillRecordsTable.id, { onDelete: "restrict" }),
    kind: employeeSkillAssessmentKindEnum("kind").notNull(),
    /** The observed or confirmed level. Null on a rejection. */
    levelId: integer("level_id").references(() => proficiencyLevelsTable.id, { onDelete: "set null" }),
    assessorRole: assessorRoleEnum("assessor_role").notNull(),
    assessorUserId: integer("assessor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    assessorMembershipId: integer("assessor_membership_id"),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    evidenceDocumentId: integer("evidence_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employee_skill_assessments_record_idx").on(table.organizationId, table.recordId, table.assessedAt),
    index("employee_skill_assessments_org_kind_idx").on(table.organizationId, table.kind),
  ],
);

/**
 * WS-14 — position skill requirements (§30.9).
 *
 * ATTACHED TO `positions`, WHICH IS THE ENTIRE JOB MODEL IN THIS PLATFORM
 * (§30.1(9)): there is no designation, job family, career level or job profile
 * anywhere, and WS-14 does not invent one merely to host requirements —
 * inventing a job architecture is a separate workstream's decision.
 *
 * NO WEIGHTING, NO SCORING. §30.9 is explicit: this is not a job-evaluation
 * engine, and a weighted capability score would manufacture exactly the false
 * precision §30.13 refuses for readiness.
 */
export const positionSkillRequirementsTable = pgTable(
  "position_skill_requirements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    positionId: integer("position_id")
      .notNull()
      .references(() => positionsTable.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skillsTable.id, { onDelete: "restrict" }),
    /** The minimum VERIFIED level that satisfies this requirement (§30.6). */
    minimumLevelId: integer("minimum_level_id").references(() => proficiencyLevelsTable.id, { onDelete: "set null" }),
    /** Mandatory requirements gate a gap summary; preferred ones are reported separately. */
    mandatory: boolean("mandatory").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("position_skill_requirements_unique").on(table.organizationId, table.positionId, table.skillId),
    index("position_skill_requirements_org_position_idx").on(table.organizationId, table.positionId, table.active),
  ],
);

export const insertEmployeeSkillRecordSchema = createInsertSchema(employeeSkillRecordsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEmployeeSkillAssessmentSchema = createInsertSchema(employeeSkillAssessmentsTable).omit({
  id: true,
  createdAt: true,
});
export const insertPositionSkillRequirementSchema = createInsertSchema(positionSkillRequirementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeSkillRecord = z.infer<typeof insertEmployeeSkillRecordSchema>;
export type EmployeeSkillRecord = typeof employeeSkillRecordsTable.$inferSelect;
export type InsertEmployeeSkillAssessment = z.infer<typeof insertEmployeeSkillAssessmentSchema>;
export type EmployeeSkillAssessment = typeof employeeSkillAssessmentsTable.$inferSelect;
export type InsertPositionSkillRequirement = z.infer<typeof insertPositionSkillRequirementSchema>;
export type PositionSkillRequirement = typeof positionSkillRequirementsTable.$inferSelect;
