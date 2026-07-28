import { pgTable, text, serial, timestamp, integer, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";

// Leave Types (Phase 2B, W32): the named category (Annual, Sick, Custom, ...)
// an organization defines. Deliberately independent of Leave Policies
// (leave-policies.ts) — a type is just a label with its own archive
// lifecycle; eligibility/entitlement rules live entirely in the policy.
// Mirrors branches.ts's org-scoped archive/reactivate shape (W13) exactly.
export const leaveTypeStatusEnum = pgEnum("leave_type_status", ["active", "inactive"]);

export const leaveTypesTable = pgTable(
  "leave_types",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: leaveTypeStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("leave_types_org_code_unique").on(table.organizationId, table.code),
    index("leave_types_org_idx").on(table.organizationId),
  ],
);

export const insertLeaveTypeSchema = createInsertSchema(leaveTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLeaveType = z.infer<typeof insertLeaveTypeSchema>;
export type LeaveType = typeof leaveTypesTable.$inferSelect;
