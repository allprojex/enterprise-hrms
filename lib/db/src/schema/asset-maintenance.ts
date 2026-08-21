import { pgTable, serial, integer, text, numeric, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { assetsTable } from "./assets";
import { organizationMembershipsTable } from "./organization-memberships";

// Asset Management (Phase 3E, W95): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
// §5/§11, Owner Decision 6. Simple maintenance HISTORY only — no scheduling
// engine, no recurring jobs, no work orders, no vendor table (`providerText`
// is free text, mirroring `asset_maintenance_type`'s own free-text
// precedent, §4), no reminders, no parts inventory, no SLA engine.
// `cost` is the same reference-figure-only treatment as `assets.purchaseCost`
// (Owner Decision 7) — no depreciation, no accounting integration. Whether a
// completed maintenance event returns its own asset to `available` or
// `assigned` is derived server-side from whether an active
// `asset_assignments` row still exists (§7) — a later workstream's (W100)
// service-layer concern, not represented as a schema field here.
export const assetMaintenanceStatusEnum = pgEnum("asset_maintenance_status", ["scheduled", "in_progress", "completed", "cancelled"]);

export const assetMaintenanceTable = pgTable(
  "asset_maintenance",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    maintenanceType: text("maintenance_type").notNull(),
    description: text("description"),
    providerText: text("provider_text"),
    status: assetMaintenanceStatusEnum("status").notNull().default("scheduled"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    notes: text("notes"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("asset_maintenance_org_asset_idx").on(table.organizationId, table.assetId),
    index("asset_maintenance_org_status_idx").on(table.organizationId, table.status),
    index("asset_maintenance_dates_idx").on(table.startedAt, table.completedAt),
  ],
);

export const insertAssetMaintenanceSchema = createInsertSchema(assetMaintenanceTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAssetMaintenance = z.infer<typeof insertAssetMaintenanceSchema>;
export type AssetMaintenance = typeof assetMaintenanceTable.$inferSelect;
