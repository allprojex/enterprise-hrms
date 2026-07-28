import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { usersTable } from "./users";

// Employee Certifications (Phase 2A, W24). `certificationTypeCode` is a
// free-text code from the "certification_type" Master Data domain (W7,
// organization-defined) — not validated against the domain's item list,
// same precedent as employeeSkills.skillCode. Grouped into the same
// workstream as Skills & Qualifications since "certification_type" has no
// other owning workstream in the frozen Phase 2A plan.
export const employeeCertificationsTable = pgTable(
  "employee_certifications",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    certificationTypeCode: text("certification_type_code").notNull(),
    issuingOrganization: text("issuing_organization"),
    issueDate: timestamp("issue_date", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    credentialId: text("credential_id"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("employee_certifications_org_employee_idx").on(table.organizationId, table.employeeId)],
);

export const insertEmployeeCertificationSchema = createInsertSchema(employeeCertificationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployeeCertification = z.infer<typeof insertEmployeeCertificationSchema>;
export type EmployeeCertification = typeof employeeCertificationsTable.$inferSelect;
