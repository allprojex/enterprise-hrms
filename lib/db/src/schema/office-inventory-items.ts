import { pgTable, serial, integer, text, numeric, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";

// Office Inventory, Workstream 1 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §7.1). The catalog — one row per distinct organizational item type, never a
// physical unit or a quantity. `itemCode` is always server-generated (never
// client-supplied — Owner Decision 20), permanent, never released or reused —
// the historical anchor for every future ledger movement. Item `name` may be
// edited (a disclosed, cosmetic-only exception, identical in kind to
// Payroll's own employee-name live-resolution disclosure); `itemCode` never
// changes. `categoryCode` is free text from the "office_inventory_category"
// Master Data domain — not FK-validated, the same established precedent as
// `assets.categoryCode`/`learning_courses.categoryCode`. `classification` is
// frozen to exactly two V1 values (Owner Decision 2) — a durable item
// warranting individual tracking belongs in Assets from the start, never a
// third classification here. `unitCost`/`currency` are optional,
// reference-only fields (Owner Decision 3) — no accounting/valuation engine
// of any kind. No `currentQuantity` column exists or will ever exist here —
// quantity is authoritatively derived from `office_inventory_stock_movements`
// (a later workstream), never a mutable field on this table.
export const officeInventoryItemClassificationEnum = pgEnum("office_inventory_item_classification", [
  "consumable",
  "returnable",
]);
export const officeInventoryItemStatusEnum = pgEnum("office_inventory_item_status", ["active", "inactive"]);

export const officeInventoryItemsTable = pgTable(
  "office_inventory_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    itemCode: text("item_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    categoryCode: text("category_code").notNull(),
    unitOfMeasure: text("unit_of_measure").notNull(),
    classification: officeInventoryItemClassificationEnum("classification").notNull(),
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 2 }),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    currency: text("currency"),
    status: officeInventoryItemStatusEnum("status").notNull().default("active"),
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
    uniqueIndex("office_inventory_items_org_code_unique").on(table.organizationId, table.itemCode),
    index("office_inventory_items_org_category_idx").on(table.organizationId, table.categoryCode),
    index("office_inventory_items_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const insertOfficeInventoryItemSchema = createInsertSchema(officeInventoryItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOfficeInventoryItem = z.infer<typeof insertOfficeInventoryItemSchema>;
export type OfficeInventoryItem = typeof officeInventoryItemsTable.$inferSelect;
