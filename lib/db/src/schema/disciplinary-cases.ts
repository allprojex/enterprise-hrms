import { pgTable, serial, integer, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

/**
 * WS-12 — Structured disciplinary cases
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §28.2–28.3, OD #9).
 *
 * THIS TABLE DOES NOT REPLACE `employee_disciplinary_records`. §28.2 froze that
 * legacy table as immutable history: it is append-only by its own design, it is
 * still read through its own `employee.disciplinary.read` permission, and NOT
 * ONE ROW is migrated into this one. A flat legacy row records what somebody
 * actually wrote down; manufacturing a case around it would invent allegations,
 * hearings, findings and outcomes that were never recorded — in the one domain
 * where invented evidence is most damaging. The two surfaces sit side by side.
 *
 * WHY `stage` IS FREE TEXT AND `status` IS AN ENUM. §28.18 makes disciplinary
 * stages organization-configured, because organizations genuinely differ in both
 * the number of stages and what they are called; a database enum would make
 * "verbal warning → written warning → final written warning" the only lawful
 * shape. What is NOT organization-specific is whether a case is still running,
 * so `status` stays a two-value enum. The same split governs `categoryCode` and
 * `outcomeCode`, which follow the free-text organization-defined precedent
 * already used by `assets.categoryCode` and `employees.separationReason`.
 *
 * NOTHING HERE DETERMINES FAULT. Every finding and outcome recorded against a
 * case is a human decision entered by an authorized officer (§28.3). No
 * scheduled job and no AI may write one (§28.20, §28.21).
 */

/**
 * Deliberately two values. Everything else a reader might call "status" —
 * which stage the case sits at, whether an appeal is running, whether a warning
 * is still live — is either organization-configured (`stage`) or derived from
 * the chronology and dates, never a second stored state to fall out of sync.
 */
export const disciplinaryCaseStatusEnum = pgEnum("disciplinary_case_status", ["open", "closed"]);

/**
 * Shared by disciplinary and grievance cases (§28.11). `restricted` is the
 * narrowest tier and is what gates evidence reads onto OD #18's sensitive-read
 * audit path.
 */
export const caseConfidentialityEnum = pgEnum("case_confidentiality", ["normal", "confidential", "restricted"]);

export const disciplinaryCasesTable = pgTable(
  "disciplinary_cases",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** The employee the case is ABOUT — the respondent. Contrast grievance_cases. */
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    /** Organization-defined category code (§28.18). Not FK-validated, same precedent as assets.categoryCode. */
    categoryCode: text("category_code").notNull(),
    /** Organization-defined severity code. Optional: not every organization grades severity. */
    severityCode: text("severity_code"),
    /** Organization-defined stage code (§28.18). The platform never invents a stage ladder. */
    stageCode: text("stage_code"),
    subject: text("subject").notNull(),
    description: text("description"),
    status: disciplinaryCaseStatusEnum("status").notNull().default("open"),
    confidentiality: caseConfidentialityEnum("confidentiality").notNull().default("confidential"),
    /**
     * The outcome, once an authorized human records one. Free text for the same
     * reason as `stageCode`. Null while the case is undecided — never defaulted
     * to anything, because "no outcome yet" and "outcome: none" differ.
     */
    outcomeCode: text("outcome_code"),
    outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
    /**
     * When a warning outcome stops being live, where the organization's policy
     * defines an expiry. Null means the organization records no expiry — NOT
     * that the warning is permanent, a distinction the UI must preserve.
     */
    warningExpiresAt: timestamp("warning_expires_at", { withTimezone: true }),
    /** The HR officer or manager accountable for the case. */
    responsibleMembershipId: integer("responsible_membership_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
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
    index("disciplinary_cases_org_employee_idx").on(table.organizationId, table.employeeId),
    /** Supports the "open cases" and case-ageing read models (§28.23). */
    index("disciplinary_cases_org_status_idx").on(table.organizationId, table.status, table.openedAt),
  ],
);

export const insertDisciplinaryCaseSchema = createInsertSchema(disciplinaryCasesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDisciplinaryCase = z.infer<typeof insertDisciplinaryCaseSchema>;
export type DisciplinaryCase = typeof disciplinaryCasesTable.$inferSelect;
