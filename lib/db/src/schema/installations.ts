import { pgTable, serial, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// WS-4 (Installation Registry & Break-Glass Access Foundation, Owner Decision
// #29): durable identity for a deployed HRMS runtime/environment. Deliberately
// NOT the same concept as "organization" (a tenant) or "customer" (a
// commercial account) — see installation-organizations.ts for how one
// installation relates to one-or-many organizations. The full fleet-
// management Control Plane UI remains deferred; this table is only the
// identity foundation later workstreams (health, backup, update status) can
// attach to without redesigning installation identity.
export const installationEnvironmentTypeEnum = pgEnum("installation_environment_type", [
  "development",
  "staging",
  "demo",
  "production",
]);

// Coarse hosting topology only, not a provider directory — see
// hostingProvider below for the free-text, non-enumerated provider metadata.
export const installationHostingModelEnum = pgEnum("installation_hosting_model", [
  "shared",
  "dedicated_owner_managed",
  "dedicated_customer_managed",
  "other",
]);

export const installationStatusEnum = pgEnum("installation_status", ["active", "inactive", "decommissioned"]);

export const installationsTable = pgTable(
  "installations",
  {
    id: serial("id").primaryKey(),
    // Stable, server-generated at creation, never regenerated on restart —
    // this is how a deployed application identifies which installation
    // record it corresponds to (see docs/INSTALLATION_AND_BREAK_GLASS.md,
    // "Installation Self-Identity"). An identifier, not a secret: knowing it
    // grants no authority by itself.
    installationKey: text("installation_key").notNull().unique(),
    name: text("name").notNull(),
    environmentType: installationEnvironmentTypeEnum("environment_type").notNull(),
    hostingModel: installationHostingModelEnum("hosting_model").notNull(),
    // Descriptive/configurable metadata, not a hardcoded enum — organizations
    // may host on arbitrary providers.
    hostingProvider: text("hosting_provider"),
    primaryDomain: text("primary_domain"),
    // Version identity (§11): what exact software this installation is
    // running. Deliberately never derived from a mutable branch name — a
    // release identifier, commit SHA, and migration ledger position instead.
    applicationVersion: text("application_version"),
    gitCommit: text("git_commit"),
    migrationVersion: text("migration_version"),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    healthUrl: text("health_url"),
    // Free-text reference to an org-type-specific extension bundle/profile,
    // if any — reserved for a future workstream, not built out here.
    extensionProfile: text("extension_profile"),
    status: installationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const insertInstallationSchema = createInsertSchema(installationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInstallation = z.infer<typeof insertInstallationSchema>;
export type Installation = typeof installationsTable.$inferSelect;
