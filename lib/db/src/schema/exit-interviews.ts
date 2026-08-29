import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";
import { employeeExitProcessesTable } from "./employee-exit-processes";

/**
 * WS-12 — Exit interviews (§28.15).
 *
 * §28.27 ITEM 4 RESOLVED — A NEW WS-8 SCOPE, NOT THE EXISTING `employee` SCOPE.
 * The questionnaire itself is built and answered through WS-8 Custom Fields, so
 * no second questionnaire engine exists (§28.19); this table holds only what a
 * form cannot: when the interview happened, who conducted it, and the
 * confidential HR note that is not a questionnaire answer. Responses bind to the
 * `exit_interview` scope with THIS row's id as the entity, because §28.15
 * requires them tied to the correct separation cycle. Binding them to the
 * `employee` scope would tie them to the person instead, and an employee who
 * leaves, returns and leaves again would have their second interview silently
 * overwrite their first — the exact history loss `employee_exit_processes`'
 * per-cycle keying was designed to prevent.
 *
 * NO REHIRE ELIGIBILITY. §28.15 withholds it explicitly, and no `rehireEligible`,
 * `doNotRehire`, `rehireStatus`, `rehireRecommendation` or equivalent inferred
 * flag appears here or anywhere else in WS-12. It is deferred until a separate
 * Owner Decision settles who may set it, permitted values, whether a reason is
 * mandatory, who may view it, whether the employee may view it, whether it
 * expires, whether it may be changed, and the audit required for changes.
 * `reasonForLeavingCode` below is NOT that flag: it records why the person says
 * they are leaving, which is analysis, not a judgement about their return.
 */

export const exitInterviewStatusEnum = pgEnum("exit_interview_status", ["scheduled", "completed", "cancelled"]);

export const exitInterviewsTable = pgTable(
  "exit_interviews",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    exitProcessId: integer("exit_process_id")
      .notNull()
      .references(() => employeeExitProcessesTable.id, { onDelete: "cascade" }),
    status: exitInterviewStatusEnum("status").notNull().default("scheduled"),
    interviewDate: timestamp("interview_date", { withTimezone: true }),
    interviewerMembershipId: integer("interviewer_membership_id"),
    /** Organization-defined code (§28.18). Never a hard-coded taxonomy. */
    reasonForLeavingCode: text("reason_for_leaving_code"),
    /**
     * Confidential HR notes. Never surfaced to the departing employee and never
     * included in any ESS response DTO.
     */
    confidentialNotes: text("confidential_notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** One interview per offboarding cycle. A second departure gets its own. */
    uniqueIndex("exit_interviews_exit_process_unique").on(table.exitProcessId),
  ],
);

export const insertExitInterviewSchema = createInsertSchema(exitInterviewsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertExitInterview = z.infer<typeof insertExitInterviewSchema>;
export type ExitInterview = typeof exitInterviewsTable.$inferSelect;
