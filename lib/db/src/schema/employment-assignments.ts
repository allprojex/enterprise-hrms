import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { positionsTable } from "./positions";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";

/**
 * WS-11 — Temporary employment assignments: acting appointments and secondments
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §27.12–27.14, OD #2/#6).
 *
 * THE RULE THIS TABLE EXISTS TO ENFORCE (§27.12): a temporary assignment must
 * NEVER overwrite the employee's substantive `positionId`. Writing an acting
 * duty into that column would silently convert a temporary responsibility into
 * an apparent permanent promotion and destroy substantive history — the single
 * most damaging misreading available in this workstream. The substantive
 * position stays exactly where it is; this table records the temporary fact
 * beside it.
 *
 * Equally: `acting` and `seconded` are NOT `employmentStatus` values and must
 * never become any. That enum answers *whether and how someone is employed*;
 * these rows answer *where they are currently working*. Conflating the two
 * would corrupt every existing consumer of employment status.
 *
 * §27.22 ITEM 2 RESOLVED — ONE TABLE WITH A DISCRIMINATOR, NOT TWO.
 * Acting and secondment differ in only a few payload columns (a position FK
 * versus a descriptive destination), but their LIFECYCLE is identical: start,
 * expected end, actual end, overlap rules, point-in-time resolution, history
 * and reminders. Two tables would duplicate that machinery — one service, one
 * resolver, one set of constraints — twice over for a handful of columns.
 * §27.14's "four distinct concepts must not collapse" is about semantics, and
 * the discriminator plus per-type validation keeps them semantically distinct
 * while the shared lifecycle stays in one place.
 *
 * The effective-dated shape follows `department_heads`, which §6 of the review
 * calls the strongest pattern in the audit: an open row is one whose
 * `actualEndDate` is null, and a partial unique index guarantees at most one
 * open row **per assignment type**. That deliberately permits an employee to be
 * acting and seconded at the same time — a legitimate organizational
 * arrangement the frozen scope does not forbid — while preventing two
 * concurrent acting appointments or two concurrent secondments.
 */

export const employmentAssignmentTypeEnum = pgEnum("employment_assignment_type", ["acting", "secondment"]);

/** Only meaningful for a secondment; null for an acting appointment. */
export const secondmentDestinationTypeEnum = pgEnum("secondment_destination_type", ["internal", "external"]);

export const employmentAssignmentsTable = pgTable(
  "employment_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    assignmentType: employmentAssignmentTypeEnum("assignment_type").notNull(),

    /**
     * ACTING ONLY — the position being acted in. This is never copied onto
     * `employees.positionId`; the two coexist, and the UI shows them as
     * "Substantive Position" and "Acting As" (§27.12).
     */
    actingPositionId: integer("acting_position_id").references(() => positionsTable.id, { onDelete: "restrict" }),
    actingDepartmentId: integer("acting_department_id").references(() => departmentsTable.id, { onDelete: "set null" }),

    /**
     * SECONDMENT ONLY — a descriptive destination. V1 is deliberately
     * descriptive: cross-organization secondment inside the platform is out of
     * scope (§27.13), because moving a person between tenants would cross the
     * isolation boundary every other part of this platform enforces. There is
     * therefore no destination organization FK here, by design.
     */
    destinationDescription: text("destination_description"),
    destinationType: secondmentDestinationTypeEnum("destination_type"),

    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    expectedEndDate: timestamp("expected_end_date", { withTimezone: true }),
    /** Null while the assignment is open. Set only by an authorized end action. */
    actualEndDate: timestamp("actual_end_date", { withTimezone: true }),
    reason: text("reason"),
    endReason: text("end_reason"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    endedBy: integer("ended_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("employment_assignments_open_per_type_unique")
      .on(table.organizationId, table.employeeId, table.assignmentType)
      .where(sql`actual_end_date is null`),
    index("employment_assignments_org_employee_idx").on(table.organizationId, table.employeeId),
    /** Supports "who is currently acting/seconded" and the expected-end sweep. */
    index("employment_assignments_open_idx").on(table.organizationId, table.assignmentType, table.expectedEndDate),
  ],
);

export const insertEmploymentAssignmentSchema = createInsertSchema(employmentAssignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmploymentAssignment = z.infer<typeof insertEmploymentAssignmentSchema>;
export type EmploymentAssignment = typeof employmentAssignmentsTable.$inferSelect;
