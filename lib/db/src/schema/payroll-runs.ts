import { pgTable, serial, integer, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollPeriodsTable } from "./payroll-periods";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 3/4 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §10,
// §13). One run per (organization, period) — enforced by the unique index
// below, the exact frozen requirement.
//
// Workstream 4 extends the enum with "approved"/"locked" (Postgres enums
// accept new values added later without disruption to existing rows).
// "calculated" is the only state from which recalculation or one-off-input
// mutation is permitted — once "approved", both are rejected (§B/§G/§O).
// "locked" is the terminal, immutable financial-integrity boundary; a
// locked run is never edited in place — see payroll-corrections.ts for the
// only sanctioned path to adjust a locked run's result.
//
// `approvedByMembershipId`/`lockedAt`, reserved unused by W3, are now
// populated by Workstream 4: approving requires a membership distinct from
// `preparedByMembershipId` (server-side maker-checker, mirroring W1's
// statutory-rule self-approval block exactly), and locking requires the
// same distinct-actor check against the preparer. No `lockedByMembershipId`
// column is added — `lockedAt` plus the audit_events row already created
// for the lock transition is the frozen-plan-sufficient record (§E: "do not
// add schema merely because a field is convenient").
export const payrollRunStatusEnum = pgEnum("payroll_run_status", ["draft", "calculated", "approved", "locked"]);

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
    // Set by Workstream 4's approve action — must differ from preparedByMembershipId.
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
