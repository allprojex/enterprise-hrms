import { pgTable, text, serial, timestamp, integer, jsonb, pgEnum, uniqueIndex, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { branchesTable } from "./branches";
import { positionsTable } from "./positions";
import { usersTable } from "./users";

export const employmentStatusEnum = pgEnum("employment_status", [
  "active",
  "probation",
  "on_leave",
  "suspended",
  "terminated",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other", "prefer_not_to_say"]);

export const maritalStatusEnum = pgEnum("marital_status", ["single", "married", "divorced", "widowed", "other"]);

export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "temporary",
]);

// An employee record is an HR-record concern, independent of system login.
// It must never imply access on its own — see employee_user_links.
export const employeesTable = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),

    // Identity
    employeeNumber: text("employee_number"),
    profilePictureKey: text("profile_picture_key"),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    gender: genderEnum("gender"),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
    maritalStatus: maritalStatusEnum("marital_status"),
    nationality: text("nationality"),
    nationalId: text("national_id"),
    passportNumber: text("passport_number"),

    // Contact
    personalEmail: text("personal_email"),
    workEmail: text("work_email"),
    phoneNumber: text("phone_number"),
    alternatePhoneNumber: text("alternate_phone_number"),
    // { line1, line2?, city?, state?, postalCode?, country? }
    residentialAddress: jsonb("residential_address"),
    // [{ name, relationship, phone }]
    emergencyContacts: jsonb("emergency_contacts"),

    // Placement
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    positionId: integer("position_id").references(() => positionsTable.id, { onDelete: "set null" }),
    reportingManagerId: integer("reporting_manager_id").references((): AnyPgColumn => employeesTable.id, {
      onDelete: "set null",
    }),

    // Employment
    employmentType: employmentTypeEnum("employment_type"),
    hireDate: timestamp("hire_date", { withTimezone: true }),
    probationEndDate: timestamp("probation_end_date", { withTimezone: true }),
    employmentStatus: employmentStatusEnum("employment_status").notNull().default("active"),
    workLocation: text("work_location"),
    // Set together by separate/rehire (lib/employees.ts) — never edited via
    // the general update path. Cleared on rehire; the prior stint's values
    // live on in audit_events, not on this row (ADR-013: never hard-delete).
    // Dated employment events (transfer/promotion/confirmation) are recorded
    // in employment_periods (Phase 2A, W22) instead, not on this row.
    separationDate: timestamp("separation_date", { withTimezone: true }),
    // Free-text code from the "separation_reason" Master Data domain (W7) —
    // not a hardcoded enum, since that domain is organization-overridable.
    separationReason: text("separation_reason"),

    // Permission-gated free text — see employee.notes.read
    notes: text("notes"),

    // Audit
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("employees_org_employee_number_unique").on(table.organizationId, table.employeeNumber),
    index("employees_org_idx").on(table.organizationId),
    index("employees_org_status_idx").on(table.organizationId, table.employmentStatus),
    index("employees_org_department_idx").on(table.organizationId, table.departmentId),
    index("employees_org_branch_idx").on(table.organizationId, table.branchId),
    index("employees_reporting_manager_idx").on(table.reportingManagerId),
  ],
);

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
