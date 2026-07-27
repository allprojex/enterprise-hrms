import { pgTable, serial, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { modulesTable } from "./modules";

// Per-organization override of a registry module's (modules table, W3)
// enablement. A missing (organizationId, moduleId) row means "not yet
// decided" — effective enablement falls back to the module's
// `defaultEnabled` flag; see listOrganizationModules in
// artifacts/api-server/src/lib/organizationModules.ts. This table only
// records the decision — enforcing it on routes/navigation is W5/W6.
export const organizationModulesTable = pgTable(
  "organization_modules",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    moduleId: integer("module_id")
      .notNull()
      .references(() => modulesTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("organization_modules_org_module_unique").on(table.organizationId, table.moduleId),
    index("organization_modules_org_idx").on(table.organizationId),
  ],
);

export const insertOrganizationModuleSchema = createInsertSchema(organizationModulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationModule = z.infer<typeof insertOrganizationModuleSchema>;
export type OrganizationModule = typeof organizationModulesTable.$inferSelect;
