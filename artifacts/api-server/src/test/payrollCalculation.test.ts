/**
 * Payroll, Workstream 3 — Calculation Test Matrix
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.5, §9.6, §13). Calls
 * calculateEmployeePayroll and calculateGraduatedTax directly (no HTTP
 * layer — auth/permission gating is exercised at the route level in the
 * live QA, not here). Every fixture PAYE band/pension rate/ceiling below is
 * a disposable, hand-invented test rule set — never a real Ghana statutory
 * figure — used purely to hand-verify the calculation pipeline's exact
 * monetary output. Every expected value in this file was computed by hand
 * and is shown in each test's comment.
 *
 * Fixture PAYE bands (mirrors a graduated-band shape, disposable):
 *   band1: width 500.00  @ 0%
 *   band2: width 500.00  @ 5%
 *   band3: width 1000.00 @ 10%
 *   band4: width 2000.00 @ 17.5%
 *   band5: open-ended    @ 25%
 * Fixture pension rates: employee 5.5%, employer 13.0%, tier1 13.5%, tier2 5.0%.
 * Fixture pension ceiling: min none, max 1500.00.
 */
import { describe, it, expect, vi } from "vitest";
import { toMinorUnits } from "../lib/payrollMoney";

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

const {
  fixtures,
  employeeCompensationComponentsTable,
  payrollInputReferencesTable,
  payrollStatutoryRuleVersionsTable,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
  employeeNumberAllocationsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      compensationRows: [] as Record<string, unknown>[],
      inputReferenceRows: [] as Record<string, unknown>[],
      statutoryVersionRows: [] as Record<string, unknown>[],
      payeBandRows: [] as Record<string, unknown>[],
      pensionRateRows: [] as Record<string, unknown>[],
      pensionCeilingRows: [] as Record<string, unknown>[],
      numberAllocationRows: [] as Record<string, unknown>[],
    },
    employeeCompensationComponentsTable: mockTable("employee_compensation_components", [
      "id", "organizationId", "employeeId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment", "pensionable", "validFrom", "validTo",
    ]),
    payrollInputReferencesTable: mockTable("payroll_input_references", [
      "id", "organizationId", "payrollPeriodId", "employeeId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment",
    ]),
    payrollStatutoryRuleVersionsTable: mockTable("payroll_statutory_rule_versions", ["id", "ruleType", "status", "effectiveFrom", "effectiveTo"]),
    payrollPayeBandsTable: mockTable("payroll_paye_bands", ["id", "statutoryRuleVersionId", "bandOrder", "taxpayerCategory", "thresholdAmount", "ratePercent"]),
    payrollPensionRatesTable: mockTable("payroll_pension_rates", ["id", "statutoryRuleVersionId", "employeeRatePercent", "employerRatePercent", "tier1AllocationPercent", "tier2AllocationPercent"]),
    payrollPensionEarningsCeilingTable: mockTable("payroll_pension_earnings_ceiling", ["id", "statutoryRuleVersionId", "minimumInsurableEarnings", "maximumInsurableEarnings"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "validFrom", "validTo"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "employee_compensation_components": return fixtures.compensationRows;
    case "payroll_input_references": return fixtures.inputReferenceRows;
    case "payroll_statutory_rule_versions": return fixtures.statutoryVersionRows;
    case "payroll_paye_bands": return fixtures.payeBandRows;
    case "payroll_pension_rates": return fixtures.pensionRateRows;
    case "payroll_pension_earnings_ceiling": return fixtures.pensionCeilingRows;
    case "employee_number_allocations": return fixtures.numberAllocationRows;
    default: return [];
  }
}

function makeQueryClient(): Record<string, unknown> {
  return {
    select: () => ({
      from(table: { __name: string }) {
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
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
  employeeCompensationComponentsTable,
  payrollInputReferencesTable,
  payrollStatutoryRuleVersionsTable,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
  employeeNumberAllocationsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: () => undefined,
  isNull: (col: string) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val: null }),
  inArray: () => undefined,
}));

const {
  calculateEmployeePayroll,
  calculateGraduatedTax,
  MissingStatutoryRuleError,
  NoCompensationAssignedError,
  UnresolvedComponentTreatmentError,
  CurrencyMismatchError,
  MalformedPayeBandsError,
  DuplicateCompensationComponentError,
} = await import("../lib/payrollCalculation");

const ORG = 1;

function resetFixtures() {
  fixtures.compensationRows = [];
  fixtures.inputReferenceRows = [];
  fixtures.statutoryVersionRows = [];
  fixtures.payeBandRows = [];
  fixtures.pensionRateRows = [];
  fixtures.pensionCeilingRows = [];
  fixtures.numberAllocationRows = [];
}

const STANDARD_BANDS = [
  { bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "500.00", ratePercent: "0.00" },
  { bandOrder: 2, taxpayerCategory: "resident", thresholdAmount: "500.00", ratePercent: "5.00" },
  { bandOrder: 3, taxpayerCategory: "resident", thresholdAmount: "1000.00", ratePercent: "10.00" },
  { bandOrder: 4, taxpayerCategory: "resident", thresholdAmount: "2000.00", ratePercent: "17.50" },
  { bandOrder: 5, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "25.00" },
];

function setupStandardStatutoryRules() {
  fixtures.statutoryVersionRows = [
    { id: 1, ruleType: "paye_bands", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
    { id: 2, ruleType: "pension_rates", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
    { id: 3, ruleType: "pension_earnings_ceiling", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
  ];
  fixtures.payeBandRows = STANDARD_BANDS.map((b, i) => ({ id: i + 1, statutoryRuleVersionId: 1, ...b }));
  fixtures.pensionRateRows = [
    { id: 1, statutoryRuleVersionId: 2, employeeRatePercent: "5.50", employerRatePercent: "13.00", tier1AllocationPercent: "13.50", tier2AllocationPercent: "5.00" },
  ];
  fixtures.pensionCeilingRows = [{ id: 1, statutoryRuleVersionId: 3, minimumInsurableEarnings: null, maximumInsurableEarnings: "1500.00" }];
}

function comp(employeeId: number, overrides: Partial<Record<string, unknown>> = {}) {
  fixtures.compensationRows.push({
    id: fixtures.compensationRows.length + 1,
    organizationId: ORG,
    employeeId,
    category: "earning",
    componentTypeCode: "basic_salary",
    amount: "1000.00",
    currency: "GHS",
    taxableTreatment: "ordinary",
    pensionable: true,
    validFrom: new Date("2026-01-01"),
    validTo: null,
    ...overrides,
  });
}

describe("calculateGraduatedTax — band boundary matrix (§X)", () => {
  const bands = STANDARD_BANDS.map((b, i) => ({ id: i + 1, statutoryRuleVersionId: 1, ...b })) as never;

  it("zero taxable base -> zero tax", () => {
    expect(calculateGraduatedTax(0n, bands)).toBe(0n);
  });
  it("base entirely within band 1 (0% band)", () => {
    expect(calculateGraduatedTax(toMinorUnits("300.00"), bands)).toBe(0n);
  });
  it("base exactly at the band-1/band-2 boundary", () => {
    // 500.00 exactly consumes band1 (0%) with nothing left for band2.
    expect(calculateGraduatedTax(toMinorUnits("500.00"), bands)).toBe(0n);
  });
  it("base spanning three bands", () => {
    // band1: 500@0%=0, band2: 500@5%=25.00, band3: 800@10%=80.00 -> 105.00
    expect(calculateGraduatedTax(toMinorUnits("1800.00"), bands)).toBe(toMinorUnits("105.00"));
  });
  it("base reaching the open-ended final band", () => {
    // band1:0 band2:25.00 band3:100.00 band4:2000@17.5%=350.00 band5(open):1000@25%=250.00 -> 725.00
    expect(calculateGraduatedTax(toMinorUnits("5000.00"), bands)).toBe(toMinorUnits("725.00"));
  });
  it("throws on a malformed band set (no open-ended final band)", () => {
    const malformed = [{ id: 1, statutoryRuleVersionId: 1, bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "500.00", ratePercent: "10.00" }] as never;
    expect(() => calculateGraduatedTax(toMinorUnits("100.00"), malformed)).toThrow(MalformedPayeBandsError);
  });
});

describe("calculateEmployeePayroll — end-to-end scenarios (§X)", () => {
  it("zero earnings -> every derived amount is zero", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(1, { amount: "0.00" });

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 1, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    expect(result.grossEarnings).toBe("0.00");
    expect(result.pensionableEarnings).toBe("0.00");
    expect(result.employeePensionDeduction).toBe("0.00");
    expect(result.payeAmount).toBe("0.00");
    expect(result.netPay).toBe("0.00");
  });

  it("pension-ceiling clamp + multi-band PAYE (gross 2000.00 clamped to a 1500.00 pensionable ceiling)", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(2, { amount: "2000.00" });

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 2, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    // pensionable clamped to 1500.00; employee 5.5% = 82.50; employer 13% = 195.00; tier1 13.5%=202.50; tier2 5%=75.00
    // taxableBase = 2000.00 - 82.50 = 1917.50 -> band1:0 band2:25.00 band3:917.50@10%=91.75 -> paye=116.75
    expect(result.pensionableEarnings).toBe("1500.00");
    expect(result.employeePensionDeduction).toBe("82.50");
    expect(result.employerPensionContribution).toBe("195.00");
    expect(result.tier1Amount).toBe("202.50");
    expect(result.tier2Amount).toBe("75.00");
    expect(result.taxableIncome).toBe("1917.50");
    expect(result.payeAmount).toBe("116.75");
    expect(result.netPay).toBe("1800.75");
  });

  it("pensionable vs non-pensionable earning + a recurring deduction", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(3, { amount: "1000.00" });
    comp(3, { componentTypeCode: "housing_allowance", amount: "200.00", pensionable: false });
    comp(3, { category: "deduction", componentTypeCode: "union_dues", amount: "20.00", pensionable: false });

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 3, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    // pensionable = only basic_salary (1000.00); gross = 1000+200 = 1200.00
    // pension = 55.00; taxableBase = 1200-55 = 1145.00 -> band1:0 band2:25.00 band3:145@10%=14.50 -> paye=39.50
    // net = 1200 - 55 - 39.50 - 20(deduction) = 1085.50
    expect(result.pensionableEarnings).toBe("1000.00");
    expect(result.grossEarnings).toBe("1200.00");
    expect(result.employeePensionDeduction).toBe("55.00");
    expect(result.payeAmount).toBe("39.50");
    expect(result.otherDeductions).toBe("20.00");
    expect(result.netPay).toBe("1085.50");
  });

  it("one-off bonus earning + one-off deduction input for this period only", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(4, { amount: "1000.00" });
    fixtures.inputReferenceRows.push(
      { id: 1, organizationId: ORG, payrollPeriodId: 7, employeeId: 4, category: "earning", componentTypeCode: "bonus_oneoff", amount: "300.00", currency: "GHS", taxableTreatment: "bonus" },
      { id: 2, organizationId: ORG, payrollPeriodId: 7, employeeId: 4, category: "deduction", componentTypeCode: "advance_repayment", amount: "50.00", currency: "GHS", taxableTreatment: "ordinary" },
    );

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 4, payrollPeriodId: 7, payDate: new Date("2026-01-15"), currency: "GHS" });
    // annualBasic=12000; bonusThreshold=15%=1800; bonus 300 < threshold -> payeBonus=5%x300=15.00, no excess
    // pension=55.00; ordinaryTaxableBase=1000-55=945 -> band1:0 band2:445@5%=22.25 -> payeOrdinary=22.25
    // payeAmount=22.25+15.00=37.25; gross=1000+300=1300.00; net=1300-55-37.25-50=1157.75
    expect(result.grossEarnings).toBe("1300.00");
    expect(result.payeAmount).toBe("37.25");
    expect(result.otherDeductions).toBe("50.00");
    expect(result.netPay).toBe("1157.75");
    expect(result.components.some((c) => c.source === "one_off" && c.componentTypeCode === "bonus_oneoff")).toBe(true);
  });

  it("a one-off input scoped to a DIFFERENT period is never picked up", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(4, { amount: "1000.00" });
    fixtures.inputReferenceRows.push({ id: 1, organizationId: ORG, payrollPeriodId: 999, employeeId: 4, category: "earning", componentTypeCode: "bonus_oneoff", amount: "300.00", currency: "GHS", taxableTreatment: "bonus" });

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 4, payrollPeriodId: 7, payDate: new Date("2026-01-15"), currency: "GHS" });
    expect(result.grossEarnings).toBe("1000.00");
  });

  it("overtime formula: within-threshold portion at 5%, excess at 10%", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(5, { amount: "1000.00" });
    comp(5, { componentTypeCode: "overtime_pay", amount: "600.00", taxableTreatment: "overtime", pensionable: false });

    const result = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 5, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    // overtimeThreshold=50%x1000=500; within=500@5%=25.00, excess=100@10%=10.00 -> payeOvertime=35.00
    // pension=55.00; ordinaryTaxableBase=945 -> payeOrdinary=22.25; payeAmount=22.25+35=57.25
    // gross=1000+600=1600.00; net=1600-55-57.25-0=1487.75
    expect(result.payeAmount).toBe("57.25");
    expect(result.grossEarnings).toBe("1600.00");
    expect(result.netPay).toBe("1487.75");
  });

  it("effective-date STATUTORY transition: an earlier pay date resolves the version in force then, not the current one", async () => {
    resetFixtures();
    // Old flat-rate PAYE version (2025) superseded by the standard bands (2026).
    fixtures.statutoryVersionRows = [
      { id: 10, ruleType: "paye_bands", status: "approved", effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2026-01-01") },
      { id: 1, ruleType: "paye_bands", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
      { id: 2, ruleType: "pension_rates", status: "approved", effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
      { id: 3, ruleType: "pension_earnings_ceiling", status: "approved", effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
    ];
    fixtures.payeBandRows = [
      { id: 100, statutoryRuleVersionId: 10, bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "10.00" },
      ...STANDARD_BANDS.map((b, i) => ({ id: i + 1, statutoryRuleVersionId: 1, ...b })),
    ];
    fixtures.pensionRateRows = [{ id: 1, statutoryRuleVersionId: 2, employeeRatePercent: "5.50", employerRatePercent: "13.00", tier1AllocationPercent: "13.50", tier2AllocationPercent: "5.00" }];
    fixtures.pensionCeilingRows = [{ id: 1, statutoryRuleVersionId: 3, minimumInsurableEarnings: null, maximumInsurableEarnings: "1500.00" }];
    comp(6, { amount: "1000.00", validFrom: new Date("2025-01-01") });

    const before = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 6, payrollPeriodId: 1, payDate: new Date("2025-06-15"), currency: "GHS" });
    // taxableBase=945.00 @ flat 10% = 94.50
    expect(before.payeBandsVersionId).toBe(10);
    expect(before.payeAmount).toBe("94.50");
    expect(before.netPay).toBe("850.50");

    const after = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 6, payrollPeriodId: 1, payDate: new Date("2026-06-15"), currency: "GHS" });
    // taxableBase=945.00 -> standard bands -> 22.25
    expect(after.payeBandsVersionId).toBe(1);
    expect(after.payeAmount).toBe("22.25");
    expect(after.netPay).toBe("922.75");
  });

  it("effective-date SALARY transition: an earlier pay date resolves the salary in force then, not the current one", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    fixtures.compensationRows.push(
      { id: 1, organizationId: ORG, employeeId: 7, category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", taxableTreatment: "ordinary", pensionable: true, validFrom: new Date("2026-01-01"), validTo: new Date("2026-04-01") },
      { id: 2, organizationId: ORG, employeeId: 7, category: "earning", componentTypeCode: "basic_salary", amount: "1500.00", currency: "GHS", taxableTreatment: "ordinary", pensionable: true, validFrom: new Date("2026-04-01"), validTo: null },
    );

    const before = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 7, payrollPeriodId: 1, payDate: new Date("2026-02-01"), currency: "GHS" });
    expect(before.grossEarnings).toBe("1000.00");
    expect(before.netPay).toBe("922.75");

    const after = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 7, payrollPeriodId: 1, payDate: new Date("2026-05-01"), currency: "GHS" });
    // pensionable=1500.00 (exactly at ceiling, unclamped); pension=82.50; taxableBase=1417.50
    // band1:0 band2:25.00 band3:417.50@10%=41.75 -> paye=66.75; net=1500-82.50-66.75=1350.75
    expect(after.grossEarnings).toBe("1500.00");
    expect(after.payeAmount).toBe("66.75");
    expect(after.netPay).toBe("1350.75");
  });

  it("staff-number reuse: two different employees resolve the same historical staff-number string at their own dates without cross-contaminating amounts", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    fixtures.numberAllocationRows.push(
      { id: 1, organizationId: ORG, employeeId: 8001, employeeNumber: "EMP-100", validFrom: new Date("2026-01-01"), validTo: new Date("2026-03-01") },
      { id: 2, organizationId: ORG, employeeId: 8002, employeeNumber: "EMP-100", validFrom: new Date("2026-03-01"), validTo: null },
    );
    comp(8001, { amount: "800.00" });
    comp(8002, { amount: "900.00" });

    const former = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 8001, payrollPeriodId: 1, payDate: new Date("2026-02-01"), currency: "GHS" });
    expect(former.staffNumberSnapshot).toBe("EMP-100");
    // pension=44.00; taxableBase=756.00 -> band1:0 band2:256@5%=12.80 -> paye=12.80; net=800-44-12.80=743.20
    expect(former.payeAmount).toBe("12.80");
    expect(former.netPay).toBe("743.20");

    const current = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 8002, payrollPeriodId: 1, payDate: new Date("2026-04-01"), currency: "GHS" });
    expect(current.staffNumberSnapshot).toBe("EMP-100");
    // pension=49.50; taxableBase=850.50 -> band1:0 band2:350.50@5%=17.525 -> ties to 17.53 (rounding boundary)
    expect(current.payeAmount).toBe("17.53");
    expect(current.netPay).toBe("832.97");

    // Same staff-number STRING, but the two calculations never share a single amount — proving employees.id, not the staff number, is the real identity.
    expect(former.netPay).not.toBe(current.netPay);
  });

  it("repeated calculation is deterministic: identical inputs produce a byte-identical result", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(9, { amount: "1234.56" });

    const first = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 9, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    const second = await calculateEmployeePayroll({ organizationId: ORG, employeeId: 9, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" });
    expect(second).toEqual(first);
  });
});

describe("calculateEmployeePayroll — validation (§P)", () => {
  it("throws NoCompensationAssignedError when the employee has no compensation or one-off inputs", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    await expect(calculateEmployeePayroll({ organizationId: ORG, employeeId: 42, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" })).rejects.toThrow(NoCompensationAssignedError);
  });

  it("throws MissingStatutoryRuleError when no approved PAYE-bands version covers the pay date", async () => {
    resetFixtures();
    comp(10, { amount: "1000.00" });
    await expect(calculateEmployeePayroll({ organizationId: ORG, employeeId: 10, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" })).rejects.toThrow(MissingStatutoryRuleError);
  });

  it("throws UnresolvedComponentTreatmentError for a benefit_in_kind component rather than silently omitting it", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(11, { componentTypeCode: "company_car", taxableTreatment: "benefit_in_kind" });
    await expect(calculateEmployeePayroll({ organizationId: ORG, employeeId: 11, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" })).rejects.toThrow(UnresolvedComponentTreatmentError);
  });

  it("throws CurrencyMismatchError when a component's currency does not match the calculation currency", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(12, { currency: "USD" });
    await expect(calculateEmployeePayroll({ organizationId: ORG, employeeId: 12, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" })).rejects.toThrow(CurrencyMismatchError);
  });

  it("throws DuplicateCompensationComponentError if the resolver ever returns two open rows for the same component (data-integrity defense)", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    comp(13, { id: 1 });
    comp(13, { id: 2 });
    await expect(calculateEmployeePayroll({ organizationId: ORG, employeeId: 13, payrollPeriodId: 1, payDate: new Date("2026-01-15"), currency: "GHS" })).rejects.toThrow(DuplicateCompensationComponentError);
  });
});
