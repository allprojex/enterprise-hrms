import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { employeesTable } from "./employees";
import { branchesTable } from "./branches";

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
// in the capital-asset register; it is never required and never the source of
// vehicle identity. It is deliberately left out of VR-01 (nothing consumes it
// yet) — the link belongs with whichever workstream first needs it.
//
// `status` is the register's own availability state. `in_use` is NOT settable
// through the register API: only the VR-02 release/return flow may move a
// vehicle into and out of it, exactly as Office Inventory keeps request
// approval and ledger movement in separate transactions.
export const vehicleStatusEnum = pgEnum("vehicle_status", ["available", "in_use", "maintenance", "inactive"]);

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
    index("vehicles_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
