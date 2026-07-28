import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Employee Disciplinary Records (Phase 2A, W28). Append-only, like
// audit_events — a new disciplinary action is always a new row; there is no
// update/delete path, so prior records are never replaced when a later
// action is recorded (history must be preserved). `actionType` is free text
// (no Master Data domain for this exists in the frozen registry, unlike
// document_category/skill/qualification_type/certification_type). Reads are
// gated by a narrower permission than employee.read (Architecture Decision
// 5, same precedent as employee.notes.read); writes reuse employee.write,
// same as notes.
export const employeeDisciplinaryRecordsTable = pgTable(
  "employee_disciplinary_records",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    description: text("description").notNull(),
    actionDate: timestamp("action_date", { withTimezone: true }).notNull(),
    recordedBy: integer("recorded_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("employee_disciplinary_records_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeDisciplinaryRecordSchema = createInsertSchema(employeeDisciplinaryRecordsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployeeDisciplinaryRecord = z.infer<typeof insertEmployeeDisciplinaryRecordSchema>;
export type EmployeeDisciplinaryRecord = typeof employeeDisciplinaryRecordsTable.$inferSelect;
