import { pgTable, serial, integer, text, numeric, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { payrollRunsTable } from "./payroll-runs";
import { organizationMembershipsTable } from "./organization-memberships";

// Payroll, Frozen Workstream 8 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.6,
// §13). PAYMENT BATCH PREPARATION only — this table never represents actual
// settlement. "exported" means a generic instruction/export artifact was
// produced for an authorized operator to process externally, never that
// money has moved. No payment-rail/bank-API integration exists anywhere in
// this platform (frozen plan §19's own deferral, extended here).
//
// paymentMethod is a single-value enum in V1 ("bank_transfer") — no
// organization-configurable payment-method setting was frozen in W1's own
// organization payroll policy scope, so none is invented here (§21 of this
// workstream's own prompt).
//
// Exactly one batch per payroll run, for the run's entire lifetime,
// enforced by the unique index below — a deliberate, disclosed V1
// boundary. A correction approved AFTER a batch already exists for its run
// does NOT automatically produce a second batch/supplementary payment; the
// frozen plan's own §11 ("a correction... produces its own explicit payment
// implication... never inferred silently") is read here as: this workstream
// does not invent multi-batch/delta-supplementary-payment logic. A draft
// batch (nothing yet exported) may be deleted to allow a fresh attempt
// (e.g. after fixing a missing bank account) — the unique index is not
// partial, so deleting a draft genuinely frees the run for one new batch;
// once "exported" a batch is permanent, matching every other financial
// lock-invariant already proven in this session.
export const payrollPaymentMethodEnum = pgEnum("payroll_payment_method", ["bank_transfer"]);
export const payrollPaymentBatchStatusEnum = pgEnum("payroll_payment_batch_status", ["draft", "exported"]);

export const payrollPaymentBatchesTable = pgTable(
  "payroll_payment_batches",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    payrollRunId: integer("payroll_run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "restrict" }),
    paymentMethod: payrollPaymentMethodEnum("payment_method").notNull().default("bank_transfer"),
    // Collision-safe: includes organizationId + payrollRunId + a random
    // suffix, additionally enforced by the unique index (never relied on as
    // "probably unique" alone).
    reference: text("reference").notNull(),
    status: payrollPaymentBatchStatusEnum("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    // Sum of included lines' snapshotted amounts (never a live recomputation) —
    // excludes any employee whose effective net pay was negative at batch
    // creation (§15 — excluded from the batch entirely, reported back to the
    // caller, never included as a nonsensical negative payment instruction).
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    employeeCount: integer("employee_count").notNull(),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    exportedByMembershipId: integer("exported_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payroll_payment_batches_run_unique").on(table.payrollRunId),
    uniqueIndex("payroll_payment_batches_reference_unique").on(table.reference),
    index("payroll_payment_batches_org_idx").on(table.organizationId),
  ],
);

export const insertPayrollPaymentBatchSchema = createInsertSchema(payrollPaymentBatchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayrollPaymentBatch = z.infer<typeof insertPayrollPaymentBatchSchema>;
export type PayrollPaymentBatch = typeof payrollPaymentBatchesTable.$inferSelect;
