import { pgTable, text, serial, integer, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

// System role templates (organizationId null, isSystemRole true) are the
// fixed, protected catalog (ADR-015). An organization may copy a template
// into its own row (organizationId set, isSystemRole false) and customize
// that copy's permissions — the template itself is never edited. Mirrors
// the master_data_items (W7) system/org split.
export const rolesTable = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    isSystemRole: boolean("is_system_role").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("roles_system_key_unique").on(table.key).where(sql`${table.organizationId} is null`),
    uniqueIndex("roles_org_key_unique").on(table.organizationId, table.key).where(sql`${table.organizationId} is not null`),
  ],
);

export const insertRoleSchema = createInsertSchema(rolesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
