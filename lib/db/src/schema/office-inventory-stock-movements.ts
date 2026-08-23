import { pgTable, serial, integer, text, numeric, pgEnum, timestamp, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { officeInventoryItemsTable } from "./office-inventory-items";
import { officeInventoryStoresTable } from "./office-inventory-stores";

// Office Inventory, Workstream 2 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §7.3, §8). The single authoritative Inventory quantity/custody ledger —
// APPEND-ONLY, never updated or deleted after insert (no application code
// path in this codebase performs an UPDATE or DELETE against this table;
// enforced at the application layer only, consistent with this platform's
// established convention of disclosed app-layer invariants rather than DB
// CHECK constraints — see the negative-stock invariant's own identical
// disclosure in lib/officeInventoryLedger.ts). Current store balance and
// current holder custody are both DERIVED LIVE from this table (SUM of
// signed quantity by movementType direction) — never a persisted mutable
// balance column, never a second authority. `quantity` is always stored
// positive; direction is implied entirely by `movementType`. `holderId` is a
// deliberately disclosed polymorphic reference (employeeId or departmentId
// depending on `holderType`) and therefore carries no real database FK to
// either table. Workstream 2 populates ONLY `movementType: "received"` rows
// (via receiving) — every other movement type in the enum below exists in
// the schema now (so later workstreams need no schema redesign) but is not
// yet producible by any code path in this workstream.
export const officeInventoryMovementTypeEnum = pgEnum("office_inventory_movement_type", [
  "received",
  "issued",
  "returned",
  "transferred_out",
  "transferred_in",
  "adjustment_in",
  "adjustment_out",
  "written_off",
  "missing",
  "recovered",
  "asset_handoff",
]);

export const officeInventoryMovementHolderTypeEnum = pgEnum("office_inventory_movement_holder_type", [
  "employee",
  "department",
]);

// Mirrors assets.condition's own value set (new|good|fair|poor|damaged) as a
// distinct, non-shared Postgres enum type — deliberate, disclosed: Inventory
// reuses Assets' pattern architecturally only, never its literal DB types or
// identity (the same boundary already established for the whole
// Inventory↔Assets relationship in the frozen plan).
export const officeInventoryMovementConditionEnum = pgEnum("office_inventory_movement_condition", [
  "new",
  "good",
  "fair",
  "poor",
  "damaged",
]);

export const officeInventorySourceReferenceTypeEnum = pgEnum("office_inventory_source_reference_type", [
  "request_line",
  "incident",
  "stocktake_line",
  "asset",
]);

export const officeInventoryStockMovementsTable = pgTable(
  "office_inventory_stock_movements",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => officeInventoryItemsTable.id, { onDelete: "restrict" }),
    movementType: officeInventoryMovementTypeEnum("movement_type").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    storeId: integer("store_id").references(() => officeInventoryStoresTable.id, { onDelete: "restrict" }),
    holderType: officeInventoryMovementHolderTypeEnum("holder_type"),
    holderId: integer("holder_id"),
    referenceNumber: text("reference_number"),
    sourceReferenceType: officeInventorySourceReferenceTypeEnum("source_reference_type"),
    sourceReferenceId: integer("source_reference_id"),
    source: text("source"),
    deliveryReference: text("delivery_reference"),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    condition: officeInventoryMovementConditionEnum("condition"),
    reason: text("reason"),
    expectedReturnDate: date("expected_return_date"),
    confirmedByMembershipId: integer("confirmed_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    actorMembershipId: integer("actor_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("office_inventory_stock_movements_idempotency_unique")
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("office_inventory_stock_movements_org_item_store_idx").on(table.organizationId, table.itemId, table.storeId),
    index("office_inventory_stock_movements_org_item_holder_idx").on(
      table.organizationId,
      table.itemId,
      table.holderType,
      table.holderId,
    ),
    index("office_inventory_stock_movements_source_ref_idx").on(
      table.organizationId,
      table.sourceReferenceType,
      table.sourceReferenceId,
    ),
    index("office_inventory_stock_movements_reference_number_idx").on(table.organizationId, table.referenceNumber),
  ],
);

export const insertOfficeInventoryStockMovementSchema = createInsertSchema(officeInventoryStockMovementsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOfficeInventoryStockMovement = z.infer<typeof insertOfficeInventoryStockMovementSchema>;
export type OfficeInventoryStockMovement = typeof officeInventoryStockMovementsTable.$inferSelect;
