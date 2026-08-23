import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { organizationMembershipsTable } from "./organization-memberships";

// Office Inventory, Workstream 3
// (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §6, §5.3). A Department
// Head's temporary delegation of approval authority to another membership,
// for one department. Half-open `[validFrom, validTo)` interval, mirroring
// `department_heads`' own pattern exactly. Unique per (organization,
// department, delegatingHeadMembershipId) while open — one Head may have at
// most one open delegation at a time (the frozen schema's own constraint;
// note this keys on the DELEGATING HEAD, not the delegate, so the same
// delegate could theoretically hold open delegations from two different
// past/current Heads of the same department, which the application layer
// additionally narrows at approval time per the rule below).
//
// CRITICAL, LOAD-BEARING RULE (§5.3): a delegation row surviving a Head's
// own replacement does NOT mean the delegate can keep approving — at the
// moment of every approval action, the system re-checks whether this row's
// own `delegatingHeadMembershipId` IS CURRENTLY the department's actual
// Head (via department_heads' own live resolver). If a different person is
// now Head, this delegation is functionally inert even though the row
// itself remains open and fully historically queryable — never deleted,
// never rewritten. This is deliberately NOT modeled as a DB constraint
// (there is no FK-enforceable way to say "this row is only valid while X
// happens to also be true of another table") — it is an application-layer
// check, re-derived fresh on every approval, exactly mirroring this
// codebase's other disclosed application-layer invariants (negative-stock,
// append-only).
export const officeInventoryApprovalDelegationsTable = pgTable(
  "office_inventory_approval_delegations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "restrict" }),
    delegatingHeadMembershipId: integer("delegating_head_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    delegateMembershipId: integer("delegate_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("office_inventory_approval_delegations_open_unique")
      .on(table.organizationId, table.departmentId, table.delegatingHeadMembershipId)
      .where(sql`${table.validTo} is null`),
    index("office_inventory_approval_delegations_org_dept_idx").on(table.organizationId, table.departmentId),
    index("office_inventory_approval_delegations_delegate_idx").on(table.delegateMembershipId),
  ],
);

export const insertOfficeInventoryApprovalDelegationSchema = createInsertSchema(officeInventoryApprovalDelegationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertOfficeInventoryApprovalDelegation = z.infer<typeof insertOfficeInventoryApprovalDelegationSchema>;
export type OfficeInventoryApprovalDelegation = typeof officeInventoryApprovalDelegationsTable.$inferSelect;
