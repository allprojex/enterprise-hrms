import { pgTable, serial, integer, text, timestamp, pgEnum, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { departmentsTable } from "./departments";
import { organizationMembershipsTable } from "./organization-memberships";

// WS-16 Pass 2B — the shared authority-delegation foundation
// (docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §32.10, §32.11, frozen under
// Owner Decisions #14 and #15).
//
// One bounded thing: a direct authority holder temporarily adding another
// same-tenant ACTIVE membership as a SUBSTITUTE for a supported authority
// scope. It is not a workflow engine, it holds no workflow state, and it
// grants no permission.
//
// DELIBERATELY MODULE-NEUTRAL, AND DELIBERATELY NOT OFFICE INVENTORY'S TABLE
// (§32.20, Owner Decision Q2). `office_inventory_approval_delegations` keeps
// every row and every behaviour it shipped with; nothing is migrated here,
// nothing dual-writes, and this table is not read by Office Inventory. The
// two coexist on purpose — that module's resolver is concurrency-QA'd and
// stays authoritative for itself.
//
// THIS FOUNDATION HAS NO BUSINESS CONSUMER, AND THAT IS INTENTIONAL (§32.21).
// Every module with department-head-shaped authority — Leave, Recruitment,
// WS-13, Onboarding, Payroll — is expressly NOT delegatable, and a consumer
// must not be invented merely to prove the table works. Adoption requires an
// explicit later Owner Decision, per module.
export const delegatableAuthorityTypeEnum = pgEnum("delegatable_authority_type", ["department_head"]);

export const authorityDelegationsTable = pgTable(
  "authority_delegations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    // A SINGLE-MEMBER enum, on purpose (§32.10). An unsupported authority
    // type is not merely rejected at runtime — it is UNREPRESENTABLE. A
    // second type (reporting_manager, permission_holder, specific_membership,
    // stage approver, reviewer, …) requires its own Owner Decision and an
    // additive enum widening; none is authorized.
    authorityType: delegatableAuthorityTypeEnum("authority_type").notNull(),
    // The authority scope. For `department_head` the scope IS a department,
    // so this is a real foreign key rather than a generic untyped
    // `authority_scope_id`: with exactly one supported type, a real database
    // guarantee beats a hypothetical future one (§32.10). A future type adds
    // its own scope column.
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "restrict" }),
    // Must BE the department's current Head at creation, re-checked live at
    // every resolution (§32.17). There is deliberately no
    // `created_by_membership_id`: under holder-only creation (Owner Decision
    // Q3) it could never differ from this column.
    delegatorMembershipId: integer("delegator_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    delegateMembershipId: integer("delegate_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    // Required, unlike the Office Inventory prototype which has no reason at
    // all. A delegation is a grant of authority over other people's work;
    // OD #31 establishes that elevated access carries a stated reason and
    // OD #18 that sensitive actions are auditable (§32.10).
    reason: text("reason").notNull(),
    // Half-open `[validFrom, validTo)`, mirroring `department_heads` and
    // `office_inventory_approval_delegations` exactly. `validFrom` is always
    // now() at creation and `validTo` is written ONLY by revocation or
    // replacement: WS-16 supports neither future-dated nor planned-end
    // delegations (§32.11), because a planned end would put two rows with
    // `valid_to IS NULL` in the table and defeat the partial unique index
    // below. Supporting it properly needs a tstzrange exclusion constraint
    // and btree_gist, which this repository has never used — a registered
    // future decision (§32.25), not an oversight.
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    // Carries information `validTo` does not: WHO ended it. A separate
    // `revoked_at` is omitted because it could never differ from `validTo`.
    revokedByMembershipId: integer("revoked_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // THE CONCURRENCY INVARIANT (§32.11). At most one OPEN delegation per
    // (organization, authority type, scope, delegator). Keyed on the
    // DELEGATOR, exactly as the Office Inventory prototype is — which means
    // one delegate may hold an open-but-inert row from a FORMER head
    // alongside a valid row from the current head, so the resolver must
    // filter on `delegatorMembershipId = <current head>` INSIDE its query
    // rather than after the fact (§32.5). This index is the database
    // backstop; the service additionally serializes with SELECT … FOR UPDATE.
    uniqueIndex("authority_delegations_open_unique")
      .on(table.organizationId, table.authorityType, table.departmentId, table.delegatorMembershipId)
      .where(sql`${table.validTo} is null`),
    index("authority_delegations_org_scope_idx").on(table.organizationId, table.authorityType, table.departmentId),
    index("authority_delegations_delegate_idx").on(table.delegateMembershipId),
    // Integrity that belongs in the database rather than only in a service.
    // Self-delegation is meaningless (a head already holds the authority) and
    // would be a silent no-op grant, so it is rejected structurally as well
    // as in `createDepartmentHeadDelegation`.
    check("authority_delegations_no_self_delegation", sql`${table.delegateMembershipId} <> ${table.delegatorMembershipId}`),
    // A closed interval can never end before it began.
    check("authority_delegations_valid_range", sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`),
    // "Required, non-empty after trim" (§32.10) is a data rule, so the
    // database enforces it too — a whitespace-only reason is not a reason.
    // Deliberately a POSIX class match rather than length(btrim(...)) > 0:
    // btrim() strips spaces ONLY, so a tab- or newline-only reason would slip
    // past that form while the service's JS .trim() rejected it — a backstop
    // that disagrees with the service is worse than none. This asserts the
    // reason contains at least one non-whitespace character, which is exactly
    // what .trim().length > 0 means.
    check("authority_delegations_reason_not_blank", sql`${table.reason} ~ '[^[:space:]]'`),
  ],
);

export const insertAuthorityDelegationSchema = createInsertSchema(authorityDelegationsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuthorityDelegation = z.infer<typeof insertAuthorityDelegationSchema>;
export type AuthorityDelegation = typeof authorityDelegationsTable.$inferSelect;
/** The only authority type WS-16 supports. Widening requires an Owner Decision (§32.25). */
export type DelegatableAuthorityType = (typeof delegatableAuthorityTypeEnum.enumValues)[number];
