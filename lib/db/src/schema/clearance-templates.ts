import { pgTable, serial, integer, text, pgEnum, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { usersTable } from "./users";

/**
 * WS-12 — Clearance templates and their items (§28.8).
 *
 * ORGANIZATIONS DEFINE THEIR OWN CLEARANCE. No universal checklist is hard-coded
 * anywhere in this platform: a church, a hospital and a manufacturer do not clear
 * a departing person through the same desks, and §28.8 forbids pretending they do.
 *
 * TEMPLATE → INSTANCE, COPIED AT INITIATION. `clearance_items` snapshots these
 * rows when an offboarding starts; it does not join to them. This is the WS-10
 * precedent (§26) applied again: publishing a revised template must never rewrite
 * a clearance already running against somebody's departure. That is why
 * `clearance_items` carries its own `label`, `itemType` and `required` rather
 * than reading them back through `sourceTemplateItemId`, which exists only as
 * provenance and is deliberately nullable.
 */

export const clearanceTemplateStatusEnum = pgEnum("clearance_template_status", ["draft", "active", "archived"]);

/**
 * What a clearance item is ABOUT, which is what drives the observe-only
 * integrations in §28.9, §28.10, §28.13 and §28.14. `general` is the ordinary
 * case — a desk that signs off — and carries no integration at all.
 *
 * None of these types gives clearance the power to act on the owning module.
 * `asset_return` reads open custody; it never ends an assignment.
 */
export const clearanceItemTypeEnum = pgEnum("clearance_item_type", [
  "general",
  "asset_return",
  "inventory_return",
  "personnel_file",
  "access_revocation",
  "final_settlement",
  "document_handover",
]);

export const clearanceTemplatesTable = pgTable(
  "clearance_templates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    status: clearanceTemplateStatusEnum("status").notNull().default("draft"),
    /**
     * The template offered by default when an offboarding is initiated. At most
     * one per organization, enforced below by the database rather than by a
     * read-then-write check two concurrent edits could both pass.
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("clearance_templates_default_per_org_unique")
      .on(table.organizationId)
      .where(sql`is_default = true`),
    index("clearance_templates_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const clearanceTemplateItemsTable = pgTable(
  "clearance_template_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => clearanceTemplatesTable.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(0),
    label: text("label").notNull(),
    description: text("description"),
    itemType: clearanceItemTypeEnum("item_type").notNull().default("general"),
    /** Required items gate final clearance; optional ones do not (§28.8). */
    required: boolean("required").notNull().default(true),
    /** The desk accountable for this item. Nullable: some items are HR's own. */
    responsibleDepartmentId: integer("responsible_department_id").references(() => departmentsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("clearance_template_items_template_idx").on(table.organizationId, table.templateId, table.sequence)],
);

export const insertClearanceTemplateSchema = createInsertSchema(clearanceTemplatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClearanceTemplateItemSchema = createInsertSchema(clearanceTemplateItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClearanceTemplate = z.infer<typeof insertClearanceTemplateSchema>;
export type ClearanceTemplate = typeof clearanceTemplatesTable.$inferSelect;
export type InsertClearanceTemplateItem = z.infer<typeof insertClearanceTemplateItemSchema>;
export type ClearanceTemplateItem = typeof clearanceTemplateItemsTable.$inferSelect;
