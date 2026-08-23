import { pgTable, serial, integer, numeric, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { payrollStatutoryRuleVersionsTable } from "./payroll-statutory-rule-versions";

// Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.2). Ordered
// graduated PAYE bands for one payroll_statutory_rule_versions row
// (ruleType = "paye_bands") — never a single percentage. `thresholdAmount`
// nullable represents the open-ended final band (frozen plan's explicit
// requirement). No numeric Ghana figures are seeded by this workstream —
// this table exists to hold them once verified by a later, separately
// authorized step.
export const payeTaxpayerCategoryEnum = pgEnum("payroll_paye_taxpayer_category", ["resident", "non_resident"]);

export const payrollPayeBandsTable = pgTable(
  "payroll_paye_bands",
  {
    id: serial("id").primaryKey(),
    statutoryRuleVersionId: integer("statutory_rule_version_id")
      .notNull()
      .references(() => payrollStatutoryRuleVersionsTable.id, { onDelete: "cascade" }),
    bandOrder: integer("band_order").notNull(),
    taxpayerCategory: payeTaxpayerCategoryEnum("taxpayer_category").notNull().default("resident"),
    // Width of this band, in the statutory currency unit — null only for the
    // final, open-ended band ("exceeding GH¢X").
    thresholdAmount: numeric("threshold_amount", { precision: 14, scale: 2 }),
    ratePercent: numeric("rate_percent", { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex("payroll_paye_bands_version_category_order_unique").on(
      table.statutoryRuleVersionId,
      table.taxpayerCategory,
      table.bandOrder,
    ),
    index("payroll_paye_bands_version_idx").on(table.statutoryRuleVersionId),
  ],
);

export const insertPayrollPayeBandSchema = createInsertSchema(payrollPayeBandsTable).omit({ id: true });
export type InsertPayrollPayeBand = z.infer<typeof insertPayrollPayeBandSchema>;
export type PayrollPayeBand = typeof payrollPayeBandsTable.$inferSelect;
