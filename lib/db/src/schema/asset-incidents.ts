import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { assetsTable } from "./assets";
import { assetAssignmentsTable } from "./asset-assignments";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Asset Management (Phase 3E, W95): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
// §5, Owner Decision 2 — the one table added beyond the original 3-4 table
// draft estimate, disclosed explicitly at plan-freeze time. Employee
// loss/damage self-reporting is REPORT-ONLY: this table's own rows never
// mutate `assets.status`/`.condition`/etc. directly — an
// `asset_management.manage` actor reviews a report and, separately, takes
// any authoritative asset-level action through the existing asset routes
// (a later workstream's job). `resolutionNotes` is free text with no hard
// FK to a "resulting action" — deliberately, to avoid drifting into case
// management (§5's own explicit "no case management" instruction).
// `assignmentId` is required (not nullable) because Decision 2 scopes
// self-reporting to "an asset currently assigned to them" — the specific
// custody period the report concerns. `reportedByEmployeeId` is always
// server-derived from caller identity at insert time (a later workstream's
// concern) — the service layer must additionally verify it equals
// `asset_assignments.employeeId` for the referenced `assignmentId`.
export const assetIncidentTypeEnum = pgEnum("asset_incident_type", ["damage", "loss"]);
export const assetIncidentStatusEnum = pgEnum("asset_incident_status", ["open", "reviewed", "dismissed"]);

export const assetIncidentsTable = pgTable(
  "asset_incidents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "restrict" }),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assetAssignmentsTable.id, { onDelete: "restrict" }),
    reportedByEmployeeId: integer("reported_by_employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    incidentType: assetIncidentTypeEnum("incident_type").notNull(),
    description: text("description").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    status: assetIncidentStatusEnum("status").notNull().default("open"),
    reviewedByMembershipId: integer("reviewed_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("asset_incidents_org_asset_idx").on(table.organizationId, table.assetId),
    index("asset_incidents_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertAssetIncidentSchema = createInsertSchema(assetIncidentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAssetIncident = z.infer<typeof insertAssetIncidentSchema>;
export type AssetIncident = typeof assetIncidentsTable.$inferSelect;
