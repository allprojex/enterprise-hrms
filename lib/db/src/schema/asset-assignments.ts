import { pgTable, serial, integer, text, timestamp, date, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { assetsTable, assetConditionEnum } from "./assets";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Asset Management (Phase 3E, W95): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
// §5/§8/§9/§14. Custody HISTORY, not a mutable `assets.employeeId` pointer —
// every issue/transfer creates a new row; a closed row is never reopened or
// reused (§7's own "assignment lifecycle" — open/closed, never destructively
// mutated back to open). `employeeId` is a LIVE reference (current identity
// for manager-scope resolution, §14); `assetTagSnapshot`/`assetNameSnapshot`/
// `categorySnapshot`/`departmentIdSnapshot`/`positionIdSnapshot` are all
// SNAPSHOTS captured at issue time so a later asset rename or an employee's
// later transfer/promotion never reinterprets a historical custody record.
// `custodyEndedAt` (renamed from the draft's own `returnedAt` during plan
// freeze — a `lost`/`transferred` closure isn't literally a "return") NULL
// means this is the currently-active assignment; the partial unique index
// below guarantees at most one such row per asset at the database level
// (§23/§24 — load-bearing for the assign-race protection later workstreams
// depend on). `acknowledgedAt`/`acknowledgementNote` are the Decision-1
// acknowledgement foundation — only ever set once, only while the
// assignment is open, never cleared by return; the route enforcing that
// (§9) is W97's job, not W95's.
export const assetAssignmentEndReasonEnum = pgEnum("asset_assignment_end_reason", ["returned", "lost", "transferred", "retired"]);

export const assetAssignmentsTable = pgTable(
  "asset_assignments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    assetTagSnapshot: text("asset_tag_snapshot").notNull(),
    assetNameSnapshot: text("asset_name_snapshot").notNull(),
    categorySnapshot: text("category_snapshot").notNull(),
    departmentIdSnapshot: integer("department_id_snapshot"),
    positionIdSnapshot: integer("position_id_snapshot"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    issuedByMembershipId: integer("issued_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    expectedReturnDate: date("expected_return_date"),
    issueCondition: assetConditionEnum("issue_condition").notNull(),
    issueNotes: text("issue_notes"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgementNote: text("acknowledgement_note"),
    custodyEndedAt: timestamp("custody_ended_at", { withTimezone: true }),
    endReason: assetAssignmentEndReasonEnum("end_reason"),
    receivedByMembershipId: integer("received_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    returnCondition: assetConditionEnum("return_condition"),
    returnNotes: text("return_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Load-bearing (§23/§24): at most one open (active) assignment per
    // asset, enforced at the database level, not merely by application
    // logic — the two-admins-assign-the-same-available-asset race and the
    // duplicate-active-assignment integrity rule both depend on this.
    uniqueIndex("asset_assignments_one_active_per_asset")
      .on(table.assetId)
      .where(sql`${table.custodyEndedAt} is null`),
    index("asset_assignments_org_asset_idx").on(table.organizationId, table.assetId),
    index("asset_assignments_org_employee_idx").on(table.organizationId, table.employeeId),
    index("asset_assignments_expected_return_idx").on(table.organizationId, table.expectedReturnDate),
  ],
);

export const insertAssetAssignmentSchema = createInsertSchema(assetAssignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAssetAssignment = z.infer<typeof insertAssetAssignmentSchema>;
export type AssetAssignment = typeof assetAssignmentsTable.$inferSelect;
