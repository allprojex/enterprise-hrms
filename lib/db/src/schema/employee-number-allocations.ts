import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { employeesTable } from "./employees";
import { organizationMembershipsTable } from "./organization-memberships";

// Phase 3H, W114 — Employee/Staff Number Allocation History (frozen plan
// Decision 1). The authoritative historical source for staff-number
// ownership — append-only, never edited or deleted. `employees.employeeNumber`
// remains only a denormalized *current*-value cache, cleared to NULL on
// release (frozen plan §5 step 5); this table is what every historical
// lookup (frozen plan §6) and every reuse decision must resolve against.
//
// The partial unique index enforces "at most one open allocation per
// (organization, employeeNumber)" at the database level — the single
// mechanism the frozen plan relies on to reject: an already-active number
// being allocated again, two simultaneous allocations of the same released
// number, and a manual-override collision with an existing active
// allocation (frozen plan §5's edge-case list). employeeId uses
// onDelete:"restrict", mirroring employment_periods' own precedent, not
// attendance_events' cascade — employees are never hard-deleted (ADR-013),
// so this history must never have a reason to cascade away.
export const employeeNumberAllocationsTable = pgTable(
  "employee_number_allocations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "restrict" }),
    employeeNumber: text("employee_number").notNull(),
    // "generated" (via the numbering engine) | "manual" (HR-supplied
    // override) | "reused" (a deliberate reallocation of a previously
    // released number) — free text, not an enum, matching this codebase's
    // established convention for a small, workstream-owned vocabulary
    // (employment_periods.eventType, attendance_adjustments.adjustmentType).
    allocationMethod: text("allocation_method").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    allocatedByMembershipId: integer("allocated_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    releasedByMembershipId: integer("released_by_membership_id").references(
      () => organizationMembershipsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("employee_number_allocations_org_number_open_unique")
      .on(table.organizationId, table.employeeNumber)
      .where(sql`${table.validTo} is null`),
    index("employee_number_allocations_org_employee_idx").on(table.organizationId, table.employeeId),
    index("employee_number_allocations_org_number_idx").on(table.organizationId, table.employeeNumber),
  ],
);

export const insertEmployeeNumberAllocationSchema = createInsertSchema(employeeNumberAllocationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployeeNumberAllocation = z.infer<typeof insertEmployeeNumberAllocationSchema>;
export type EmployeeNumberAllocation = typeof employeeNumberAllocationsTable.$inferSelect;
