import { pgTable, serial, integer, text, numeric, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { officeInventoryStoresTable } from "./office-inventory-stores";
import { officeInventoryItemsTable } from "./office-inventory-items";
import { officeInventoryStockMovementsTable } from "./office-inventory-stock-movements";

// Office Inventory, Workstream 7 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §7.8, §28, §29, Owner Decision 14). Store-scoped physical count against
// the ledger's own live-derived balance — never a way to silently replace
// system stock with a physical count. `expectedQuantitySnapshot` on each
// line is captured the MOMENT counting starts (not at draft creation) and
// is permanently frozen from then on; later movements are reconciled
// against it live at count/finalize time (officeInventoryStocktakes.ts's
// own concern), never by rewriting the snapshot itself. `draft` exists as
// its own distinct status from `counting` specifically so a stocktake can
// be created (store chosen) before the snapshot-defining instant arrives —
// a disclosed interpretation of why the frozen schema names two separate
// pre-finalized statuses rather than one.
export const officeInventoryStocktakeStatusEnum = pgEnum("office_inventory_stocktake_status", ["draft", "counting", "finalized"]);
export const officeInventoryStocktakeResolutionTypeEnum = pgEnum("office_inventory_stocktake_resolution_type", ["recount", "adjustment", "missing"]);

export const officeInventoryStocktakesTable = pgTable(
  "office_inventory_stocktakes",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    storeId: integer("store_id")
      .notNull()
      .references(() => officeInventoryStoresTable.id, { onDelete: "restrict" }),
    stocktakeReference: text("stocktake_reference").notNull(),
    status: officeInventoryStocktakeStatusEnum("status").notNull().default("draft"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    startedByMembershipId: integer("started_by_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedByMembershipId: integer("finalized_by_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("office_inventory_stocktakes_org_reference_unique").on(table.organizationId, table.stocktakeReference),
    index("office_inventory_stocktakes_org_store_status_idx").on(table.organizationId, table.storeId, table.status),
  ],
);

export const insertOfficeInventoryStocktakeSchema = createInsertSchema(officeInventoryStocktakesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOfficeInventoryStocktake = z.infer<typeof insertOfficeInventoryStocktakeSchema>;
export type OfficeInventoryStocktake = typeof officeInventoryStocktakesTable.$inferSelect;

// office_inventory_stocktake_lines — one row per item in scope, created
// atomically with the snapshot at start-counting time (never at draft
// creation, since the snapshot value doesn't exist yet). `variance` is a
// computed-and-cached value (mirroring `quantityIssuedSoFar`'s own
// established precedent), recalculated by application code at every count
// submission and again, fresh, immediately before a finalization
// eligibility check — never a stored value trusted blindly. `resolutionType`
// is cleared back to null if a later movement reopens a previously-zero
// variance, so `finalizeStocktake` can never see a stale "resolved" flag
// covering for a genuinely new discrepancy.
export const officeInventoryStocktakeLinesTable = pgTable(
  "office_inventory_stocktake_lines",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    stocktakeId: integer("stocktake_id")
      .notNull()
      .references(() => officeInventoryStocktakesTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => officeInventoryItemsTable.id, { onDelete: "restrict" }),
    expectedQuantitySnapshot: numeric("expected_quantity_snapshot", { precision: 12, scale: 2 }).notNull(),
    countedQuantity: numeric("counted_quantity", { precision: 12, scale: 2 }),
    countedByMembershipId: integer("counted_by_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    variance: numeric("variance", { precision: 12, scale: 2 }),
    resolutionType: officeInventoryStocktakeResolutionTypeEnum("resolution_type"),
    resolutionMovementId: integer("resolution_movement_id").references(() => officeInventoryStockMovementsTable.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("office_inventory_stocktake_lines_stocktake_item_unique").on(table.stocktakeId, table.itemId),
    index("office_inventory_stocktake_lines_org_item_idx").on(table.organizationId, table.itemId),
  ],
);

export const insertOfficeInventoryStocktakeLineSchema = createInsertSchema(officeInventoryStocktakeLinesTable).omit({
  id: true,
});

export type InsertOfficeInventoryStocktakeLine = z.infer<typeof insertOfficeInventoryStocktakeLineSchema>;
export type OfficeInventoryStocktakeLine = typeof officeInventoryStocktakeLinesTable.$inferSelect;
