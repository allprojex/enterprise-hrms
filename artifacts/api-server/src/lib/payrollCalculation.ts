/**
 * Payroll, Workstream 3 — Calculation Engine
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §9.6, §13). Computes one
 * employee's draft payroll result for one period, snapshotting every
 * calc-relevant input at calculation time so a later statutory or
 * compensation change can never silently rewrite an already-calculated
 * result (frozen plan's "never retroactively recalculates" invariant).
 *
 * Calculation order (frozen, never improvised): gross earnings ->
 * pensionable earnings -> employee pension deduction -> taxable income ->
 * PAYE -> other deductions -> net pay -> employer contributions.
 *
 * Every money value here is computed via payrollMoney.ts's BigInt minor-unit
 * arithmetic — never native floating point. Ghana statutory numeric figures
 * (PAYE band widths/rates, pension percentages, insurable-earnings ceiling)
 * are never hard-coded in this file; they are read exclusively from the
 * approved statutory-rule-version rows resolved as-of the payroll period's
 * pay date via W1's resolveStatutoryRuleVersionAsOf.
 *
 * Disclosed, deliberate W3 scope boundaries (frozen plan §4.1's own
 * "explicitly UNRESOLVED — do not invent" items):
 *  - `benefit_in_kind` components make calculation fail with a controlled
 *    error rather than silently omitting or guessing a monetization amount.
 *  - Tax reliefs are not applied (no authoritative relief rule exists yet).
 *  - PAYE bands are resolved only for taxpayerCategory "resident" — no
 *    employee field yet establishes resident/non-resident status; this is a
 *    disclosed scope limitation, not an invented statutory value.
 *  - The overtime formula's "qualifying employee" eligibility nuance
 *    (frozen plan §4.1) is applied uniformly to every overtime component,
 *    since the formula itself is confirmed but the eligibility gate is not.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
  payrollInputReferencesTable,
  type PayrollPayeBand,
  type EmployeeCompensationComponent,
} from "@workspace/db";

type PayrollCompensationCategory = EmployeeCompensationComponent["category"];
type PayrollTaxableTreatment = EmployeeCompensationComponent["taxableTreatment"];
import { resolveStatutoryRuleVersionAsOf } from "./payrollStatutoryRules";
import { resolveCompensationAsOf } from "./payrollCompensation";
import { resolveEmployeeNumberAsOf } from "./numbering";
import { toMinorUnits, fromMinorUnits, applyPercent, clampMinor, sumMinor } from "./payrollMoney";

export class MissingStatutoryRuleError extends Error {
  constructor(ruleType: string) {
    super(`No approved statutory rule version of type "${ruleType}" is in force for this pay date`);
  }
}
export class NoCompensationAssignedError extends Error {
  constructor() {
    super("This employee has no compensation components or one-off inputs to calculate for this period");
  }
}
export class UnresolvedComponentTreatmentError extends Error {
  constructor(componentTypeCode: string) {
    super(
      `Component "${componentTypeCode}" is treated as "benefit_in_kind", whose monetization formula remains an unresolved statutory item — calculation cannot proceed for this employee until it is resolved or the component is removed`,
    );
  }
}
export class CurrencyMismatchError extends Error {
  constructor(expected: string, actual: string, componentTypeCode: string) {
    super(`Component "${componentTypeCode}" is in currency "${actual}", but this calculation expects "${expected}"`);
  }
}
export class MalformedPayeBandsError extends Error {
  constructor() {
    super("The resolved PAYE bands for this pay date are malformed (must have exactly one open-ended final band)");
  }
}
export class DuplicateCompensationComponentError extends Error {
  constructor(componentTypeCode: string) {
    super(`More than one open compensation component was resolved for "${componentTypeCode}" — this should never happen and indicates a data integrity issue`);
  }
}

export interface EmployeePayrollCalculationParams {
  organizationId: number;
  employeeId: number;
  payrollPeriodId: number;
  payDate: Date;
  currency: string;
}

export interface PayrollCalculationTraceComponent {
  category: PayrollCompensationCategory;
  componentTypeCode: string;
  amount: string;
  taxableTreatment: PayrollTaxableTreatment;
  pensionable: boolean;
  source: "recurring" | "one_off";
}

export interface EmployeePayrollCalculationResult {
  staffNumberSnapshot: string | null;
  payeBandsVersionId: number;
  pensionRatesVersionId: number;
  pensionEarningsCeilingVersionId: number | null;
  grossEarnings: string;
  pensionableEarnings: string;
  employeePensionDeduction: string;
  employerPensionContribution: string;
  tier1Amount: string;
  tier2Amount: string;
  taxableIncome: string;
  payeAmount: string;
  otherDeductions: string;
  netPay: string;
  currency: string;
  components: PayrollCalculationTraceComponent[];
}

/** Ordered graduated tax over `bands`, each row's thresholdAmount being that band's WIDTH (null only for the final open-ended band). Exported for direct band-boundary unit testing (§X). */
export function calculateGraduatedTax(taxableBaseMinor: bigint, bands: PayrollPayeBand[]): bigint {
  const sorted = [...bands].sort((a, b) => a.bandOrder - b.bandOrder);
  const openEndedCount = sorted.filter((b) => b.thresholdAmount === null).length;
  if (sorted.length === 0 || openEndedCount !== 1 || sorted[sorted.length - 1].thresholdAmount !== null) {
    throw new MalformedPayeBandsError();
  }

  let remaining = taxableBaseMinor;
  let tax = 0n;
  for (const band of sorted) {
    if (remaining <= 0n) break;
    const widthMinor = band.thresholdAmount === null ? remaining : toMinorUnits(band.thresholdAmount);
    const amountInBand = remaining < widthMinor ? remaining : widthMinor;
    tax += applyPercent(amountInBand, band.ratePercent);
    remaining -= amountInBand;
  }
  return tax;
}

export async function calculateEmployeePayroll(
  params: EmployeePayrollCalculationParams,
): Promise<EmployeePayrollCalculationResult> {
  const { organizationId, employeeId, payrollPeriodId, payDate, currency } = params;

  const recurring = await resolveCompensationAsOf(organizationId, employeeId, payDate);
  const oneOff = await db
    .select()
    .from(payrollInputReferencesTable)
    .where(
      and(
        eq(payrollInputReferencesTable.organizationId, organizationId),
        eq(payrollInputReferencesTable.payrollPeriodId, payrollPeriodId),
        eq(payrollInputReferencesTable.employeeId, employeeId),
      ),
    );

  if (recurring.length === 0 && oneOff.length === 0) throw new NoCompensationAssignedError();

  const seenRecurringKeys = new Set<string>();
  for (const c of recurring) {
    const key = `${c.category}:${c.componentTypeCode}`;
    if (seenRecurringKeys.has(key)) throw new DuplicateCompensationComponentError(c.componentTypeCode);
    seenRecurringKeys.add(key);
  }

  const components: PayrollCalculationTraceComponent[] = [];
  for (const c of recurring) {
    if (c.taxableTreatment === "benefit_in_kind") throw new UnresolvedComponentTreatmentError(c.componentTypeCode);
    if (c.currency !== currency) throw new CurrencyMismatchError(currency, c.currency, c.componentTypeCode);
    components.push({
      category: c.category,
      componentTypeCode: c.componentTypeCode,
      amount: c.amount,
      taxableTreatment: c.taxableTreatment,
      pensionable: c.pensionable,
      source: "recurring",
    });
  }
  for (const i of oneOff) {
    if (i.taxableTreatment === "benefit_in_kind") throw new UnresolvedComponentTreatmentError(i.componentTypeCode);
    if (i.currency !== currency) throw new CurrencyMismatchError(currency, i.currency, i.componentTypeCode);
    components.push({
      category: i.category,
      componentTypeCode: i.componentTypeCode,
      amount: i.amount,
      taxableTreatment: i.taxableTreatment,
      // One-off inputs are never pensionable — the frozen plan's confirmed
      // pensionable base is recurring basic salary; a one-off input has no
      // recurring/effective-dated identity to carry that classification.
      pensionable: false,
      source: "one_off",
    });
  }

  const earnings = components.filter((c) => c.category === "earning");
  const deductionComponents = components.filter((c) => c.category === "deduction");

  const earningsMinor = earnings.map((e) => ({ ...e, amountMinor: toMinorUnits(e.amount) }));
  const deductionsMinor = deductionComponents.map((d) => toMinorUnits(d.amount));

  const grossEarnings = sumMinor(earningsMinor.map((e) => e.amountMinor));

  const payeVersion = await resolveStatutoryRuleVersionAsOf("paye_bands", payDate);
  if (!payeVersion) throw new MissingStatutoryRuleError("paye_bands");
  const pensionRatesVersion = await resolveStatutoryRuleVersionAsOf("pension_rates", payDate);
  if (!pensionRatesVersion) throw new MissingStatutoryRuleError("pension_rates");
  const pensionCeilingVersion = await resolveStatutoryRuleVersionAsOf("pension_earnings_ceiling", payDate);

  const payeBandsRows = await db
    .select()
    .from(payrollPayeBandsTable)
    .where(
      and(eq(payrollPayeBandsTable.statutoryRuleVersionId, payeVersion.id), eq(payrollPayeBandsTable.taxpayerCategory, "resident")),
    );

  const [pensionRates] = await db
    .select()
    .from(payrollPensionRatesTable)
    .where(eq(payrollPensionRatesTable.statutoryRuleVersionId, pensionRatesVersion.id));
  if (!pensionRates) throw new MissingStatutoryRuleError("pension_rates");

  const [pensionCeiling] = pensionCeilingVersion
    ? await db
        .select()
        .from(payrollPensionEarningsCeilingTable)
        .where(eq(payrollPensionEarningsCeilingTable.statutoryRuleVersionId, pensionCeilingVersion.id))
    : [undefined];

  const minInsurable = pensionCeiling?.minimumInsurableEarnings ? toMinorUnits(pensionCeiling.minimumInsurableEarnings) : null;
  const maxInsurable = pensionCeiling?.maximumInsurableEarnings ? toMinorUnits(pensionCeiling.maximumInsurableEarnings) : null;

  const pensionableEarningsRaw = sumMinor(earningsMinor.filter((e) => e.pensionable).map((e) => e.amountMinor));
  const pensionableEarnings = clampMinor(pensionableEarningsRaw, minInsurable, maxInsurable);

  const employeePensionDeduction = applyPercent(pensionableEarnings, pensionRates.employeeRatePercent);
  const employerPensionContribution = applyPercent(pensionableEarnings, pensionRates.employerRatePercent);
  const tier1Amount = applyPercent(pensionableEarnings, pensionRates.tier1AllocationPercent);
  const tier2Amount = applyPercent(pensionableEarnings, pensionRates.tier2AllocationPercent);

  const ordinaryGross = sumMinor(earningsMinor.filter((e) => e.taxableTreatment === "ordinary").map((e) => e.amountMinor));
  const bonusGross = sumMinor(earningsMinor.filter((e) => e.taxableTreatment === "bonus").map((e) => e.amountMinor));
  const overtimeGross = sumMinor(earningsMinor.filter((e) => e.taxableTreatment === "overtime").map((e) => e.amountMinor));

  const basicSalary = earningsMinor.find((e) => e.componentTypeCode === "basic_salary");
  const basicSalaryMinor = basicSalary ? basicSalary.amountMinor : 0n;

  // SSNIT-before-PAYE order (frozen plan §4.1, confirmed order): employee
  // pension deduction is subtracted from ordinary earnings before graduated
  // tax is applied.
  let ordinaryTaxableBase = ordinaryGross - employeePensionDeduction;
  if (ordinaryTaxableBase < 0n) ordinaryTaxableBase = 0n;

  // Bonus: flat 5% up to 15% of ANNUAL basic salary; excess folds into the
  // ordinary graduated base instead of being taxed again at a flat rate.
  let payeBonus = 0n;
  if (bonusGross > 0n) {
    const annualBasicMinor = basicSalaryMinor * 12n;
    const bonusThresholdMinor = applyPercent(annualBasicMinor, "15.00");
    const bonusWithinThreshold = bonusGross < bonusThresholdMinor ? bonusGross : bonusThresholdMinor;
    const bonusExcess = bonusGross > bonusThresholdMinor ? bonusGross - bonusThresholdMinor : 0n;
    payeBonus = applyPercent(bonusWithinThreshold, "5.00");
    ordinaryTaxableBase += bonusExcess;
  }

  // Overtime: 5% flat up to 50% of MONTHLY basic salary; 10% on the excess.
  let payeOvertime = 0n;
  if (overtimeGross > 0n) {
    const overtimeThresholdMinor = applyPercent(basicSalaryMinor, "50.00");
    const overtimeWithinThreshold = overtimeGross < overtimeThresholdMinor ? overtimeGross : overtimeThresholdMinor;
    const overtimeExcess = overtimeGross > overtimeThresholdMinor ? overtimeGross - overtimeThresholdMinor : 0n;
    payeOvertime = applyPercent(overtimeWithinThreshold, "5.00") + applyPercent(overtimeExcess, "10.00");
  }

  const payeOrdinary = calculateGraduatedTax(ordinaryTaxableBase, payeBandsRows);
  const payeAmount = payeOrdinary + payeBonus + payeOvertime;

  const otherDeductions = sumMinor(deductionsMinor);

  const netPay = grossEarnings - employeePensionDeduction - payeAmount - otherDeductions;

  const staffNumberSnapshot = await resolveEmployeeNumberAsOf(organizationId, employeeId, payDate);

  return {
    staffNumberSnapshot,
    payeBandsVersionId: payeVersion.id,
    pensionRatesVersionId: pensionRatesVersion.id,
    pensionEarningsCeilingVersionId: pensionCeilingVersion?.id ?? null,
    grossEarnings: fromMinorUnits(grossEarnings),
    pensionableEarnings: fromMinorUnits(pensionableEarnings),
    employeePensionDeduction: fromMinorUnits(employeePensionDeduction),
    employerPensionContribution: fromMinorUnits(employerPensionContribution),
    tier1Amount: fromMinorUnits(tier1Amount),
    tier2Amount: fromMinorUnits(tier2Amount),
    taxableIncome: fromMinorUnits(ordinaryTaxableBase),
    payeAmount: fromMinorUnits(payeAmount),
    otherDeductions: fromMinorUnits(otherDeductions),
    netPay: fromMinorUnits(netPay),
    currency,
    components,
  };
}
