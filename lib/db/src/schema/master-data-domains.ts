import { pgTable, serial, varchar, pgEnum, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The registry of Master Data domains (gender, marital_status,
// employment_type, ...) and their classification, per
// ARCHITECTURE.md/DECISIONS.md's ADR-010. Mirrors the `modules` table
// (W3): the registry lives in the DB, seeded from
// lib/db/src/seed/master-data-definitions.ts — request-time code (API
// routes) queries this table, never the seed-time code constants directly.
export const masterDataClassificationEnum = pgEnum("master_data_classification", [
  "system-defined",
  "organization-overridable",
  "organization-defined",
]);

export const masterDataDomainsTable = pgTable(
  "master_data_domains",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    classification: masterDataClassificationEnum("classification").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("master_data_domains_key_unique").on(table.key)],
);

export const insertMasterDataDomainSchema = createInsertSchema(masterDataDomainsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMasterDataDomain = z.infer<typeof insertMasterDataDomainSchema>;
export type MasterDataDomain = typeof masterDataDomainsTable.$inferSelect;
