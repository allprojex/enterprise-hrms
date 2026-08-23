import { pgTable, text, serial, timestamp, integer, pgEnum, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const recordsLocationStatusEnum = pgEnum("records_location_status", ["active", "retired"]);

// Phase 3H, W116 — Physical Filing, Locations & Movement (frozen plan
// Decision 6). A dedicated, self-referencing, organization-owned hierarchy —
// deliberately NOT a Master Data extension (Master Data is strictly flat).
// Every level is optional and organization-defined ("HR Office > Cabinet 2 >
// Drawer 4", or "Records Building > Room 3 > Cabinet B > Shelf 4 > Box 18")
// — no hard-coded level labels/enum, mirroring departments.ts's own
// self-referencing parentDepartmentId precedent exactly.
export const recordsLocationsTable = pgTable(
  "records_locations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    parentId: integer("parent_id").references((): AnyPgColumn => recordsLocationsTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    status: recordsLocationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("records_locations_org_idx").on(table.organizationId),
    index("records_locations_org_parent_idx").on(table.organizationId, table.parentId),
  ],
);

export const insertRecordsLocationSchema = createInsertSchema(recordsLocationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRecordsLocation = z.infer<typeof insertRecordsLocationSchema>;
export type RecordsLocation = typeof recordsLocationsTable.$inferSelect;
