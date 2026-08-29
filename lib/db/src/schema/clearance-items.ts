import { pgTable, serial, integer, text, pgEnum, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { employeeDocumentsTable } from "./employee-documents";
import { usersTable } from "./users";
import { employeeExitProcessesTable } from "./employee-exit-processes";
import { clearanceTemplateItemsTable, clearanceItemTypeEnum } from "./clearance-templates";

/**
 * WS-12 — Instantiated clearance items (§28.8).
 *
 * SNAPSHOTTED, NOT JOINED. `label`, `description`, `itemType` and `required` are
 * copied from the template at initiation and then belong to this row. Editing
 * the template afterwards changes nothing here, which is precisely the point:
 * an organization revising its clearance policy must not silently rewrite the
 * obligations somebody is already halfway through discharging.
 * `sourceTemplateItemId` is provenance only, nullable, and `set null` on delete
 * so removing a template item cannot destroy live clearance.
 *
 * COMPLETING AN ITEM DOES NOTHING TO ANOTHER MODULE. §28.9 and §28.10 are
 * absolute: an `asset_return` item marked complete does NOT end an asset
 * assignment, alter custody or change condition, and an `inventory_return` item
 * does NOT move stock. Those transitions belong to Assets and Office Inventory
 * and happen there, by their own services; clearance reads the result. The
 * service layer holds this line and a test proves it.
 *
 * WAIVER IS THE DELIBERATE ESCAPE HATCH, AND IT COSTS A REASON. `waivedReason`
 * is enforced non-empty by the service (§28.8), and the waiver is audited. An
 * organization that cannot recover a laptop must still be able to close the
 * file — but never silently.
 */

/**
 * `returned` means the responsible desk sent it back for more work, not that an
 * asset came back — a naming collision worth stating, since `asset_return` items
 * live in this same table.
 */
export const clearanceItemStatusEnum = pgEnum("clearance_item_status", ["pending", "completed", "returned", "waived"]);

export const clearanceItemsTable = pgTable(
  "clearance_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    exitProcessId: integer("exit_process_id")
      .notNull()
      .references(() => employeeExitProcessesTable.id, { onDelete: "cascade" }),
    /** Provenance only. Never read for behaviour — see this file's header. */
    sourceTemplateItemId: integer("source_template_item_id").references(() => clearanceTemplateItemsTable.id, {
      onDelete: "set null",
    }),
    sequence: integer("sequence").notNull().default(0),
    label: text("label").notNull(),
    description: text("description"),
    itemType: clearanceItemTypeEnum("item_type").notNull().default("general"),
    required: boolean("required").notNull().default(true),
    responsibleDepartmentId: integer("responsible_department_id").references(() => departmentsTable.id, {
      onDelete: "set null",
    }),
    /** The specific person asked to act, where the organization names one. */
    responsibleMembershipId: integer("responsible_membership_id"),
    status: clearanceItemStatusEnum("status").notNull().default("pending"),
    comment: text("comment"),
    /**
     * Evidence lives in WS-5 (§28.11). This is a pointer into the existing
     * document store — WS-12 builds no storage of its own.
     */
    evidenceDocumentId: integer("evidence_document_id").references(() => employeeDocumentsTable.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: integer("completed_by").references(() => usersTable.id, { onDelete: "set null" }),
    returnedReason: text("returned_reason"),
    /** Non-empty whenever status is `waived`. Enforced in the service, always audited. */
    waivedReason: text("waived_reason"),
    waivedAt: timestamp("waived_at", { withTimezone: true }),
    waivedBy: integer("waived_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("clearance_items_exit_process_idx").on(table.organizationId, table.exitProcessId, table.sequence),
    /** Supports the approver queue and the outstanding-clearance read model (§28.23). */
    index("clearance_items_org_status_idx").on(table.organizationId, table.status),
    index("clearance_items_responsible_idx").on(table.organizationId, table.responsibleDepartmentId, table.status),
  ],
);

export const insertClearanceItemSchema = createInsertSchema(clearanceItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertClearanceItem = z.infer<typeof insertClearanceItemSchema>;
export type ClearanceItem = typeof clearanceItemsTable.$inferSelect;
