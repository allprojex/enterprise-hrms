import { pgTable, serial, integer, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";
import { caseConfidentialityEnum } from "./disciplinary-cases";

/**
 * WS-12 — Grievance cases (§28.4, OD #9).
 *
 * A SEPARATE TABLE, NOT A FLAG ON `disciplinary_cases`. OD #9's "distinct record
 * types" is implemented literally because the two are not the same shape. In a
 * disciplinary case the employee is the RESPONDENT; in a grievance the employee
 * is the COMPLAINANT and there may be a separate respondent who is another
 * employee, a department, or nobody identified. Confidentiality obligations
 * differ, the escalation path differs, and — decisively — the ESS visibility
 * model differs (§28.5): a complainant may follow their own grievance, while no
 * employee may browse a disciplinary case about themselves in the same way.
 * Collapsing them would force one visibility model onto two populations with
 * opposed interests.
 *
 * WHO MAY READ THIS IS NOT ROLE-NAME-DERIVED. §28.17: Organization Admin status
 * alone grants nothing here; grievance access requires an explicit grievance
 * permission. That is enforced in the routes, not implied by a role's name.
 */

/**
 * The respondent may be a person, a unit, or deliberately unspecified — an
 * employee raising a grievance about a policy or a condition is not accusing
 * anybody, and forcing them to name a person would distort the record.
 */
export const grievanceRespondentTypeEnum = pgEnum("grievance_respondent_type", [
  "employee",
  "department",
  "unspecified",
]);

export const grievanceCaseStatusEnum = pgEnum("grievance_case_status", [
  "submitted",
  "acknowledged",
  "under_review",
  "resolved",
  "closed",
  "withdrawn",
]);

export const grievanceCasesTable = pgTable(
  "grievance_cases",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** The employee RAISING the grievance. */
    complainantEmployeeId: integer("complainant_employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    /** Organization-defined category code (§28.18). */
    categoryCode: text("category_code").notNull(),
    respondentType: grievanceRespondentTypeEnum("respondent_type").notNull().default("unspecified"),
    respondentEmployeeId: integer("respondent_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    respondentDepartmentId: integer("respondent_department_id").references(() => departmentsTable.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: grievanceCaseStatusEnum("status").notNull().default("submitted"),
    confidentiality: caseConfidentialityEnum("confidentiality").notNull().default("confidential"),
    /** Whom HR assigned the grievance to. Re-assignable; history lives in the chronology. */
    assignedMembershipId: integer("assigned_membership_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    /**
     * The resolution COMMUNICATED to the complainant (§28.5 makes this one of
     * the few case fields an employee may see). Investigator working notes and
     * internal deliberations live in the chronology, never here.
     */
    resolutionSummary: text("resolution_summary"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
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
    index("grievance_cases_org_complainant_idx").on(table.organizationId, table.complainantEmployeeId),
    /** Supports the grievance-status and ageing read models (§28.23). */
    index("grievance_cases_org_status_idx").on(table.organizationId, table.status, table.submittedAt),
  ],
);

export const insertGrievanceCaseSchema = createInsertSchema(grievanceCasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGrievanceCase = z.infer<typeof insertGrievanceCaseSchema>;
export type GrievanceCase = typeof grievanceCasesTable.$inferSelect;
