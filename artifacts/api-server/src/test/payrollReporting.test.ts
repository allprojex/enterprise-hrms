/**
 * Payroll, Workstream 5 — Payslips & Payroll Reporting / Outputs.
 * Calls the lib functions directly (no HTTP layer — permission/module
 * gating and audit recording are exercised in payrollReportingHttp.test.ts
 * and the live QA, not duplicated here). Every fixture value is disposable
 * test data, never a real Ghana figure.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | { __op: "inArray"; field: string; vals: unknown[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

const {
  fixtures,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollPeriodsTable,
  payrollStatutoryRuleVersionsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  employeesTable,
  employeeStatutoryIdentifiersTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      runRows: [] as Record<string, unknown>[],
      lineRows: [] as Record<string, unknown>[],
      lineComponentRows: [] as Record<string, unknown>[],
      periodRows: [] as Record<string, unknown>[],
      statutoryVersionRows: [] as Record<string, unknown>[],
      correctionRows: [] as Record<string, unknown>[],
      correctionComponentRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      statutoryIdentifierRows: [] as Record<string, unknown>[],
    },
    payrollRunsTable: mockTable("payroll_runs", ["id", "organizationId", "payrollPeriodId", "status"]),
    payrollRunLinesTable: mockTable("payroll_run_lines", [
      "id", "organizationId", "payrollRunId", "employeeId", "staffNumberSnapshot", "payeBandsVersionId", "pensionRatesVersionId", "pensionEarningsCeilingVersionId",
      "grossEarnings", "pensionableEarnings", "employeePensionDeduction", "employerPensionContribution", "tier1Amount", "tier2Amount", "taxableIncome", "payeAmount", "otherDeductions", "netPay", "currency",
    ]),
    payrollRunLineComponentsTable: mockTable("payroll_run_line_components", ["id", "payrollRunLineId", "category", "componentTypeCode", "amount", "taxableTreatment", "pensionable", "source"]),
    payrollPeriodsTable: mockTable("payroll_periods", ["id", "organizationId", "frequency", "periodKey", "startDate", "endDate", "payDate"]),
    payrollStatutoryRuleVersionsTable: mockTable("payroll_statutory_rule_versions", ["id", "effectiveFrom"]),
    payrollCorrectionsTable: mockTable("payroll_corrections", [
      "id", "organizationId", "originalRunId", "originalRunLineId", "employeeId", "status", "reason",
      "grossEarnings", "pensionableEarnings", "employeePensionDeduction", "employerPensionContribution", "tier1Amount", "tier2Amount", "taxableIncome", "payeAmount", "otherDeductions", "netPay", "netPayDelta", "currency", "approvedAt",
    ]),
    payrollCorrectionComponentsTable: mockTable("payroll_correction_components", ["id", "payrollCorrectionId", "category", "componentTypeCode", "amount", "taxableTreatment", "pensionable", "source"]),
    employeesTable: mockTable("employees", ["id", "firstName", "lastName"]),
    employeeStatutoryIdentifiersTable: mockTable("employee_statutory_identifiers", ["id", "organizationId", "employeeId", "ssnitNumber", "tin", "validFrom", "validTo"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "payroll_runs": return fixtures.runRows;
    case "payroll_run_lines": return fixtures.lineRows;
    case "payroll_run_line_components": return fixtures.lineComponentRows;
    case "payroll_periods": return fixtures.periodRows;
    case "payroll_statutory_rule_versions": return fixtures.statutoryVersionRows;
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_correction_components": return fixtures.correctionComponentRows;
    case "employees": return fixtures.employeeRows;
    case "employee_statutory_identifiers": return fixtures.statutoryIdentifierRows;
    default: return [];
  }
}

function makeQueryClient(): Record<string, unknown> {
  return {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        const project = (row: Record<string, unknown>) => {
          if (!proj) return row;
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(proj)) out[key] = row[key];
          return out;
        };
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current.map(project));
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage([...current].sort((a, b) => {
              const av = a["approvedAt"] as Date | null, bv = b["approvedAt"] as Date | null;
              if (!av && !bv) return 0;
              if (!av) return 1;
              if (!bv) return -1;
              return bv.getTime() - av.getTime();
            })),
            innerJoin: (joinTable: { __name: string }, _cond: unknown) => {
              const joinRows = rowsFor(joinTable);
              const joined = current.flatMap((r) => {
                const match = joinRows.find((jr) => jr.id === r["payrollRunId"]);
                return match ? [{ ...r, __joined: match }] : [];
              });
              return stage(joined);
            },
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rowsFor(table));
      },
    }),
  };
}

const dbMock = makeQueryClient();

vi.mock("@workspace/db", () => ({
  db: dbMock,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollPeriodsTable,
  payrollStatutoryRuleVersionsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  employeesTable,
  employeeStatutoryIdentifiersTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  desc: () => undefined,
}));

const {
  getPayslip,
  runPayrollRegisterReport,
  runPayeScheduleReport,
  runPensionScheduleReport,
  PayrollRunNotFoundError,
  PayrollRunNotLockedError,
  PayrollRunLineNotFoundError,
} = await import("../lib/payrollReporting");

const ORG = 1;

function resetFixtures() {
  fixtures.runRows = [];
  fixtures.lineRows = [];
  fixtures.lineComponentRows = [];
  fixtures.periodRows = [];
  fixtures.statutoryVersionRows = [];
  fixtures.correctionRows = [];
  fixtures.correctionComponentRows = [];
  fixtures.employeeRows = [];
  fixtures.statutoryIdentifierRows = [];
}

function baseFixture() {
  fixtures.periodRows.push({ id: 1, organizationId: ORG, frequency: "monthly", periodKey: "2026-01", startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01"), payDate: new Date("2026-01-31") });
  fixtures.runRows.push({ id: 1, organizationId: ORG, payrollPeriodId: 1, status: "locked" });
  fixtures.statutoryVersionRows.push({ id: 10, effectiveFrom: new Date("2020-01-01") }, { id: 20, effectiveFrom: new Date("2020-01-01") });
  fixtures.lineRows.push({
    id: 1, organizationId: ORG, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: "EMP-0501",
    payeBandsVersionId: 10, pensionRatesVersionId: 20, pensionEarningsCeilingVersionId: null,
    grossEarnings: "1000.00", pensionableEarnings: "1000.00", employeePensionDeduction: "55.00", employerPensionContribution: "130.00",
    tier1Amount: "135.00", tier2Amount: "50.00", taxableIncome: "945.00", payeAmount: "22.25", otherDeductions: "0.00", netPay: "922.75", currency: "GHS",
  });
  fixtures.lineComponentRows.push({ id: 1, payrollRunLineId: 1, category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", taxableTreatment: "ordinary", pensionable: true, source: "recurring" });
  fixtures.employeeRows.push({ id: 501, firstName: "Ada", lastName: "Lovelace" });
}

describe("getPayslip", () => {
  it("rejects a non-locked run", async () => {
    resetFixtures();
    baseFixture();
    fixtures.runRows[0].status = "calculated";
    await expect(getPayslip(ORG, 1, 1)).rejects.toThrow(PayrollRunNotLockedError);
  });

  it("returns 'not found' for a nonexistent run", async () => {
    resetFixtures();
    await expect(getPayslip(ORG, 999, 1)).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("returns 'line not found' for a mismatched line", async () => {
    resetFixtures();
    baseFixture();
    await expect(getPayslip(ORG, 1, 999)).rejects.toThrow(PayrollRunLineNotFoundError);
  });

  it("returns the exact stored original figures, employee name, and staff-number snapshot, with an empty corrections array and effective == original", async () => {
    resetFixtures();
    baseFixture();
    const payslip = await getPayslip(ORG, 1, 1);
    expect(payslip.employeeName).toBe("Ada Lovelace");
    expect(payslip.staffNumberSnapshot).toBe("EMP-0501");
    expect(payslip.original.netPay).toBe("922.75");
    expect(payslip.original.components).toHaveLength(1);
    expect(payslip.corrections).toHaveLength(0);
    expect(payslip.effective.netPay).toBe("922.75");
    expect(payslip.effective.source).toBe("original");
    expect(payslip.effective.correctionId).toBeNull();
  });

  it("SNAPSHOT PRESERVATION: an approved correction never mutates `original`, and `effective` reflects the correction", async () => {
    resetFixtures();
    baseFixture();
    fixtures.correctionRows.push({
      id: 7, organizationId: ORG, originalRunId: 1, originalRunLineId: 1, employeeId: 501, status: "approved", reason: "salary was under-entered",
      grossEarnings: "1500.00", pensionableEarnings: "1500.00", employeePensionDeduction: "82.50", employerPensionContribution: "195.00",
      tier1Amount: "202.50", tier2Amount: "75.00", taxableIncome: "1417.50", payeAmount: "91.75", otherDeductions: "0.00", netPay: "1325.75",
      netPayDelta: "403.00", currency: "GHS", approvedAt: new Date("2026-02-05"),
    });
    fixtures.correctionComponentRows.push({ id: 1, payrollCorrectionId: 7, category: "earning", componentTypeCode: "basic_salary", amount: "1500.00", taxableTreatment: "ordinary", pensionable: true, source: "recurring" });

    const payslip = await getPayslip(ORG, 1, 1);
    expect(payslip.original.netPay).toBe("922.75");
    expect(payslip.corrections).toHaveLength(1);
    expect(payslip.corrections[0].netPay).toBe("1325.75");
    expect(payslip.corrections[0].netPayDelta).toBe("403.00");
    expect(payslip.effective.netPay).toBe("1325.75");
    expect(payslip.effective.source).toBe("correction");
    expect(payslip.effective.correctionId).toBe(7);
  });

  it("a DRAFT (unapproved) correction is never surfaced", async () => {
    resetFixtures();
    baseFixture();
    fixtures.correctionRows.push({
      id: 8, organizationId: ORG, originalRunId: 1, originalRunLineId: 1, employeeId: 501, status: "draft", reason: "pending",
      grossEarnings: "2000.00", pensionableEarnings: "2000.00", employeePensionDeduction: "110.00", employerPensionContribution: "260.00",
      tier1Amount: "270.00", tier2Amount: "100.00", taxableIncome: "1890.00", payeAmount: "189.00", otherDeductions: "0.00", netPay: "1701.00",
      netPayDelta: "778.25", currency: "GHS", approvedAt: null,
    });
    const payslip = await getPayslip(ORG, 1, 1);
    expect(payslip.corrections).toHaveLength(0);
    expect(payslip.effective.source).toBe("original");
  });
});

describe("runPayrollRegisterReport", () => {
  it("rejects a non-locked run", async () => {
    resetFixtures();
    baseFixture();
    fixtures.runRows[0].status = "approved";
    await expect(runPayrollRegisterReport(ORG, 1)).rejects.toThrow(PayrollRunNotLockedError);
  });

  it("totals reconcile exactly to the sum of run-line values, across multiple employees", async () => {
    resetFixtures();
    baseFixture();
    fixtures.lineRows.push({
      id: 2, organizationId: ORG, payrollRunId: 1, employeeId: 502, staffNumberSnapshot: "EMP-0502",
      payeBandsVersionId: 10, pensionRatesVersionId: 20, pensionEarningsCeilingVersionId: null,
      grossEarnings: "1500.00", pensionableEarnings: "1500.00", employeePensionDeduction: "82.50", employerPensionContribution: "195.00",
      tier1Amount: "202.50", tier2Amount: "75.00", taxableIncome: "1417.50", payeAmount: "91.75", otherDeductions: "20.00", netPay: "1305.75", currency: "GHS",
    });
    fixtures.employeeRows.push({ id: 502, firstName: "Grace", lastName: "Hopper" });

    const result = await runPayrollRegisterReport(ORG, 1);
    expect(result.rows).toHaveLength(2);
    // 1000.00 + 1500.00 = 2500.00; 22.25 + 91.75 = 114.00; 922.75 + 1305.75 = 2228.50
    expect(result.totals.grossEarnings).toBe("2500.00");
    expect(result.totals.payeAmount).toBe("114.00");
    expect(result.totals.netPay).toBe("2228.50");
  });

  it("shows the latest approved correction's net pay in its own column, never merged into the original figure", async () => {
    resetFixtures();
    baseFixture();
    fixtures.correctionRows.push({
      id: 7, organizationId: ORG, originalRunId: 1, originalRunLineId: 1, employeeId: 501, status: "approved", reason: "test",
      grossEarnings: "1500.00", pensionableEarnings: "1500.00", employeePensionDeduction: "82.50", employerPensionContribution: "195.00",
      tier1Amount: "202.50", tier2Amount: "75.00", taxableIncome: "1417.50", payeAmount: "91.75", otherDeductions: "0.00", netPay: "1325.75",
      netPayDelta: "403.00", currency: "GHS", approvedAt: new Date("2026-02-05"),
    });
    const result = await runPayrollRegisterReport(ORG, 1);
    expect(result.rows[0].netPay).toBe("922.75");
    expect(result.rows[0].correctedNetPay).toBe("1325.75");
    // The register's own totals remain the ORIGINAL locked amounts — never silently blended with a correction.
    expect(result.totals.netPay).toBe("922.75");
  });
});

describe("runPayeScheduleReport", () => {
  it("uses the exact stored PAYE value and statutory-version reference, never recalculating", async () => {
    resetFixtures();
    baseFixture();
    const result = await runPayeScheduleReport(ORG, 1);
    expect(result.rows[0].payeAmount).toBe("22.25");
    expect(result.rows[0].payeBandsVersionId).toBe(10);
    expect(result.totals.payeAmount).toBe("22.25");
  });
});

describe("runPensionScheduleReport", () => {
  it("omits SSNIT numbers when statutory-identifier access is not granted", async () => {
    resetFixtures();
    baseFixture();
    fixtures.statutoryIdentifierRows.push({ id: 1, organizationId: ORG, employeeId: 501, ssnitNumber: "SSN-123", tin: "TIN-456", validFrom: new Date("2020-01-01"), validTo: null });
    const result = await runPensionScheduleReport(ORG, 1, false);
    expect(result.columns.some((c) => c.key === "ssnitNumber")).toBe(false);
    expect(result.rows[0].ssnitNumber).toBeUndefined();
  });

  it("includes the SSNIT number resolved as-of the period's payDate when statutory-identifier access is granted", async () => {
    resetFixtures();
    baseFixture();
    fixtures.statutoryIdentifierRows.push({ id: 1, organizationId: ORG, employeeId: 501, ssnitNumber: "SSN-123", tin: "TIN-456", validFrom: new Date("2020-01-01"), validTo: null });
    const result = await runPensionScheduleReport(ORG, 1, true);
    expect(result.columns.some((c) => c.key === "ssnitNumber")).toBe(true);
    expect(result.rows[0].ssnitNumber).toBe("SSN-123");
    expect(result.totals.employeePensionDeduction).toBe("55.00");
  });

  it("resolves a null SSNIT number when none is on file as of the pay date", async () => {
    resetFixtures();
    baseFixture();
    // Identifier only becomes valid AFTER this run's payDate.
    fixtures.statutoryIdentifierRows.push({ id: 1, organizationId: ORG, employeeId: 501, ssnitNumber: "SSN-999", tin: null, validFrom: new Date("2026-06-01"), validTo: null });
    const result = await runPensionScheduleReport(ORG, 1, true);
    expect(result.rows[0].ssnitNumber).toBeNull();
  });
});

describe("architectural regression: no recalculation from live data (§34)", () => {
  it("payrollReporting.ts never imports the live calculation engine (calculateEmployeePayroll is discussed only in comments, never imported/called)", () => {
    const content = readFileSync(join(__dirname, "..", "lib", "payrollReporting.ts"), "utf-8");
    expect(content).not.toMatch(/from ["']\.\/payrollCalculation["']/);
    expect(content).not.toMatch(/\bcalculateEmployeePayroll\s*\(/);
  });
});
