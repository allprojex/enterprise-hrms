import { pgTable, serial, integer, text, pgEnum, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";
import { officeInventoryItemsTable } from "./office-inventory-items";
import { officeInventoryMovementHolderTypeEnum } from "./office-inventory-stock-movements";

// Office Inventory, Workstream 6 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md
// §7.7, §25). Mirrors `asset_incidents` exactly, per the frozen plan's own
// instruction, with one structural difference: Office Inventory custody is
// polymorphic (employee OR department), so `holderType`/`holderId` replace
// Assets' single `assignmentId` FK — a deliberately disclosed, non-real FK
// (employeeId or departmentId depending on `holderType`), identical in kind
// to the ledger's own `holderId` column. Reporting and reviewing an incident
// NEVER itself mutates the stock ledger — a separate, deliberate "mark
// missing" / "recover" / "write off" action (owned by lib/officeInventoryIncidents.ts,
// referencing this row via `sourceReferenceType='incident'`) does. No
// `quantity` field exists here on purpose: the incident is a qualitative
// record ("something is wrong with this holder's custody of this item");
// every quantity-affecting resolution action carries its own quantity,
// validated fresh against the live ledger at the moment it is taken —
// the incident is a traceability anchor, never a second quantity authority.
export const officeInventoryIncidentTypeEnum = pgEnum("office_inventory_incident_type", ["damage", "missing"]);
export const officeInventoryIncidentStatusEnum = pgEnum("office_inventory_incident_status", ["open", "reviewed", "dismissed"]);

export const officeInventoryIncidentsTable = pgTable(
  "office_inventory_incidents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => officeInventoryItemsTable.id, { onDelete: "restrict" }),
    holderType: officeInventoryMovementHolderTypeEnum("holder_type"),
    holderId: integer("holder_id"),
    incidentType: officeInventoryIncidentTypeEnum("incident_type").notNull(),
    description: text("description").notNull(),
    reportedByMembershipId: integer("reported_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    status: officeInventoryIncidentStatusEnum("status").notNull().default("open"),
    reviewedByMembershipId: integer("reviewed_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("office_inventory_incidents_org_item_idx").on(table.organizationId, table.itemId),
    index("office_inventory_incidents_org_status_idx").on(table.organizationId, table.status),
    index("office_inventory_incidents_org_holder_idx").on(table.organizationId, table.holderType, table.holderId),
  ],
);

export const insertOfficeInventoryIncidentSchema = createInsertSchema(officeInventoryIncidentsTable).omit({
  id: true,
  reportedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOfficeInventoryIncident = z.infer<typeof insertOfficeInventoryIncidentSchema>;
export type OfficeInventoryIncident = typeof officeInventoryIncidentsTable.$inferSelect;
