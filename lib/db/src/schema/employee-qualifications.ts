import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Employee Qualifications (Phase 2A, W24). `qualificationTypeCode` is a
// free-text code from the "qualification_type" Master Data domain (W7,
// organization-overridable) — not validated against the domain's item list,
// same precedent as employeeSkills.skillCode.
export const employeeQualificationsTable = pgTable(
  "employee_qualifications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    qualificationTypeCode: text("qualification_type_code").notNull(),
    institution: text("institution"),
    fieldOfStudy: text("field_of_study"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    grade: text("grade"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("employee_qualifications_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeQualificationSchema = createInsertSchema(employeeQualificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeQualification = z.infer<typeof insertEmployeeQualificationSchema>;
export type EmployeeQualification = typeof employeeQualificationsTable.$inferSelect;
