import { pgTable, serial, integer, varchar, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// One row per (organization, namespace) — the Organization Configuration
// Engine. Each namespace (general, terminology, ...) is validated against its
// own Zod schema in services/organizationConfig.ts before being written, so
// this stays a *validated* jsonb blob per area rather than one uncontrolled
// blob for the whole organization. schemaVersion records which version of
// that namespace's schema the row was last validated against, so a future
// shape change can migrate existing rows instead of silently reinterpreting
// them. Existing rows predate namespaces entirely; the column default below
// places all of them under "general", preserving their data with no
// migration script needed.
export const organizationSettingsTable = pgTable(
  "organization_settings",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    namespace: varchar("namespace", { length: 64 }).notNull().default("general"),
    schemaVersion: integer("schema_version").notNull().default(1),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("organization_settings_org_namespace_unique").on(table.organizationId, table.namespace)],
);

export const insertOrganizationSettingsSchema = createInsertSchema(organizationSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationSettings = z.infer<typeof insertOrganizationSettingsSchema>;
export type OrganizationSettings = typeof organizationSettingsTable.$inferSelect;
