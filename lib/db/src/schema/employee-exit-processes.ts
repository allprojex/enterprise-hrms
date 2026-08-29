import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Exit Management (Phase 2A, W29): the off-boarding *process* attached to an
// existing separation event (W15, ADR-013) — checklist, clearance, and exit
// interview record. Does not modify or duplicate `employees.separationDate`
// (set by `separateEmployee`); `separationDate` here is a snapshot copied at
// creation time, used only to tell which separation cycle a row belongs to
// (an employee can be separated, rehired, and separated again — each cycle
// gets its own exit process row, never overwriting a prior one).
//
// ---------------------------------------------------------------------------
// WS-12 EXTENSION (§28.6-28.8). ADDITIVE. The table is extended, never replaced,
// and its per-separation-cycle identity above is preserved exactly.
//
// `separationDate` BECAME NULLABLE, and that is the whole point of §28.6.
// Until WS-12 an exit process could only be created once `employmentStatus`
// was already `terminated`, so clearance could not start until after the person
// had left — too late to be useful during a notice period. It now records the
// ACTUAL separation instant and stays null while offboarding runs ahead of it.
// The widening is backward compatible: every pre-existing row keeps its value.
//
// `status` DEFAULTS TO `legacy`, WHICH IS NOT A PLACEHOLDER. Rows that predate
// this column describe finished historical departures whose real progress
// nobody recorded structurally. Defaulting them to `initiated` would assert they
// are open, and defaulting them to `completed` would assert they finished —
// both fabrications of the kind §28.2 forbids. `legacy` says only what is true:
// this row predates structured clearance. Every WS-12 service supplies `status`
// explicitly, so the default only ever classifies the backfill.
//
// THE THREE BOOLEANS ARE NOT A SECOND SOURCE OF TRUTH. They remain exactly as
// shipped and are still the only record for `legacy` rows. For a WS-12 row they
// become DERIVED: `clearanceCompleted` is computed from real clearance items and
// is never independently settable through any API (§28.8), the same rule §26
// applied to onboarding completion. One source of truth per row, and which one
// is decided by `status`, not by a guess.
// ---------------------------------------------------------------------------

/**
 * WS-12 (§28.6) — why an offboarding may begin, verified server-side against an
 * authoritative record. This enum is deliberately SHORT, and its shortness is a
 * finding rather than an omission.
 *
 *   already_separated — `employmentStatus = 'terminated'` with a separation
 *                       date. The shipped precondition, preserved.
 *   contract_end      — an active fixed-term `employment_terms` row with an end
 *                       date (WS-11, authoritative).
 *
 * ACCEPTED RESIGNATION, RETIREMENT AND APPROVED TERMINATION ARE ABSENT ON
 * PURPOSE. §28.6 admits only a basis "already supported by the authoritative
 * Employment Lifecycle architecture", and no such record exists in this
 * repository: `employees` carries `employmentStatus`, `separationDate` and a
 * free-text `separationReason`, all of which describe a separation that has
 * ALREADY happened, and nothing anywhere records an approved future one.
 * Minting a row here to stand for "resignation accepted" would be precisely the
 * parallel separation record WS-12 is forbidden to invent — and it would let an
 * offboarding case serve as its own basis, which §28.6 names as the thing this
 * control exists to prevent. Adding those bases needs an authoritative record
 * first, and therefore its own Owner Decision.
 */
export const exitSeparationBasisEnum = pgEnum("exit_separation_basis", ["already_separated", "contract_end"]);

/**
 * `ready_for_separation` is the terminal state of CLEARANCE, not of employment.
 * Reaching it changes nobody's employment status: §28.7 freezes that completing
 * offboarding never terminates anyone, and separation remains an explicit
 * authorized act through WS-11's own service.
 */
export const exitProcessStatusEnum = pgEnum("exit_process_status", [
  "legacy",
  "initiated",
  "clearance_in_progress",
  "ready_for_separation",
  "completed",
  "cancelled",
]);

export const employeeExitProcessesTable = pgTable(
  "employee_exit_processes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    /** The ACTUAL separation instant. Null while offboarding runs ahead of it (§28.6). */
    separationDate: timestamp("separation_date", { withTimezone: true }),
    checklistCompleted: boolean("checklist_completed").notNull().default(false),
    clearanceCompleted: boolean("clearance_completed").notNull().default(false),
    exitInterviewCompleted: boolean("exit_interview_completed").notNull().default(false),
    exitInterviewNotes: text("exit_interview_notes"),
    initiatedBy: integer("initiated_by").references(() => usersTable.id, { onDelete: "set null" }),
    // --- WS-12 additions ---
    status: exitProcessStatusEnum("status").notNull().default("legacy"),
    separationBasis: exitSeparationBasisEnum("separation_basis"),
    /** When the basis was verified against the authoritative record. */
    separationBasisRecordedAt: timestamp("separation_basis_recorded_at", { withTimezone: true }),
    /** Taken from the authoritative basis, never typed in freehand by a client. */
    expectedSeparationDate: timestamp("expected_separation_date", { withTimezone: true }),
    /** Provenance of the clearance snapshot. Null when no template was used. */
    clearanceTemplateId: integer("clearance_template_id"),
    /** Final HR clearance — a distinct terminal act, not the arithmetic of the item list (§28.8). */
    finalClearedAt: timestamp("final_cleared_at", { withTimezone: true }),
    finalClearedBy: integer("final_cleared_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("employee_exit_processes_org_employee_idx").on(table.organizationId, table.employeeId),
    /**
     * At most one RUNNING offboarding per employee, guaranteed by the database
     * rather than by a read-then-write check two concurrent initiations could
     * both pass. Completed, cancelled and legacy rows are excluded, so the full
     * per-cycle history — separated, rehired, separated again — is preserved.
     */
    uniqueIndex("employee_exit_processes_open_per_employee_unique")
      .on(table.organizationId, table.employeeId)
      .where(sql`status in ('initiated', 'clearance_in_progress', 'ready_for_separation')`),
    /** Supports the "employees currently offboarding" read model (§28.23). */
    index("employee_exit_processes_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertEmployeeExitProcessSchema = createInsertSchema(employeeExitProcessesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeExitProcess = z.infer<typeof insertEmployeeExitProcessSchema>;
export type EmployeeExitProcess = typeof employeeExitProcessesTable.$inferSelect;
