import { pgTable, serial, integer, text, varchar, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * WS-7 (§10/§39) — an organization's own saved, reusable column mapping for
 * a given entity type ("Legacy HR Excel 2026", "Payroll System Export",
 * etc.). Deliberately just a name plus the same {sourceHeader:
 * canonicalField} shape `migration_sources.columnMapping` uses — this table
 * is not customer-specific code, it is customer-specific *data*, exactly
 * the boundary the brief draws (§40): "Customer-specific migration mappings
 * belong in configuration/data, not forks of core import logic." No
 * customer or source-system name is ever hard-coded in application code;
 * this table is where that name lives instead, entirely organization-owned.
 */
export const migrationSavedMappingsTable = pgTable(
  "migration_saved_mappings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    name: text("name").notNull(),
    columnMapping: jsonb("column_mapping").notNull(),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("migration_saved_mappings_org_entity_name_unique").on(table.organizationId, table.entityType, table.name)],
);

export const insertMigrationSavedMappingSchema = createInsertSchema(migrationSavedMappingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMigrationSavedMapping = z.infer<typeof insertMigrationSavedMappingSchema>;
export type MigrationSavedMapping = typeof migrationSavedMappingsTable.$inferSelect;
