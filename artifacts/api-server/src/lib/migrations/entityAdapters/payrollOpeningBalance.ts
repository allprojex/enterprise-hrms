/**
 * WS-7 — Payroll Opening Balances adapter.
 *
 * This replaces an earlier, withdrawn implementation that reused
 * `createCompensationComponent`. That was unsafe for two reasons worth keeping
 * on the record: a compensation component is an OPEN, effective-dated RATE, so
 * an imported balance would have been re-paid every period forever; and
 * creating one supersedes any earlier open row for the same component type, so
 * a balance mapped onto `basic_salary` would have terminated the employee's
 * real salary row. Opening balances are now their own domain
 * (`lib/payrollOpeningBalances.ts`) and this adapter never touches
 * compensation.
 *
 * `transactional: true` — `createPayrollOpeningBalance` takes the QueryClient
 * it is handed and performs exactly one insert through it, with no nested
 * `db.transaction`, so an outer rollback genuinely undoes it. That makes this
 * entity eligible for ATOMIC small-batch execution.
 *
 * Idempotency does NOT rest on staged-row status alone: the database's own
 * UNIQUE(organizationId, employeeId, taxYear) refuses a second authoritative
 * record for the same employee-year, so a replayed migration collides rather
 * than duplicating payroll history.
 */
import {
  createPayrollOpeningBalance,
  getPayrollOpeningBalance,
  isOpeningBalanceLocked,
  DuplicatePayrollOpeningBalanceError,
  InvalidPayrollOpeningBalanceError,
  CrossOrganizationEmployeeError,
  PayrollOpeningBalanceLockedError,
} from "../../payrollOpeningBalances";
import { recordAuditEvent } from "../../auditLog";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, parseDate, parseNumber, toDate } from "../normalizeHelpers";
import { resolveEmployeeRef } from "../referenceResolution";

/** Mirrors the statutory-meaningful measures payroll_run_lines records per period. */
const AMOUNT_FIELDS = [
  { key: "grossEarnings", label: "Gross Earnings YTD", aliases: ["Gross Earnings YTD", "Gross Earnings", "Gross YTD", "Gross"] },
  { key: "taxableIncome", label: "Taxable Income YTD", aliases: ["Taxable Income YTD", "Taxable Income", "Taxable YTD"] },
  { key: "payeAmount", label: "PAYE YTD", aliases: ["PAYE YTD", "PAYE", "Tax YTD", "Income Tax YTD"] },
  { key: "pensionableEarnings", label: "Pensionable Earnings YTD", aliases: ["Pensionable Earnings YTD", "Pensionable Earnings", "Pensionable YTD"] },
  { key: "employeePensionDeduction", label: "Employee Pension YTD", aliases: ["Employee Pension YTD", "Employee Pension", "Employee SSNIT YTD", "SSNIT Employee"] },
  { key: "employerPensionContribution", label: "Employer Pension YTD", aliases: ["Employer Pension YTD", "Employer Pension", "Employer SSNIT YTD", "SSNIT Employer"] },
] as const;

const FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "taxYear", label: "Tax Year", required: true, type: "number", aliases: ["Tax Year", "Payroll Year", "Year"] },
  { key: "cutoverDate", label: "Cutover Date", required: true, type: "date", aliases: ["Cutover Date", "Cutover", "As Of Date"] },
  { key: "currency", label: "Currency", required: true, type: "string", aliases: ["Currency"] },
  ...AMOUNT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: true, type: "number" as const, aliases: f.aliases })),
];

export const payrollOpeningBalanceAdapter: EntityAdapter = {
  entityType: "payroll_opening_balance",
  label: "Payroll Opening Balances",
  dependsOn: ["employee"],
  transactional: true,
  fields: FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const taxYear = parseNumber(raw.taxYear, "taxYear", "Tax Year", true, messages);
    if (taxYear != null && !Number.isInteger(taxYear)) {
      messages.push({ field: "taxYear", message: "Tax Year must be a whole year such as 2026", severity: "error" });
    }
    const cutoverDate = parseDate(raw.cutoverDate, "cutoverDate", "Cutover Date", true, messages);
    const currency = requiredString(raw.currency, "currency", "Currency", messages);

    const data: Record<string, unknown> = { employeeNumber, taxYear, cutoverDate, currency };
    for (const f of AMOUNT_FIELDS) {
      const value = parseNumber(raw[f.key], f.key, f.label, true, messages);
      if (value != null && value < 0) {
        messages.push({ field: f.key, message: `${f.label} cannot be negative`, severity: "error" });
      }
      // Stored as a fixed-scale string — these are money totals, and the
      // numeric column is (14,2); formatting here keeps what is validated
      // identical to what is written.
      data[f.key] = value == null ? null : value.toFixed(2);
    }
    return { data, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];

    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) {
      messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    }

    const taxYear = data.taxYear as number | null;
    const cutoverDate = toDate(data.cutoverDate);
    if (taxYear != null && cutoverDate) {
      if (cutoverDate.getUTCFullYear() !== taxYear) {
        messages.push({ field: "cutoverDate", message: `Cutover Date must fall within tax year ${taxYear}`, severity: "error" });
      }
      if (taxYear > new Date().getUTCFullYear()) {
        messages.push({ field: "taxYear", message: `Tax year ${taxYear} is in the future — opening balances are historical`, severity: "error" });
      }
    }

    // Duplicate/locked pre-check, only possible once the employee really
    // exists live (id is null when satisfied by a staged row in dry_run).
    if (employee.found && employee.id != null && taxYear != null) {
      const existing = await getPayrollOpeningBalance(ctx.organizationId, employee.id, taxYear);
      if (existing) {
        messages.push({
          field: "taxYear",
          message: `An opening balance for ${taxYear} already exists for employee "${data.employeeNumber}"`,
          severity: "error",
        });
      } else if (await isOpeningBalanceLocked(ctx.organizationId, employee.id, taxYear)) {
        messages.push({
          field: "taxYear",
          message: `Payroll for ${taxYear} has already been finalized for employee "${data.employeeNumber}" — an opening balance can no longer be introduced`,
          severity: "error",
        });
      }
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    const taxYear = data.taxYear as number;
    if (await isOpeningBalanceLocked(ctx.organizationId, employee.id, taxYear)) {
      throw new PayrollOpeningBalanceLockedError();
    }

    try {
      const created = await createPayrollOpeningBalance(tx, {
        organizationId: ctx.organizationId,
        employeeId: employee.id,
        taxYear,
        cutoverDate: toDate(data.cutoverDate)!,
        currency: data.currency as string,
        grossEarnings: data.grossEarnings as string,
        taxableIncome: data.taxableIncome as string,
        payeAmount: data.payeAmount as string,
        pensionableEarnings: data.pensionableEarnings as string,
        employeePensionDeduction: data.employeePensionDeduction as string,
        employerPensionContribution: data.employerPensionContribution as string,
        sourceReferenceType: "migration_batch",
        sourceReferenceId: ctx.batchId,
        actorMembershipId: ctx.actorMembershipId,
      });

      // Payroll-category audit. Scalar summary only — never the source row's
      // own contents, and never the spreadsheet behind it.
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorApplicationUserId: ctx.actorApplicationUserId,
        actorMembershipId: ctx.actorMembershipId,
        eventType: "payroll_opening_balance.imported",
        targetType: "payroll_opening_balance",
        targetId: String(created.id),
        afterState: {
          employeeId: created.employeeId,
          taxYear: created.taxYear,
          currency: created.currency,
          migrationBatchId: ctx.batchId,
        },
      });

      return { status: "created", resultId: created.id };
    } catch (err) {
      if (
        err instanceof DuplicatePayrollOpeningBalanceError ||
        err instanceof InvalidPayrollOpeningBalanceError ||
        err instanceof CrossOrganizationEmployeeError
      ) {
        throw new Error(err.message);
      }
      throw err;
    }
  },
};
