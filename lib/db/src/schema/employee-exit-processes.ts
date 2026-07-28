import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
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
    separationDate: timestamp("separation_date", { withTimezone: true }).notNull(),
    checklistCompleted: boolean("checklist_completed").notNull().default(false),
    clearanceCompleted: boolean("clearance_completed").notNull().default(false),
    exitInterviewCompleted: boolean("exit_interview_completed").notNull().default(false),
    exitInterviewNotes: text("exit_interview_notes"),
    initiatedBy: integer("initiated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("employee_exit_processes_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeExitProcessSchema = createInsertSchema(employeeExitProcessesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeExitProcess = z.infer<typeof insertEmployeeExitProcessSchema>;
export type EmployeeExitProcess = typeof employeeExitProcessesTable.$inferSelect;
