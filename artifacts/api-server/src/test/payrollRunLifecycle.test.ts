/**
 * Payroll, Workstream 4 — Approval, Finalization/Locking & Corrections.
 * Calls the lib functions directly (no HTTP layer — permission/module
 * gating is exercised in the live QA and in payrollPeriodsAndRuns.test.ts's
 * established pattern, not duplicated here). Every fixture statutory rule
 * is disposable test data, never a real Ghana figure.
 */
import { describe, it, expect, vi } from "vitest";

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { cause?: { code: string } };
  err.cause = { code: "23505" };
  return err;
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
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
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
      periodRows: [] as Record<string, unknown>[],
      runRows: [] as Record<string, unknown>[],
      runLineRows: [] as Record<string, unknown>[],
      runLineComponentRows: [] as Record<string, unknown>[],
      correctionRows: [] as Record<string, unknown>[],
      correctionComponentRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    employeeCompensationComponentsTable: mockTable("employee_compensation_components", [
      "id", "organizationId", "employeeId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment", "pensionable", "validFrom", "validTo",
    ]),
    payrollInputReferencesTable: mockTable("payroll_input_references", ["id", "organizationId", "payrollPeriodId", "employeeId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment"]),
    payrollStatutoryRuleVersionsTable: mockTable("payroll_statutory_rule_versions", ["id", "ruleType", "status", "effectiveFrom", "effectiveTo"]),
    payrollPayeBandsTable: mockTable("payroll_paye_bands", ["id", "statutoryRuleVersionId", "bandOrder", "taxpayerCategory", "thresholdAmount", "ratePercent"]),
    payrollPensionRatesTable: mockTable("payroll_pension_rates", ["id", "statutoryRuleVersionId", "employeeRatePercent", "employerRatePercent", "tier1AllocationPercent", "tier2AllocationPercent"]),
    payrollPensionEarningsCeilingTable: mockTable("payroll_pension_earnings_ceiling", ["id", "statutoryRuleVersionId", "minimumInsurableEarnings", "maximumInsurableEarnings"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "validFrom", "validTo"]),
    payrollPeriodsTable: mockTable("payroll_periods", ["id", "organizationId", "frequency", "periodKey", "startDate", "endDate", "payDate"]),
    payrollRunsTable: mockTable("payroll_runs", ["id", "organizationId", "payrollPeriodId", "status", "preparedByMembershipId", "approvedByMembershipId", "lockedAt", "calculatedAt"]),
    payrollRunLinesTable: mockTable("payroll_run_lines", ["id", "organizationId", "payrollRunId", "employeeId", "staffNumberSnapshot", "netPay", "currency"]),
    payrollRunLineComponentsTable: mockTable("payroll_run_line_components", ["id", "payrollRunLineId"]),
    payrollCorrectionsTable: mockTable("payroll_corrections", ["id", "organizationId", "originalRunId", "originalRunLineId", "employeeId", "status", "createdByMembershipId", "approvedByMembershipId"]),
    payrollCorrectionComponentsTable: mockTable("payroll_correction_components", ["id", "payrollCorrectionId"]),
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
    case "payroll_periods": return fixtures.periodRows;
    case "payroll_runs": return fixtures.runRows;
    case "payroll_run_lines": return fixtures.runLineRows;
    case "payroll_run_line_components": return fixtures.runLineComponentRows;
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_correction_components": return fixtures.correctionComponentRows;
    default: return [];
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  switch (table.__name) {
    case "payroll_runs": fixtures.runRows = rows; break;
    case "payroll_corrections": fixtures.correctionRows = rows; break;
  }
}

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const isCount = proj && "count" in proj;
          const resolved = isCount ? ([{ count: current.length }] as unknown as Record<string, unknown>[]) : current;
          const promise = Promise.resolve(resolved);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(v) ? v : [v];
        if (table === payrollCorrectionsTable) {
          for (const item of arr) {
            const openDraft = fixtures.correctionRows.find((r) => r.originalRunLineId === item.originalRunLineId && r.status === "draft");
            if (openDraft) throw uniqueViolation();
          }
        }
        const rows = arr.map((item) => ({ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "draft", ...item }));
        setRowsFor(table, [...rowsFor(table), ...rows]);
        if (table === payrollRunLinesTable) fixtures.runLineRows = [...fixtures.runLineRows, ...rows];
        if (table === payrollRunLineComponentsTable) fixtures.runLineComponentRows = [...fixtures.runLineComponentRows, ...rows];
        if (table === payrollCorrectionComponentsTable) fixtures.correctionComponentRows = [...fixtures.correctionComponentRows, ...rows];
        return { returning: () => Promise.resolve(rows) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = rowsFor(table);
          const updated: Record<string, unknown>[] = [];
          const next = rows.map((r) => {
            if (matches(r, cond)) {
              const merged = { ...r, ...patch };
              updated.push(merged);
              return merged;
            }
            return r;
          });
          setRowsFor(table, next);
          return { returning: () => Promise.resolve(updated) };
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where(cond: Cond) {
        const rows = rowsFor(table);
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        return Promise.resolve();
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
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
  payrollPeriodsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: () => undefined,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const {
  approvePayrollRun,
  lockPayrollRun,
  calculatePayrollRun,
  PayrollRunNotCalculatedError,
  PayrollRunNotApprovedError,
  PayrollRunNoLinesError,
  PayrollRunSelfApprovalError,
  PayrollRunNotEditableError,
} = await import("../lib/payrollRuns");
const {
  createPayrollCorrection,
  approvePayrollCorrection,
  PayrollRunNotLockedError,
  PayrollCorrectionAlreadyOpenError,
  PayrollCorrectionSelfApprovalError,
} = await import("../lib/payrollCorrections");

const ORG = 1;
const PREPARER = 100;
const APPROVER = 200;
const LOCKER = 300;

function resetFixtures() {
  fixtures.compensationRows = [];
  fixtures.inputReferenceRows = [];
  fixtures.statutoryVersionRows = [];
  fixtures.payeBandRows = [];
  fixtures.pensionRateRows = [];
  fixtures.pensionCeilingRows = [];
  fixtures.numberAllocationRows = [];
  fixtures.periodRows = [];
  fixtures.runRows = [];
  fixtures.runLineRows = [];
  fixtures.runLineComponentRows = [];
  fixtures.correctionRows = [];
  fixtures.correctionComponentRows = [];
  fixtures.idCounters = new Map();
}

const STANDARD_BANDS = [
  { bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "500.00", ratePercent: "0.00" },
  { bandOrder: 2, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "10.00" },
];

function setupStandardStatutoryRules() {
  fixtures.statutoryVersionRows = [
    { id: 1, ruleType: "paye_bands", status: "approved", effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
    { id: 2, ruleType: "pension_rates", status: "approved", effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
    { id: 3, ruleType: "pension_earnings_ceiling", status: "approved", effectiveFrom: new Date("2020-01-01"), effectiveTo: null },
  ];
  fixtures.payeBandRows = STANDARD_BANDS.map((b, i) => ({ id: i + 1, statutoryRuleVersionId: 1, ...b }));
  fixtures.pensionRateRows = [{ id: 1, statutoryRuleVersionId: 2, employeeRatePercent: "5.50", employerRatePercent: "13.00", tier1AllocationPercent: "13.50", tier2AllocationPercent: "5.00" }];
  fixtures.pensionCeilingRows = [{ id: 1, statutoryRuleVersionId: 3, minimumInsurableEarnings: null, maximumInsurableEarnings: null }];
}

function makePeriod(id: number, payDate: string) {
  fixtures.periodRows.push({ id, organizationId: ORG, frequency: "monthly", periodKey: `p${id}`, startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01"), payDate: new Date(payDate) });
}

function makeRun(id: number, periodId: number, status: string, preparedByMembershipId: number | null = PREPARER) {
  fixtures.runRows.push({ id, organizationId: ORG, payrollPeriodId: periodId, status, preparedByMembershipId, approvedByMembershipId: null, lockedAt: null, calculatedAt: new Date() });
}

function makeRunLine(id: number, runId: number, employeeId: number, netPay = "922.75") {
  fixtures.runLineRows.push({ id, organizationId: ORG, payrollRunId: runId, employeeId, staffNumberSnapshot: "EMP-1", netPay, currency: "GHS" });
}

function comp(employeeId: number, amount = "1000.00") {
  fixtures.compensationRows.push({
    id: fixtures.compensationRows.length + 1, organizationId: ORG, employeeId, category: "earning", componentTypeCode: "basic_salary",
    amount, currency: "GHS", taxableTreatment: "ordinary", pensionable: true, validFrom: new Date("2020-01-01"), validTo: null,
  });
}

describe("approvePayrollRun", () => {
  it("rejects a run that is not exactly 'calculated'", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "draft");
    await expect(approvePayrollRun({ organizationId: ORG, payrollRunId: 1, approverMembershipId: APPROVER })).rejects.toThrow(PayrollRunNotCalculatedError);
  });

  it("rejects self-approval by the membership that prepared the run", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "calculated");
    makeRunLine(1, 1, 501);
    await expect(approvePayrollRun({ organizationId: ORG, payrollRunId: 1, approverMembershipId: PREPARER })).rejects.toThrow(PayrollRunSelfApprovalError);
  });

  it("rejects approval of a run with zero lines", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "calculated");
    await expect(approvePayrollRun({ organizationId: ORG, payrollRunId: 1, approverMembershipId: APPROVER })).rejects.toThrow(PayrollRunNoLinesError);
  });

  it("approves a valid calculated run with a different actor", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "calculated");
    makeRunLine(1, 1, 501);
    const approved = await approvePayrollRun({ organizationId: ORG, payrollRunId: 1, approverMembershipId: APPROVER });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByMembershipId).toBe(APPROVER);
  });
});

describe("lockPayrollRun", () => {
  it("rejects a run that is not exactly 'approved'", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "calculated");
    await expect(lockPayrollRun({ organizationId: ORG, payrollRunId: 1, actorMembershipId: LOCKER })).rejects.toThrow(PayrollRunNotApprovedError);
  });

  it("rejects finalization by the membership that prepared the run", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "approved");
    await expect(lockPayrollRun({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER })).rejects.toThrow(PayrollRunSelfApprovalError);
  });

  it("locks a valid approved run", async () => {
    resetFixtures();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "approved");
    const locked = await lockPayrollRun({ organizationId: ORG, payrollRunId: 1, actorMembershipId: LOCKER });
    expect(locked.status).toBe("locked");
    expect(locked.lockedAt).toBeInstanceOf(Date);
  });
});

describe("calculatePayrollRun — lock invariant", () => {
  it("rejects recalculation once the run is approved", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "approved");
    await expect(calculatePayrollRun({ organizationId: ORG, payrollRunId: 1, currency: "GHS" })).rejects.toThrow(PayrollRunNotEditableError);
  });

  it("rejects recalculation once the run is locked", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "locked");
    await expect(calculatePayrollRun({ organizationId: ORG, payrollRunId: 1, currency: "GHS" })).rejects.toThrow(PayrollRunNotEditableError);
  });
});

describe("payroll corrections", () => {
  it("rejects creating a correction against a run that is not locked", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "calculated");
    makeRunLine(1, 1, 501);
    comp(501, "1000.00");
    await expect(createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "test", actorMembershipId: PREPARER })).rejects.toThrow(PayrollRunNotLockedError);
  });

  it("SNAPSHOT PRESERVATION: creates a correction reflecting a salary change made AFTER locking, while the original run line stays untouched", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "locked");
    makeRunLine(1, 1, 501, "922.75"); // original: basic_salary 1000.00 -> pension 55.00, PAYE band1:0 band2:445@10%=44.50 -> net 900.50... but stored as 922.75 to prove the ORIGINAL is never recomputed
    comp(501, "1000.00");

    // Salary changes AFTER the run was locked — the correction must pick this up; the original line (netPay stored above) must remain untouched.
    fixtures.compensationRows[0].amount = "1500.00";

    const correction = await createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "salary was under-entered", actorMembershipId: PREPARER });
    // pension=5.5%x1500=82.50; taxableBase=1417.50 -> band1:0 band2:917.50+500=... band1 width500@0=0,rem=917.50->band2(open)@10%=91.75 -> paye=91.75
    // net = 1500-82.50-91.75 = 1325.75
    expect(correction.netPay).toBe("1325.75");
    expect(correction.status).toBe("draft");
    // Original run line's own stored netPay is never touched by creating a correction.
    const originalLine = fixtures.runLineRows.find((l) => l.id === 1);
    expect(originalLine!.netPay).toBe("922.75");
    expect(correction.netPayDelta).toBe(fixtures.correctionRows[0].netPayDelta);
  });

  it("rejects a second simultaneous draft correction for the same run line", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "locked");
    makeRunLine(1, 1, 501, "922.75");
    comp(501, "1000.00");

    await createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "first", actorMembershipId: PREPARER });
    await expect(createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "second", actorMembershipId: PREPARER })).rejects.toThrow(PayrollCorrectionAlreadyOpenError);
  });

  it("rejects self-approval of a correction by its own creator", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "locked");
    makeRunLine(1, 1, 501, "922.75");
    comp(501, "1000.00");

    const correction = await createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "test", actorMembershipId: PREPARER });
    await expect(approvePayrollCorrection({ organizationId: ORG, correctionId: correction.id, approverMembershipId: PREPARER })).rejects.toThrow(PayrollCorrectionSelfApprovalError);
  });

  it("approves a correction with a genuinely different actor", async () => {
    resetFixtures();
    setupStandardStatutoryRules();
    makePeriod(1, "2026-01-31");
    makeRun(1, 1, "locked");
    makeRunLine(1, 1, 501, "922.75");
    comp(501, "1000.00");

    const correction = await createPayrollCorrection({ organizationId: ORG, originalRunId: 1, originalRunLineId: 1, reason: "test", actorMembershipId: PREPARER });
    const approved = await approvePayrollCorrection({ organizationId: ORG, correctionId: correction.id, approverMembershipId: APPROVER });
    expect(approved.status).toBe("approved");
    expect(approved.approvedByMembershipId).toBe(APPROVER);
  });
});
