import { pgTable, serial, integer, text, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Workstream 1 — Statutory-Rule Foundation
// (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.2, §8). Platform-global, not
// organization-scoped — Ghana statutory law does not vary per organization,
// unlike every other config table in this codebase. `ruleType` discriminates
// which child table (payroll_paye_bands / payroll_pension_rates /
// payroll_pension_earnings_ceiling) holds this version's structured values —
// each independently effective-dated per the frozen plan's explicit
// requirement that a ceiling change never forces a new PAYE-band version or
// vice versa.
//
// Lifecycle (frozen plan §8.1): draft -> validated -> approved, then
// "active"/"superseded" are NEVER stored — they are pure functions of
// effectiveFrom/effectiveTo plus whether a later approved version of the
// same ruleType exists, resolved the same way employee_number_allocations'
// own validFrom/validTo pair is resolved (never a separate mutable flag that
// could drift from the dates).
export const payrollStatutoryRuleTypeEnum = pgEnum("payroll_statutory_rule_type", [
  "paye_bands",
  "pension_rates",
  "pension_earnings_ceiling",
]);

export const payrollStatutoryRuleStatusEnum = pgEnum("payroll_statutory_rule_status", [
  "draft",
  "validated",
  "approved",
]);

export const payrollStatutoryRuleVersionsTable = pgTable(
  "payroll_statutory_rule_versions",
  {
    id: serial("id").primaryKey(),
    ruleType: payrollStatutoryRuleTypeEnum("rule_type").notNull(),
    status: payrollStatutoryRuleStatusEnum("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    // Nullable = open-ended (this version applies until a later one
    // supersedes it). Closed automatically the instant a later version of
    // the same ruleType is approved — mirrors releaseEmployeeNumber closing
    // validTo on the old allocation the moment a new one opens.
    effectiveTo: timestamp("effective_to", { withTimezone: true }),

    // Provenance (frozen plan §8.4) — every version must be able to answer
    // who created it, who approved it, and where its values came from.
    createdByMembershipId: integer("created_by_membership_id")
      .notNull()
      .references(() => organizationMembershipsTable.id, { onDelete: "restrict" }),
    approvedByMembershipId: integer("approved_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    sourceUrl: text("source_url"),
    sourceDescription: text("source_description"),
    sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }),
    // Distinguishes "staged from a document fetch" from "signed off by
    // Owner/legal/accounting" (frozen plan §7) — independent of the
    // maker-checker approval step itself, since an approved version could
    // still be awaiting a human sign-off beyond the platform's own
    // second-person check.
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    reasonNote: text("reason_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // At most one currently-open (effectiveTo IS NULL), approved version per
    // ruleType — the database-level guarantee, mirroring
    // employee_number_allocations_org_number_open_unique exactly (minus
    // organization-scoping, since this table has none). Draft/validated
    // versions are deliberately NOT covered — several may coexist while
    // being prepared (e.g. next year's bands drafted while this year's is
    // still open).
    uniqueIndex("payroll_statutory_rule_versions_open_approved_unique")
      .on(table.ruleType)
      .where(sql`${table.status} = 'approved' and ${table.effectiveTo} is null`),
    index("payroll_statutory_rule_versions_rule_type_idx").on(table.ruleType),
    index("payroll_statutory_rule_versions_status_idx").on(table.status),
  ],
);

export const insertPayrollStatutoryRuleVersionSchema = createInsertSchema(payrollStatutoryRuleVersionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollStatutoryRuleVersion = z.infer<typeof insertPayrollStatutoryRuleVersionSchema>;
export type PayrollStatutoryRuleVersion = typeof payrollStatutoryRuleVersionsTable.$inferSelect;
