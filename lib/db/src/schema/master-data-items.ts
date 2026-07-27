import { pgTable, serial, integer, varchar, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

// Generic reference-data item, shared by every Master Data domain (gender,
// marital_status, employment_type, ... — see MASTER_DATA_DOMAINS in
// lib/db/src/seed/master-data-definitions.ts for the fixed, code-owned
// classification of each domain). A row with organizationId null is a
// platform-wide system default, visible to every organization; a row with
// organizationId set is that organization's own addition. Whether an
// organization may add rows for a domain at all depends on the domain's
// classification (system-defined domains never get org rows) — enforced in
// artifacts/api-server/src/lib/masterData.ts, not by a DB constraint.
export const masterDataStatusEnum = pgEnum("master_data_status", ["active", "inactive"]);

export const masterDataItemsTable = pgTable(
  "master_data_items",
  {
    id: serial("id").primaryKey(),
    domain: varchar("domain", { length: 64 }).notNull(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    status: masterDataStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("master_data_items_system_unique")
      .on(table.domain, table.code)
      .where(sql`${table.organizationId} is null`),
    uniqueIndex("master_data_items_org_unique")
      .on(table.domain, table.organizationId, table.code)
      .where(sql`${table.organizationId} is not null`),
    index("master_data_items_domain_org_idx").on(table.domain, table.organizationId),
  ],
);

export const insertMasterDataItemSchema = createInsertSchema(masterDataItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMasterDataItem = z.infer<typeof insertMasterDataItemSchema>;
export type MasterDataItem = typeof masterDataItemsTable.$inferSelect;
