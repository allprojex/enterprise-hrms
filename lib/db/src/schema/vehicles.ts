import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { branchesTable } from "./branches";
import { assetsTable } from "./assets";

// VR-01 — Vehicle Foundation. The register of organizational vehicles: one row
// per physical vehicle, identified by the registration ("car") number the
// organization already uses on paper.
//
// WHY ITS OWN TABLE, NOT `assets` (VR discovery, 2026-09-19):
//   * `assets.asset_tag` is always server-generated `AST-n`, so a car number
//     could only masquerade as `serial_number`;
//   * `assets` has no employee column, and `asset_assignments` enforces at most
//     ONE CURRENTLY OPEN custody row per asset — a default driver would hold
//     that row permanently and block every future booking;
//   * asset custody is open-ended possession, not a time-boxed reservation,
//     and carries no requester/purpose/approval vocabulary.
// Office Inventory is a quantity ledger over item TYPES and explicitly refuses
// individually-tracked durable items, so it is not a candidate either.
//
// `assetId` is an OPTIONAL link for organizations that also carry the vehicle
// in the capital-asset register. It is never required, never the source of
// vehicle identity, and never a custody record: linking a vehicle to an asset
// creates no `asset_assignments` row and does not make vehicle availability
// depend on asset assignment state. A partial unique index keeps the link
// one-to-one per organization without forcing every vehicle to have one.
//
// `status` is the register's own ADMINISTRATIVE availability state, and VR-01
// defines exactly three values. There is deliberately no `in_use`: whether a
// vehicle is physically out is DERIVED from the VR-02 request/movement record
// (a released request), never stored here. Storing it would create a second
// source of truth that the register could drift away from — the same reason
// Office Inventory derives quantity from its stock-movement ledger instead of
// carrying a `currentQuantity` column.
export const vehicleStatusEnum = pgEnum("vehicle_status", ["available", "maintenance", "inactive"]);

export const vehiclesTable = pgTable(
  "vehicles",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** The organization's own car/registration number. Unique per organization, client-supplied, normalized upper-case. */
    registrationNumber: text("registration_number").notNull(),
    make: text("make"),
    model: text("model"),
    description: text("description"),
    /**
     * Optional default driver. A LIVE reference (the §14 precedent
     * `assets.branchId` follows): the register shows who normally drives this
     * vehicle today, and history is never rewritten by a later change because
     * every movement record snapshots its own driver.
     */
    defaultDriverEmployeeId: integer("default_driver_employee_id").references(() => employeesTable.id, {
      onDelete: "set null",
    }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    /**
     * Optional link to the capital-asset register. `set null`, never cascade:
     * removing an asset row must never destroy the vehicle or the movement
     * history that will reference it from VR-02 onward.
     */
    assetId: integer("asset_id").references(() => assetsTable.id, { onDelete: "set null" }),
    status: vehicleStatusEnum("status").notNull().default("available"),
    notes: text("notes"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    updatedByMembershipId: integer("updated_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vehicles_org_registration_unique").on(table.organizationId, table.registrationNumber),
    // One asset links to at most one vehicle per organization. Partial, so any
    // number of vehicles may carry no asset link at all — the `assets` partial
    // unique on `serialNumber` is the precedent for this shape.
    uniqueIndex("vehicles_org_asset_unique")
      .on(table.organizationId, table.assetId)
      .where(sql`${table.assetId} is not null`),
    index("vehicles_org_status_idx").on(table.organizationId, table.status),
    index("vehicles_org_branch_idx").on(table.organizationId, table.branchId),
  ],
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
