import { pgTable, serial, integer, text, timestamp, pgEnum, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

export const organizationDomainTypeEnum = pgEnum("organization_domain_type", [
  "platform_subdomain",
  "custom_domain",
]);

export const organizationDomainStatusEnum = pgEnum("organization_domain_status", [
  "pending",
  "active",
  "disabled",
]);

// Tenant hostname resolution (Multi-Organization Tenant Infrastructure).
// Identifies which organization a hostname belongs to — nothing more.
// Resolving a hostname to an organizationId here never itself grants
// authorization; every authenticated request still independently verifies
// a live organization_memberships row the same way it always has (see
// resolveTenantHost middleware and requireMembership).
export const organizationDomainsTable = pgTable(
  "organization_domains",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    // Always normalized (trimmed, lowercased, no protocol/port/path) before
    // insert — see normalizeHostname in organizationDomains.ts. Globally
    // unique: a hostname can only ever resolve to one organization.
    hostname: text("hostname").notNull(),
    domainType: organizationDomainTypeEnum("domain_type").notNull(),
    status: organizationDomainStatusEnum("status").notNull().default("pending"),
    // At most one primary domain per organization — enforced by the partial
    // unique index below, not just application logic.
    isPrimary: boolean("is_primary").notNull().default(false),
    // Custom-domain DNS-ownership challenge value. Null for platform
    // subdomains, which the platform itself controls and never needs to
    // verify. No automated DNS check exists yet — activation today is a
    // manual platform-admin action; this column just reserves the field.
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("organization_domains_hostname_unique").on(table.hostname),
    index("organization_domains_org_idx").on(table.organizationId),
    uniqueIndex("organization_domains_org_primary_unique")
      .on(table.organizationId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

export const insertOrganizationDomainSchema = createInsertSchema(organizationDomainsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganizationDomain = z.infer<typeof insertOrganizationDomainSchema>;
export type OrganizationDomain = typeof organizationDomainsTable.$inferSelect;
