import { pgTable, serial, integer, text, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { branchesTable } from "./branches";
import { organizationMembershipsTable } from "./organization-memberships";

// Office Inventory, Workstream 1 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §7.2). Flat — no hierarchy in V1 (Owner Decision 4); a dedicated table
// rather than reusing `branches` directly, since a store needs a
// `responsibleMembershipId` field `branches` deliberately does not carry, and
// rather than reusing Personnel Files' own `records_locations` (a physical-
// file storage hierarchy whose semantics do not cleanly map to a
// stock-holding location with balances). `branchId` is optional — a store may
// sit within a physical branch, or may not. Store `name` may be edited
// (cosmetic); `code` is the stable, permanent per-organization identity a
// later stock-movement ledger row references — never renamed away from an
// existing code, only ever a fresh row if a store is truly replaced.
export const officeInventoryStoreStatusEnum = pgEnum("office_inventory_store_status", ["active", "inactive"]);

export const officeInventoryStoresTable = pgTable(
  "office_inventory_stores",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    responsibleMembershipId: integer("responsible_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    status: officeInventoryStoreStatusEnum("status").notNull().default("active"),
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
    uniqueIndex("office_inventory_stores_org_code_unique").on(table.organizationId, table.code),
    index("office_inventory_stores_org_idx").on(table.organizationId),
    index("office_inventory_stores_branch_idx").on(table.branchId),
  ],
);

export const insertOfficeInventoryStoreSchema = createInsertSchema(officeInventoryStoresTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOfficeInventoryStore = z.infer<typeof insertOfficeInventoryStoreSchema>;
export type OfficeInventoryStore = typeof officeInventoryStoresTable.$inferSelect;
