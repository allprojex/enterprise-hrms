import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Employee Skills (Phase 2A, W24). `skillCode` is a free-text code from the
// "skill" Master Data domain (W7, organization-defined) — not validated
// against the domain's item list, same precedent as
// employeeDocuments.categoryCode/employees.separationReason.
export const employeeSkillsTable = pgTable(
  "employee_skills",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    skillCode: text("skill_code").notNull(),
    proficiencyLevel: text("proficiency_level"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("employee_skills_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeSkillSchema = createInsertSchema(employeeSkillsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeSkill = z.infer<typeof insertEmployeeSkillSchema>;
export type EmployeeSkill = typeof employeeSkillsTable.$inferSelect;
