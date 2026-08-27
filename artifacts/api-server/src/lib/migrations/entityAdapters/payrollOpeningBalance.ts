/**
 * ============================================================================
 * NOT REGISTERED — BLOCKED PENDING OWNER DECISION. DO NOT RE-REGISTER.
 * ============================================================================
 *
 * This adapter is deliberately excluded from `registerShippedEntityAdapters`
 * (lib/migrations/registerEntityAdapters.ts). Because every read/write path
 * validates `entityType` against that registry, `payroll_opening_balance`
 * cannot be uploaded, validated or executed while it stays unregistered.
 *
 * WHY IT WAS BLOCKED
 *
 * WS-7's original implementation reused `createCompensationComponent` on the
 * stated grounds that "no payroll-opening-balance table exists, so an opening
 * balance imports as an ordinary compensation component." Post-completion
 * reconciliation established that this reasoning was WRONG, and that the
 * adapter as written is actively unsafe. Two defects, both confirmed by
 * reading the live Payroll engine, not inferred:
 *
 * 1. AN IMPORTED BALANCE WOULD BE PAID AGAIN EVERY PERIOD, FOREVER.
 *    `createCompensationComponent` always inserts with `validTo` unset, i.e.
 *    an OPEN row. `resolveCompensationAsOf` (payrollCompensation.ts) treats
 *    an open row as `validTo = Infinity` and therefore matches EVERY future
 *    pay date, and `calculateEmployeePayroll` (payrollCalculation.ts) pushes
 *    each resolved component's full `amount` into `grossEarnings` on every
 *    run. A one-time opening balance of X would become a recurring earning
 *    of X per period — taxed and pensioned as ordinary income.
 *
 * 2. IT COULD SILENTLY OVERWRITE A REAL SALARY.
 *    `createCompensationComponent` closes any existing open row for the same
 *    (employeeId, category, componentTypeCode) whose `validFrom` is earlier,
 *    by setting its `validTo`. `componentTypeCode` here is free text mapped
 *    from a spreadsheet column, so mapping an opening balance onto (say)
 *    `basic_salary` would TERMINATE the employee's real salary row and
 *    replace the rate with the balance figure. This directly violates the
 *    "no silent salary overwrite" constraint.
 *
 * THE ACTUAL GAP
 *
 * A compensation component is an effective-dated RATE ("this person is paid
 * X per period from validFrom"), not a BALANCE. The platform models no
 * balance/brought-forward/year-to-date concept anywhere: none of the 15
 * payroll tables carries a cumulative figure, `payroll_run_lines` holds only
 * per-period amounts, and `employee_statutory_identifiers` holds SSNIT/TIN
 * identifiers but no contributed-to-date or PAYE-paid-to-date amounts. A
 * mid-year cutover therefore cannot compute correct graduated PAYE or apply
 * the annual pension ceiling.
 *
 * The frozen Master Owner Review names "Payroll opening balances" as an
 * importable entity but never defines it — there is no schema, no semantics
 * and no Owner Decision behind it anywhere in the frozen documents.
 *
 * SMALLEST PROPOSED ADDITION (requires Owner approval before any code)
 *
 *   - a per-(organizationId, employeeId, taxYear) brought-forward record
 *     holding gross / PAYE / pensionable / pension-contributed to-date
 *     figures, which the calculation engine READS for graduated-tax and
 *     ceiling purposes but NEVER re-pays; and
 *   - an explicit cutover marker on the payroll period model so "the first
 *     period after migration" is representable.
 *
 * Both are new Payroll domain concepts. They are deliberately NOT built here:
 * inventing payroll accounting without Owner sign-off is exactly what this
 * workstream was told not to do.
 *
 * The code below is retained UNCHANGED as the concrete artifact of what was
 * built and why it is unsafe. It must not be registered until the above is
 * resolved.
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
  // Moot while unregistered; recorded for accuracy — createCompensationComponent
  // opens its own transaction, so its writes would escape an outer one.
  transactional: false,
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
