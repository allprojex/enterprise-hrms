import { pgTable, serial, integer, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollPeriodsTable } from "./payroll-periods";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 3 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §10, §13).
// One run per (organization, period) — enforced by the unique index below,
// the exact frozen requirement. W3 only ever produces "draft"/"calculated";
// "approved"/"locked"/"cancelled" are reserved for Workstream 4 and
// deliberately not added to the enum yet (Postgres enums accept new values
// added later without disruption) — no route in this workstream can move a
// run past "calculated". `approvedByMembershipId`/`lockedAt` columns are
// reserved now (not populated by anything in W3) so W4 can enforce its own
// distinct-actor maker-checker without a later schema change disturbing
// already-calculated data.
export const payrollRunStatusEnum = pgEnum("payroll_run_status", ["draft", "calculated"]);

export const payrollRunsTable = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    payrollPeriodId: integer("payroll_period_id")
      .notNull()
      .references(() => payrollPeriodsTable.id, { onDelete: "restrict" }),
    status: payrollRunStatusEnum("status").notNull().default("draft"),
    preparedByMembershipId: integer("prepared_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    // Reserved for Workstream 4 — never set by any W3 route.
    approvedByMembershipId: integer("approved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payroll_runs_org_period_unique").on(table.organizationId, table.payrollPeriodId),
    index("payroll_runs_org_idx").on(table.organizationId),
  ],
);

export const insertPayrollRunSchema = createInsertSchema(payrollRunsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRun = typeof payrollRunsTable.$inferSelect;
