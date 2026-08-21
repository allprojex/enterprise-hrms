import { pgTable, serial, integer, text, numeric, date, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { branchesTable } from "./branches";
import { usersTable } from "./users";

// Asset Management (Phase 3E, W95 — Foundation & Module Activation):
// docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §5. The organization-owned
// asset register — the sole-authoritative row per company-owned item.
// `categoryCode` is free text from the already-registered "asset_category"
// Master Data domain (§4, Owner Decision 8) — not FK-validated against the
// domain's item list, same precedent as learning_courses.categoryCode.
// `assetTag` is always server-generated (never client-supplied) — schema
// only enforces uniqueness here; generation itself is a later workstream's
// (W96) service-layer concern. `condition` and `status` are deliberately
// separate concepts (§7) — a damaged asset can still be `assigned` or
// `maintenance`; collapsing them would force a false choice between "who
// has it" and "what state it's in". `purchaseCost`/`purchaseCurrency` are
// reference-only fields (Owner Decision 7) — no depreciation, no book
// value, no accounting integration anywhere in this schema or any later
// workstream. `branchId` is a LIVE reference (§14) — the asset's own
// current physical location, not a point-in-time snapshot.
export const assetConditionEnum = pgEnum("asset_condition", ["new", "good", "fair", "poor", "damaged"]);
export const assetStatusEnum = pgEnum("asset_status", ["available", "assigned", "maintenance", "lost", "retired"]);

export const assetsTable = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    assetTag: text("asset_tag").notNull(),
    categoryCode: text("category_code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    serialNumber: text("serial_number"),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    purchaseDate: date("purchase_date"),
    purchaseCost: numeric("purchase_cost", { precision: 12, scale: 2 }),
    purchaseCurrency: text("purchase_currency"),
    warrantyExpiryDate: date("warranty_expiry_date"),
    condition: assetConditionEnum("condition").notNull().default("good"),
    status: assetStatusEnum("status").notNull().default("available"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("assets_org_tag_unique").on(table.organizationId, table.assetTag),
    uniqueIndex("assets_org_serial_unique")
      .on(table.organizationId, table.serialNumber)
      .where(sql`${table.serialNumber} is not null`),
    index("assets_org_status_idx").on(table.organizationId, table.status),
    index("assets_org_category_idx").on(table.organizationId, table.categoryCode),
    index("assets_org_branch_idx").on(table.organizationId, table.branchId),
  ],
);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
