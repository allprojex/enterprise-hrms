import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { installationsTable } from "./installations";
import { organizationsTable } from "./organizations";

// WS-4 (§8): join table so one installation can host one or many
// organizations (a shared deployment) without embedding a single
// organizationId on installations, which would foreclose that topology.
// Unlink is soft (unlinkedAt), preserving history the same way
// organization_domains and organization_memberships already do elsewhere in
// this codebase, rather than deleting the association outright.
export const installationOrganizationsTable = pgTable(
  "installation_organizations",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
  },
  (table) => [
    // At most one ACTIVE link per (installation, organization) pair — mirrors
    // organization_domains' partial-unique isPrimary pattern, so the same
    // pair can be relinked later without violating a hard unique constraint.
    uniqueIndex("installation_organizations_active_unique")
      .on(table.installationId, table.organizationId)
      .where(sql`${table.unlinkedAt} IS NULL`),
    index("installation_organizations_installation_idx").on(table.installationId),
    index("installation_organizations_organization_idx").on(table.organizationId),
  ],
);

export const insertInstallationOrganizationSchema = createInsertSchema(installationOrganizationsTable).omit({
  id: true,
  linkedAt: true,
});

export type InsertInstallationOrganization = z.infer<typeof insertInstallationOrganizationSchema>;
export type InstallationOrganization = typeof installationOrganizationsTable.$inferSelect;
