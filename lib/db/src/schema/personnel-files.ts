import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Phase 3H, W115 — Personnel File Registry & PIF Linkage (frozen plan §7a).
// A permanent, organization-owned personnel-record identity, strictly 1:1
// with an employee, forever — unlike employee_number_allocations (W114),
// there is no history table here: a PIF number is never released,
// reassigned, or reused (Decision 4), so there is no "previous holder"
// concept to track, only ever the one, permanent holder. Physical filing
// (location/volumes/movement) is deliberately NOT modeled on this table —
// that is W116's own additive migration, not a placeholder column here
// ahead of its own workstream.
export const personnelFilesTable = pgTable(
  "personnel_files",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // Unique alone (not just per-org) — enforces the frozen 1:1 employee
    // relationship at the database level, not merely a service pre-check;
    // two simultaneous "create personnel file" requests for the same
    // employee resolve to exactly one successful row.
    employeeId: integer("employee_id")
      .notNull()
      .unique()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    pifNumber: text("pif_number").notNull(),
    // "generated" (via the numbering engine's own independent pifNumber
    // config) | "manual" (HR-supplied override) — never "reused", matching
    // this table's own permanence guarantee. Free text, not an enum, same
    // convention as employee_number_allocations.allocationMethod.
    allocationMethod: text("allocation_method").notNull(),
    allocatedByMembershipId: integer("allocated_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("personnel_files_org_pif_number_unique").on(table.organizationId, table.pifNumber)],
);

export const insertPersonnelFileSchema = createInsertSchema(personnelFilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPersonnelFile = z.infer<typeof insertPersonnelFileSchema>;
export type PersonnelFile = typeof personnelFilesTable.$inferSelect;
