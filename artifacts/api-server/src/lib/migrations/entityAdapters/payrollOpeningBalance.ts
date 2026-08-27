/**
 * WS-7 (§7 entity list — "Payroll opening balances"; disclosed
 * architectural decision, not a silent assumption) — no dedicated
 * "payroll opening balance" table exists anywhere in this codebase. This
 * adapter imports an opening balance as an ordinary open
 * `employee_compensation_component` row (reusing `createCompensationComponent`
 * from lib/payrollCompensation.ts exactly as the live Payroll UI creates
 * one) — "opening balance" is purely a migration-semantics label WS-7
 * itself applies to this action, not a schema concept the domain layer
 * distinguishes.
 *
 * `componentTypeCode` is validated against the organization's own
 * Master Data (`payroll_earning_component_type` / `payroll_deduction_component_type`,
 * chosen by `category`) via `assertComponentTypeKnown` — never a fixed
 * enum this adapter invents.
 *
 * MATERIAL FINDING, disclosed rather than silently handled:
 * `createCompensationComponent` provides NO idempotency guard equivalent to
 * `postLedgerEntry`'s `sourceReference` — its only uniqueness is a partial
 * "one open component per (employeeId, category, componentTypeCode)" index,
 * which throws `CompensationComponentCollisionError` on a genuine conflict
 * but does NOT protect against a duplicate import re-opening the same
 * component under a different `validFrom`. The only guard against a
 * mistaken double-execution of this row is therefore the orchestration
 * layer's own `migration_staged_rows.executionStatus` (only ever
 * `pending` rows are (re-)executed) — this adapter does not invent a
 * parallel idempotency mechanism the domain doesn't have.
 *
 * Like `postLedgerEntry`, `createCompensationComponent` does not accept a
 * `tx` QueryClient — it opens and commits its own internal transaction,
 * so this row's insert is not part of the same SQL transaction as the
 * staged-row status update that follows it (same boundary as leaveBalance.ts).
 */
import { createCompensationComponent, assertComponentTypeKnown, UnknownComponentTypeError, CompensationComponentCollisionError } from "../../payrollCompensation";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, parseDate, parseNumber, parseEnum } from "../normalizeHelpers";
import { resolveEmployeeRef } from "../referenceResolution";

const CATEGORY_VALUES = ["earning", "deduction"] as const;
const TAXABLE_TREATMENT_VALUES = ["ordinary", "benefit_in_kind", "bonus", "overtime"] as const;

function parseOptionalBoolean(raw: string | undefined, field: string, label: string, messages: NormalizeResult["messages"]): boolean | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  messages.push({ field, message: `${label} must be true/false`, severity: "error" });
  return null;
}

const FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "category", label: "Category", required: true, type: "enum", enumValues: CATEGORY_VALUES, aliases: ["Category"] },
  { key: "componentTypeCode", label: "Component Type", required: true, type: "string", aliases: ["Component Type", "Component Type Code"] },
  { key: "amount", label: "Amount", required: true, type: "number", aliases: ["Amount", "Opening Balance"] },
  { key: "currency", label: "Currency", required: true, type: "string", aliases: ["Currency"] },
  { key: "validFrom", label: "Valid From", required: true, type: "date", aliases: ["Valid From", "Effective Date", "Date"] },
  { key: "recurring", label: "Recurring", required: false, type: "boolean", aliases: ["Recurring"] },
  { key: "pensionable", label: "Pensionable", required: false, type: "boolean", aliases: ["Pensionable"] },
  { key: "taxableTreatment", label: "Taxable Treatment", required: false, type: "enum", enumValues: TAXABLE_TREATMENT_VALUES, aliases: ["Taxable Treatment"] },
];

export const payrollOpeningBalanceAdapter: EntityAdapter = {
  entityType: "payroll_opening_balance",
  label: "Payroll Opening Balances",
  dependsOn: ["employee"],
  fields: FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const category = parseEnum(raw.category, "category", "Category", CATEGORY_VALUES, true, messages);
    const componentTypeCode = requiredString(raw.componentTypeCode, "componentTypeCode", "Component Type", messages);
    const amount = parseNumber(raw.amount, "amount", "Amount", true, messages);
    if (amount != null && amount <= 0) {
      messages.push({ field: "amount", message: "Amount must be greater than zero", severity: "error" });
    }
    const currency = requiredString(raw.currency, "currency", "Currency", messages);
    const validFrom = parseDate(raw.validFrom, "validFrom", "Valid From", true, messages);
    const recurring = parseOptionalBoolean(raw.recurring, "recurring", "Recurring", messages);
    const pensionable = parseOptionalBoolean(raw.pensionable, "pensionable", "Pensionable", messages);
    const taxableTreatment = parseEnum(raw.taxableTreatment, "taxableTreatment", "Taxable Treatment", TAXABLE_TREATMENT_VALUES, false, messages);
    return {
      data: { employeeNumber, category, componentTypeCode, amount, currency, validFrom, recurring, pensionable, taxableTreatment },
      messages,
    };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];

    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) {
      messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    }

    try {
      await assertComponentTypeKnown(ctx.organizationId, data.category as string, data.componentTypeCode as string);
    } catch (err) {
      if (err instanceof UnknownComponentTypeError) {
        messages.push({ field: "componentTypeCode", message: err.message, severity: "error" });
      } else {
        throw err;
      }
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    await assertComponentTypeKnown(ctx.organizationId, data.category as string, data.componentTypeCode as string);

    try {
      const component = await createCompensationComponent({
        organizationId: ctx.organizationId,
        employeeId: employee.id,
        category: data.category as "earning" | "deduction",
        componentTypeCode: data.componentTypeCode as string,
        amount: String(data.amount as number),
        currency: data.currency as string,
        recurring: (data.recurring as boolean | null) ?? true,
        taxableTreatment: (data.taxableTreatment as "ordinary" | "benefit_in_kind" | "bonus" | "overtime" | null) ?? "ordinary",
        pensionable: (data.pensionable as boolean | null) ?? false,
        sourceReferenceType: "migration_batch",
        sourceReferenceId: ctx.batchId,
        validFrom: data.validFrom as Date,
        actorMembershipId: ctx.actorMembershipId,
      });
      return { status: "created", resultId: component.id };
    } catch (err) {
      if (err instanceof CompensationComponentCollisionError || err instanceof UnknownComponentTypeError) throw new Error(err.message);
      throw err;
    }
  },
};
