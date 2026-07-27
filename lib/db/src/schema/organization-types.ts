import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Additive lookup table alongside the existing organizations.type enum column.
// Not yet the source of truth for organization type — this lets new
// institution categories be added later without an ALTER TYPE migration.
// Seeded with the same values as the enum (see seed/seed-organization-types.ts).
export const organizationTypesTable = pgTable("organization_types", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  isSystemType: boolean("is_system_type").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrganizationTypeSchema = createInsertSchema(organizationTypesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOrganizationType = z.infer<typeof insertOrganizationTypeSchema>;
export type OrganizationType = typeof organizationTypesTable.$inferSelect;
