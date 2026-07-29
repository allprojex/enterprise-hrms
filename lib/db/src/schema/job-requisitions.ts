import { pgTable, text, serial, timestamp, integer, numeric, date, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { branchesTable } from "./branches";
import { positionsTable } from "./positions";
import { employeesTable } from "./employees";
import { employmentTypeEnum } from "./employees";
import { usersTable } from "./users";

// Job Requisitions (Phase 3A, W45): an organization-scoped request/
// authorization to recruit for one or more openings. No approval execution,
// vacancy, candidate, or application logic lives here — this is the
// requisition record itself only (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §3.2/§4.1/§9). The full lifecycle enum is defined now (not extended later
// via ALTER TYPE) since the frozen plan's status model is already fully
// specified — but this workstream only ever writes draft/pending_approval/
// cancelled/closed; approved/rejected/partially_filled/filled are reserved
// for the approval-execution and fulfillment workstreams that come after.
export const jobRequisitionTypeEnum = pgEnum("job_requisition_type", [
  "new_role",
  "replacement",
  "temporary",
  "internship",
  "volunteer",
  "contract",
  "ministry",
]);

export const jobRequisitionWorkplaceTypeEnum = pgEnum("job_requisition_workplace_type", [
  "onsite",
  "remote",
  "hybrid",
]);

export const jobRequisitionStatusEnum = pgEnum("job_requisition_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "partially_filled",
  "filled",
  "cancelled",
  "closed",
]);

export const jobRequisitionsTable = pgTable(
  "job_requisitions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    requisitionType: jobRequisitionTypeEnum("requisition_type").notNull(),
    positionId: integer("position_id").references(() => positionsTable.id, { onDelete: "set null" }),
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    hiringManagerEmployeeId: integer("hiring_manager_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    recruiterEmployeeId: integer("recruiter_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    // "Requested by" — the creator is the requester; no separate column,
    // same as employees.createdBy already doubling as "who did this."
    requestedHeadcount: integer("requested_headcount").notNull(),
    filledCount: integer("filled_count").notNull().default(0),
    employmentType: employmentTypeEnum("employment_type"),
    workplaceType: jobRequisitionWorkplaceTypeEnum("workplace_type"),
    expectedStartDate: date("expected_start_date"),
    salaryRangeMin: numeric("salary_range_min", { precision: 12, scale: 2 }),
    salaryRangeMax: numeric("salary_range_max", { precision: 12, scale: 2 }),
    salaryCurrency: text("salary_currency"),
    justification: text("justification"),
    // Required only when requisitionType = "replacement" — enforced in the
    // service layer, not a schema constraint (same reasoning leave_policies'
    // amount-sign validation gives for not using a Postgres CHECK that would
    // need to vary by another column's enum value).
    replacementEmployeeId: integer("replacement_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    status: jobRequisitionStatusEnum("status").notNull().default("draft"),
    cancellationReason: text("cancellation_reason"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("job_requisitions_org_idx").on(table.organizationId),
    index("job_requisitions_org_status_idx").on(table.organizationId, table.status),
    index("job_requisitions_recruiter_idx").on(table.recruiterEmployeeId),
    index("job_requisitions_hiring_manager_idx").on(table.hiringManagerEmployeeId),
  ],
);

export const insertJobRequisitionSchema = createInsertSchema(jobRequisitionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertJobRequisition = z.infer<typeof insertJobRequisitionSchema>;
export type JobRequisition = typeof jobRequisitionsTable.$inferSelect;
