/**
 * Payroll, Workstream 5 (frozen plan §9.7/§12/§13 — Workstreams 6 "Payslips
 * & Employee Self Service Exposure" + 7 "Statutory Schedules & Reports"
 * combined; see this workstream's own frozen-numbering reconciliation).
 *
 * BINDING PRINCIPLE: every figure here is read directly from the immutable,
 * already-persisted payroll_run_lines/payroll_run_line_components (and,
 * where a correction exists, payroll_corrections/payroll_correction_components)
 * rows a locked run's own calculation already wrote. This file NEVER calls
 * calculateEmployeePayroll or any other live-calculation function — doing so
 * would silently re-derive a number from current compensation/statutory
 * data, exactly the failure mode §2 of this workstream's own prompt
 * prohibits. A locked run is the financial authority; this file only reads
 * and formats what it already decided.
 *
 * Employee NAME is the one disclosed exception to "everything is
 * snapshotted": payroll_run_lines never stores a name (only employeeId and
 * the as-of-payDate staffNumberSnapshot — the only identity/label the
 * frozen plan's §17 requires to be historically pinned). Names are resolved
 * live via a batched employees lookup, mirroring the exact same convention
 * every other Phase 3H report already uses (personnelReporting.ts's own
 * resolveEmployeeLabelsAndDepartmentPosition) — a cosmetic display
 * convenience, not a financial figure, and not a new decision invented
 * here.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollPeriodsTable,
  payrollStatutoryRuleVersionsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  employeesTable,
  type PayrollRun,
  type PayrollRunLine,
  type PayrollRunLineComponent,
  type PayrollPeriod,
  type PayrollCorrection,
  type PayrollCorrectionComponent,
} from "@workspace/db";
import { toMinorUnits, fromMinorUnits, sumMinor } from "./payrollMoney";
import { resolveStatutoryIdentifiersAsOf } from "./payrollSensitiveRecords";

export class PayrollRunNotFoundError extends Error {
  constructor() {
    super("Payroll run not found");
  }
}
export class PayrollRunNotLockedError extends Error {
  constructor(status: string) {
    super(`Payroll outputs are only available for a "locked" run (this run is currently "${status}")`);
  }
}
export class PayrollRunLineNotFoundError extends Error {
  constructor() {
    super("Payroll run line not found on this run");
  }
}

async function getLockedRunOrThrow(organizationId: number, runId: number): Promise<PayrollRun> {
  const [run] = await db.select().from(payrollRunsTable).where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.organizationId, organizationId)));
  if (!run) throw new PayrollRunNotFoundError();
  if (run.status !== "locked") throw new PayrollRunNotLockedError(run.status);
  return run;
}

async function batchEmployeeNames(employeeIds: number[]): Promise<Map<number, string>> {
  const labelById = new Map<number, string>();
  if (employeeIds.length === 0) return labelById;
  const rows = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
    .from(employeesTable)
    .where(inArray(employeesTable.id, employeeIds));
  for (const r of rows) labelById.set(r.id, `${r.firstName} ${r.lastName}`);
  return labelById;
}

async function batchStatutoryVersionEffectiveFrom(versionIds: (number | null)[]): Promise<Map<number, Date>> {
  const ids = [...new Set(versionIds.filter((id): id is number => id != null))];
  const map = new Map<number, Date>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: payrollStatutoryRuleVersionsTable.id, effectiveFrom: payrollStatutoryRuleVersionsTable.effectiveFrom })
    .from(payrollStatutoryRuleVersionsTable)
    .where(inArray(payrollStatutoryRuleVersionsTable.id, ids));
  for (const r of rows) map.set(r.id, r.effectiveFrom);
  return map;
}

async function getPeriodOrThrow(payrollPeriodId: number): Promise<PayrollPeriod> {
  const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, payrollPeriodId));
  if (!period) throw new PayrollRunNotFoundError();
  return period;
}

// --- Payslip ---

export interface PayslipComponentDTO {
  category: string;
  componentTypeCode: string;
  amount: string;
  taxableTreatment: string;
  pensionable: boolean;
  source: string;
}

export interface PayslipFigures {
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
}

export interface PayslipCorrectionDTO extends PayslipFigures {
  id: number;
  status: string;
  reason: string;
  netPayDelta: string;
  approvedAt: Date | null;
  components: PayslipComponentDTO[];
}

export interface PayslipDTO {
  organizationId: number;
  payrollRunId: number;
  payrollRunLineId: number;
  employeeId: number;
  employeeName: string;
  staffNumberSnapshot: string | null;
  payrollPeriod: { id: number; frequency: string; periodKey: string; startDate: Date; endDate: Date; payDate: Date };
  currency: string;
  original: PayslipFigures & { components: PayslipComponentDTO[] };
  corrections: PayslipCorrectionDTO[];
  effective: PayslipFigures & { source: "original" | "correction"; correctionId: number | null };
}

function toFigures(row: PayrollRunLine | PayrollCorrection): PayslipFigures {
  return {
    grossEarnings: row.grossEarnings,
    pensionableEarnings: row.pensionableEarnings,
    employeePensionDeduction: row.employeePensionDeduction,
    employerPensionContribution: row.employerPensionContribution,
    tier1Amount: row.tier1Amount,
    tier2Amount: row.tier2Amount,
    taxableIncome: row.taxableIncome,
    payeAmount: row.payeAmount,
    otherDeductions: row.otherDeductions,
    netPay: row.netPay,
  };
}

function toComponentDTO(c: PayrollRunLineComponent | PayrollCorrectionComponent): PayslipComponentDTO {
  return { category: c.category, componentTypeCode: c.componentTypeCode, amount: c.amount, taxableTreatment: c.taxableTreatment, pensionable: c.pensionable, source: c.source };
}

/**
 * The one payslip-assembly function in this workstream — reads
 * payroll_run_lines/payroll_run_line_components (original, immutable) and
 * payroll_corrections/payroll_correction_components (append-only
 * adjustments) for one line, and computes `effective` as the most recently
 * APPROVED correction's own already-recalculated figures (never a derived
 * delta-math formula — each correction already stores a complete
 * recalculation, so "effective" is simply "the latest authoritative
 * figure", not an invented accounting rule) — falling back to `original`
 * when no correction has been approved. Draft (unapproved) corrections are
 * never surfaced here — an unapproved adjustment is not yet authoritative.
 */
export async function getPayslip(organizationId: number, runId: number, runLineId: number): Promise<PayslipDTO> {
  const run = await getLockedRunOrThrow(organizationId, runId);

  const [line] = await db.select().from(payrollRunLinesTable).where(and(eq(payrollRunLinesTable.id, runLineId), eq(payrollRunLinesTable.payrollRunId, run.id)));
  if (!line) throw new PayrollRunLineNotFoundError();

  const [period, lineComponents, corrections, employeeNames] = await Promise.all([
    getPeriodOrThrow(run.payrollPeriodId),
    db.select().from(payrollRunLineComponentsTable).where(eq(payrollRunLineComponentsTable.payrollRunLineId, line.id)),
    db
      .select()
      .from(payrollCorrectionsTable)
      .where(and(eq(payrollCorrectionsTable.originalRunLineId, line.id), eq(payrollCorrectionsTable.status, "approved")))
      .orderBy(desc(payrollCorrectionsTable.approvedAt)),
    batchEmployeeNames([line.employeeId]),
  ]);

  const correctionDTOs: PayslipCorrectionDTO[] = [];
  for (const correction of corrections) {
    const components = await db.select().from(payrollCorrectionComponentsTable).where(eq(payrollCorrectionComponentsTable.payrollCorrectionId, correction.id));
    correctionDTOs.push({
      ...toFigures(correction),
      id: correction.id,
      status: correction.status,
      reason: correction.reason,
      netPayDelta: correction.netPayDelta,
      approvedAt: correction.approvedAt,
      components: components.map(toComponentDTO),
    });
  }

  const mostRecentApproved = correctionDTOs[0] ?? null;

  return {
    organizationId,
    payrollRunId: run.id,
    payrollRunLineId: line.id,
    employeeId: line.employeeId,
    employeeName: employeeNames.get(line.employeeId) ?? `Employee #${line.employeeId}`,
    staffNumberSnapshot: line.staffNumberSnapshot,
    payrollPeriod: { id: period.id, frequency: period.frequency, periodKey: period.periodKey, startDate: period.startDate, endDate: period.endDate, payDate: period.payDate },
    currency: line.currency,
    original: { ...toFigures(line), components: lineComponents.map(toComponentDTO) },
    corrections: correctionDTOs,
    effective: mostRecentApproved
      ? {
          grossEarnings: mostRecentApproved.grossEarnings,
          pensionableEarnings: mostRecentApproved.pensionableEarnings,
          employeePensionDeduction: mostRecentApproved.employeePensionDeduction,
          employerPensionContribution: mostRecentApproved.employerPensionContribution,
          tier1Amount: mostRecentApproved.tier1Amount,
          tier2Amount: mostRecentApproved.tier2Amount,
          taxableIncome: mostRecentApproved.taxableIncome,
          payeAmount: mostRecentApproved.payeAmount,
          otherDeductions: mostRecentApproved.otherDeductions,
          netPay: mostRecentApproved.netPay,
          source: "correction",
          correctionId: mostRecentApproved.id,
        }
      : { ...toFigures(line), source: "original", correctionId: null },
  };
}

/** Every locked run this employee has a line on, for ESS "my payslips" listing — newest period first. */
export async function listOwnPayslipSummaries(
  organizationId: number,
  employeeId: number,
): Promise<Array<{ payrollRunId: number; payrollRunLineId: number; payrollPeriod: { id: number; periodKey: string; payDate: Date }; netPay: string; currency: string; hasApprovedCorrection: boolean }>> {
  const lines = await db
    .select({
      lineId: payrollRunLinesTable.id,
      runId: payrollRunLinesTable.payrollRunId,
      payrollPeriodId: payrollRunsTable.payrollPeriodId,
      netPay: payrollRunLinesTable.netPay,
      currency: payrollRunLinesTable.currency,
    })
    .from(payrollRunLinesTable)
    .innerJoin(payrollRunsTable, eq(payrollRunLinesTable.payrollRunId, payrollRunsTable.id))
    .where(and(eq(payrollRunLinesTable.organizationId, organizationId), eq(payrollRunLinesTable.employeeId, employeeId), eq(payrollRunsTable.status, "locked")));

  if (lines.length === 0) return [];

  const periodIds = [...new Set(lines.map((l) => l.payrollPeriodId))];
  const periods = await db.select().from(payrollPeriodsTable).where(inArray(payrollPeriodsTable.id, periodIds));
  const periodById = new Map(periods.map((p) => [p.id, p]));

  const lineIds = lines.map((l) => l.lineId);
  const approvedCorrections = await db
    .select({ originalRunLineId: payrollCorrectionsTable.originalRunLineId })
    .from(payrollCorrectionsTable)
    .where(and(inArray(payrollCorrectionsTable.originalRunLineId, lineIds), eq(payrollCorrectionsTable.status, "approved")));
  const linesWithCorrections = new Set(approvedCorrections.map((c) => c.originalRunLineId));

  return lines
    .map((l) => {
      const period = periodById.get(l.payrollPeriodId)!;
      return {
        payrollRunId: l.runId,
        payrollRunLineId: l.lineId,
        payrollPeriod: { id: period.id, periodKey: period.periodKey, payDate: period.payDate },
        netPay: l.netPay,
        currency: l.currency,
        hasApprovedCorrection: linesWithCorrections.has(l.lineId),
      };
    })
    .sort((a, b) => b.payrollPeriod.payDate.getTime() - a.payrollPeriod.payDate.getTime());
}

// --- Payroll Register / PAYE Schedule / Pension Schedule (§10/§11/§12) ---

export interface ReportColumn {
  key: string;
  label: string;
}
export interface ReportResult {
  key: string;
  label: string;
  generatedAt: Date;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string>;
}

export const PAYROLL_REPORT_KEYS = ["payroll_register", "payroll_paye_schedule", "payroll_pension_schedule"] as const;
export type PayrollReportKey = (typeof PAYROLL_REPORT_KEYS)[number];
export function isKnownPayrollReportKey(key: string): key is PayrollReportKey {
  return (PAYROLL_REPORT_KEYS as readonly string[]).includes(key);
}
export class PayrollReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown payroll report "${key}"`);
  }
}

async function loadLockedRunContext(organizationId: number, runId: number) {
  const run = await getLockedRunOrThrow(organizationId, runId);
  const [period, lines] = await Promise.all([
    getPeriodOrThrow(run.payrollPeriodId),
    db.select().from(payrollRunLinesTable).where(eq(payrollRunLinesTable.payrollRunId, run.id)),
  ]);
  const employeeNames = await batchEmployeeNames(lines.map((l) => l.employeeId));

  const lineIds = lines.map((l) => l.id);
  const approvedCorrections =
    lineIds.length > 0
      ? await db.select().from(payrollCorrectionsTable).where(and(inArray(payrollCorrectionsTable.originalRunLineId, lineIds), eq(payrollCorrectionsTable.status, "approved")))
      : [];
  // Most recent approved correction per line, if any.
  const latestCorrectionByLine = new Map<number, PayrollCorrection>();
  for (const c of approvedCorrections) {
    const existing = latestCorrectionByLine.get(c.originalRunLineId);
    if (!existing || (c.approvedAt && (!existing.approvedAt || c.approvedAt > existing.approvedAt))) {
      latestCorrectionByLine.set(c.originalRunLineId, c);
    }
  }

  return { run, period, lines, employeeNames, latestCorrectionByLine };
}

export async function runPayrollRegisterReport(organizationId: number, runId: number): Promise<ReportResult> {
  const { period, lines, employeeNames, latestCorrectionByLine } = await loadLockedRunContext(organizationId, runId);

  const columns: ReportColumn[] = [
    { key: "employeeId", label: "Employee ID" },
    { key: "employeeName", label: "Employee Name" },
    { key: "staffNumber", label: "Staff Number" },
    { key: "grossEarnings", label: "Gross Earnings" },
    { key: "pensionableEarnings", label: "Pensionable Earnings" },
    { key: "employeePensionDeduction", label: "Employee Pension Deduction" },
    { key: "employerPensionContribution", label: "Employer Pension Contribution" },
    { key: "payeAmount", label: "PAYE" },
    { key: "otherDeductions", label: "Other Deductions" },
    { key: "netPay", label: "Net Pay (Original)" },
    { key: "correctedNetPay", label: "Net Pay (Latest Approved Correction)" },
  ];

  const rows = lines.map((l) => {
    const correction = latestCorrectionByLine.get(l.id) ?? null;
    return {
      employeeId: l.employeeId,
      employeeName: employeeNames.get(l.employeeId) ?? `Employee #${l.employeeId}`,
      staffNumber: l.staffNumberSnapshot,
      grossEarnings: l.grossEarnings,
      pensionableEarnings: l.pensionableEarnings,
      employeePensionDeduction: l.employeePensionDeduction,
      employerPensionContribution: l.employerPensionContribution,
      payeAmount: l.payeAmount,
      otherDeductions: l.otherDeductions,
      netPay: l.netPay,
      correctedNetPay: correction ? correction.netPay : null,
    };
  });

  const totals = {
    grossEarnings: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.grossEarnings)))),
    pensionableEarnings: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.pensionableEarnings)))),
    employeePensionDeduction: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.employeePensionDeduction)))),
    employerPensionContribution: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.employerPensionContribution)))),
    payeAmount: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.payeAmount)))),
    otherDeductions: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.otherDeductions)))),
    netPay: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.netPay)))),
  };

  return { key: "payroll_register", label: "Payroll Register", generatedAt: new Date(), columns, rows, totals };
}

export async function runPayeScheduleReport(organizationId: number, runId: number): Promise<ReportResult> {
  const { lines, employeeNames } = await loadLockedRunContext(organizationId, runId);
  const versionEffectiveFrom = await batchStatutoryVersionEffectiveFrom(lines.map((l) => l.payeBandsVersionId));

  const columns: ReportColumn[] = [
    { key: "employeeId", label: "Employee ID" },
    { key: "employeeName", label: "Employee Name" },
    { key: "staffNumber", label: "Staff Number" },
    { key: "taxableIncome", label: "Taxable Income" },
    { key: "payeAmount", label: "PAYE" },
    { key: "payeBandsVersionId", label: "PAYE Bands Version" },
    { key: "payeBandsEffectiveFrom", label: "PAYE Bands Effective From" },
  ];

  const rows = lines.map((l) => ({
    employeeId: l.employeeId,
    employeeName: employeeNames.get(l.employeeId) ?? `Employee #${l.employeeId}`,
    staffNumber: l.staffNumberSnapshot,
    taxableIncome: l.taxableIncome,
    payeAmount: l.payeAmount,
    payeBandsVersionId: l.payeBandsVersionId,
    payeBandsEffectiveFrom: l.payeBandsVersionId ? (versionEffectiveFrom.get(l.payeBandsVersionId)?.toISOString() ?? null) : null,
  }));

  const totals = {
    taxableIncome: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.taxableIncome)))),
    payeAmount: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.payeAmount)))),
  };

  return { key: "payroll_paye_schedule", label: "PAYE Schedule", generatedAt: new Date(), columns, rows, totals };
}

/**
 * `includeStatutoryIdentifiers` gates whether SSNIT numbers are resolved
 * and included at all — checked by the ROUTE layer against
 * payroll.statutory_identifiers.read (narrower than payroll.report.read),
 * mirroring W2's own banking/statutory-identifier permission separation.
 * Every inclusion is a "read" of a sensitive identifier and the route
 * layer audits it, matching Decision 9.
 */
export async function runPensionScheduleReport(organizationId: number, runId: number, includeStatutoryIdentifiers: boolean): Promise<ReportResult> {
  const { period, lines, employeeNames } = await loadLockedRunContext(organizationId, runId);
  const versionEffectiveFrom = await batchStatutoryVersionEffectiveFrom(lines.map((l) => l.pensionRatesVersionId));

  const ssnitByEmployee = includeStatutoryIdentifiers
    ? await resolveStatutoryIdentifiersAsOf(organizationId, lines.map((l) => l.employeeId), period.payDate)
    : new Map();

  const columns: ReportColumn[] = [
    { key: "employeeId", label: "Employee ID" },
    { key: "employeeName", label: "Employee Name" },
    { key: "staffNumber", label: "Staff Number" },
    ...(includeStatutoryIdentifiers ? [{ key: "ssnitNumber", label: "SSNIT Number" }] : []),
    { key: "pensionableEarnings", label: "Pensionable Earnings" },
    { key: "employeePensionDeduction", label: "Employee Contribution" },
    { key: "employerPensionContribution", label: "Employer Contribution" },
    { key: "tier1Amount", label: "Tier 1 Amount" },
    { key: "tier2Amount", label: "Tier 2 Amount" },
    { key: "pensionRatesVersionId", label: "Pension Rates Version" },
    { key: "pensionRatesEffectiveFrom", label: "Pension Rates Effective From" },
  ];

  const rows = lines.map((l) => ({
    employeeId: l.employeeId,
    employeeName: employeeNames.get(l.employeeId) ?? `Employee #${l.employeeId}`,
    staffNumber: l.staffNumberSnapshot,
    ...(includeStatutoryIdentifiers ? { ssnitNumber: ssnitByEmployee.get(l.employeeId)?.ssnitNumber ?? null } : {}),
    pensionableEarnings: l.pensionableEarnings,
    employeePensionDeduction: l.employeePensionDeduction,
    employerPensionContribution: l.employerPensionContribution,
    tier1Amount: l.tier1Amount,
    tier2Amount: l.tier2Amount,
    pensionRatesVersionId: l.pensionRatesVersionId,
    pensionRatesEffectiveFrom: l.pensionRatesVersionId ? (versionEffectiveFrom.get(l.pensionRatesVersionId)?.toISOString() ?? null) : null,
  }));

  const totals = {
    pensionableEarnings: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.pensionableEarnings)))),
    employeePensionDeduction: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.employeePensionDeduction)))),
    employerPensionContribution: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.employerPensionContribution)))),
    tier1Amount: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.tier1Amount)))),
    tier2Amount: fromMinorUnits(sumMinor(lines.map((l) => toMinorUnits(l.tier2Amount)))),
  };

  return { key: "payroll_pension_schedule", label: "Pension / SSNIT Schedule", generatedAt: new Date(), columns, rows, totals };
}

export async function runPayrollReport(organizationId: number, runId: number, key: string, includeStatutoryIdentifiers: boolean): Promise<ReportResult> {
  if (key === "payroll_register") return runPayrollRegisterReport(organizationId, runId);
  if (key === "payroll_paye_schedule") return runPayeScheduleReport(organizationId, runId);
  if (key === "payroll_pension_schedule") return runPensionScheduleReport(organizationId, runId, includeStatutoryIdentifiers);
  throw new PayrollReportNotFoundError(key);
}
