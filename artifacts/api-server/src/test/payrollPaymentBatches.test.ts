/**
 * Payroll, Frozen Workstream 8 — Payment Batches. Calls the lib functions
 * directly (no HTTP layer — permission/module gating and audit recording
 * are exercised in payrollPaymentBatchesHttp.test.ts and the live QA, not
 * duplicated here). Every fixture value is disposable test data.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { cause?: { code: string } };
  err.cause = { code: "23505" };
  return err;
}

const {
  fixtures,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollCorrectionsTable,
  payrollPaymentBatchesTable,
  payrollPaymentBatchLinesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  masterDataItemsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      runRows: [] as Record<string, unknown>[],
      runLineRows: [] as Record<string, unknown>[],
      correctionRows: [] as Record<string, unknown>[],
      batchRows: [] as Record<string, unknown>[],
      batchLineRows: [] as Record<string, unknown>[],
      bankingRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    payrollRunsTable: mockTable("payroll_runs", ["id", "organizationId", "payrollPeriodId", "status"]),
    payrollRunLinesTable: mockTable("payroll_run_lines", ["id", "organizationId", "payrollRunId", "employeeId", "staffNumberSnapshot", "netPay", "currency"]),
    payrollCorrectionsTable: mockTable("payroll_corrections", ["id", "organizationId", "originalRunLineId", "status", "netPay", "approvedAt"]),
    payrollPaymentBatchesTable: mockTable("payroll_payment_batches", [
      "id", "organizationId", "payrollRunId", "paymentMethod", "reference", "status", "currency", "totalAmount", "employeeCount",
      "createdByMembershipId", "createdAt", "exportedAt", "exportedByMembershipId", "updatedAt",
    ]),
    payrollPaymentBatchLinesTable: mockTable("payroll_payment_batch_lines", [
      "id", "paymentBatchId", "organizationId", "payrollRunLineId", "sourceCorrectionId", "employeeId", "staffNumberSnapshot",
      "amount", "currency", "bankCode", "accountNumber", "accountName", "branch", "paymentReference", "createdAt",
    ]),
    employeeBankingDetailsTable: mockTable("employee_banking_details", ["id", "organizationId", "employeeId", "bankCode", "accountNumber", "accountName", "branch", "validFrom", "validTo"]),
    employeeStatutoryIdentifiersTable: mockTable("employee_statutory_identifiers", ["id", "organizationId", "employeeId", "ssnitNumber", "tin", "validFrom", "validTo"]),
    masterDataItemsTable: mockTable("master_data_items", ["id", "domain", "code", "status", "organizationId"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "payroll_runs": return fixtures.runRows;
    case "payroll_run_lines": return fixtures.runLineRows;
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_payment_batches": return fixtures.batchRows;
    case "payroll_payment_batch_lines": return fixtures.batchLineRows;
    case "employee_banking_details": return fixtures.bankingRows;
    default: return [];
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  switch (table.__name) {
    case "payroll_payment_batches": fixtures.batchRows = rows; break;
    case "payroll_payment_batch_lines": fixtures.batchLineRows = rows; break;
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
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage([...current].sort((a, b) => {
              const av = a["approvedAt"] as Date | null, bv = b["approvedAt"] as Date | null;
              if (!av && !bv) return 0;
              if (!av) return 1;
              if (!bv) return -1;
              return bv.getTime() - av.getTime();
            })),
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
        if (table === payrollPaymentBatchesTable) {
          for (const item of arr) {
            const dup = fixtures.batchRows.find((r) => r.payrollRunId === item.payrollRunId);
            if (dup) throw uniqueViolation();
          }
        }
        const rows = arr.map((item) => ({ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), exportedAt: null, exportedByMembershipId: null, ...item }));
        setRowsFor(table, [...rowsFor(table), ...rows]);
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
        const toDelete = rows.filter((r) => matches(r, cond));
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        if (table === payrollPaymentBatchesTable) {
          const deletedIds = new Set(toDelete.map((r) => r.id));
          fixtures.batchLineRows = fixtures.batchLineRows.filter((l) => !deletedIds.has(l.paymentBatchId));
        }
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
  payrollRunsTable,
  payrollRunLinesTable,
  payrollCorrectionsTable,
  payrollPaymentBatchesTable,
  payrollPaymentBatchLinesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  masterDataItemsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  desc: () => undefined,
}));

const {
  createPaymentBatch,
  deletePaymentBatch,
  exportPaymentBatch,
  maskAccountNumber,
  PayrollRunNotFoundError,
  PayrollRunNotLockedError,
  PayrollPaymentBatchAlreadyExistsError,
  PayrollPaymentBatchNoEligibleLinesError,
  PayrollPaymentBatchMissingBankingError,
  PayrollPaymentBatchNotFoundError,
  PayrollPaymentBatchNotDraftError,
} = await import("../lib/payrollPaymentBatches");

const ORG = 1;
const PREPARER = 100;
const EXPORTER = 200;

function resetFixtures() {
  fixtures.runRows = [];
  fixtures.runLineRows = [];
  fixtures.correctionRows = [];
  fixtures.batchRows = [];
  fixtures.batchLineRows = [];
  fixtures.bankingRows = [];
  fixtures.idCounters = new Map();
}

function makeRun(id: number, status: string) {
  fixtures.runRows.push({ id, organizationId: ORG, payrollPeriodId: 1, status });
}
function makeRunLine(id: number, runId: number, employeeId: number, netPay: string) {
  fixtures.runLineRows.push({ id, organizationId: ORG, payrollRunId: runId, employeeId, staffNumberSnapshot: `EMP-${employeeId}`, netPay, currency: "GHS" });
}
function makeBanking(employeeId: number, accountNumber = "0123456789") {
  fixtures.bankingRows.push({ id: employeeId, organizationId: ORG, employeeId, bankCode: "GCB", accountNumber, accountName: "Test Employee", branch: "Accra Main", validFrom: new Date("2020-01-01"), validTo: null });
}

describe("createPaymentBatch", () => {
  it("rejects a run that is not locked", async () => {
    resetFixtures();
    makeRun(1, "approved");
    await expect(createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER })).rejects.toThrow(PayrollRunNotLockedError);
  });

  it("returns 'not found' for a nonexistent run", async () => {
    resetFixtures();
    await expect(createPaymentBatch({ organizationId: ORG, payrollRunId: 999, actorMembershipId: PREPARER })).rejects.toThrow(PayrollRunNotFoundError);
  });

  it("DUPLICATE PROTECTION: rejects a second batch for a run that already has one", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    await expect(createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER })).rejects.toThrow(PayrollPaymentBatchAlreadyExistsError);
  });

  it("ELIGIBILITY: excludes zero and negative net pay lines, reporting them, and reconciles the total to only the eligible lines", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeRunLine(2, 1, 502, "0.00");
    makeRunLine(3, 1, 503, "-50.00");
    makeBanking(501);
    makeBanking(502);
    makeBanking(503);

    const result = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].employeeId).toBe(501);
    expect(result.batch.totalAmount).toBe("900.00");
    expect(result.batch.employeeCount).toBe(1);
    expect(result.excludedLines).toHaveLength(2);
    expect(result.excludedLines.find((e) => e.employeeId === 502)!.reason).toBe("zero_net_pay");
    expect(result.excludedLines.find((e) => e.employeeId === 503)!.reason).toBe("negative_net_pay");
  });

  it("rejects with 'no eligible lines' when every line is zero/negative", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "0.00");
    await expect(createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER })).rejects.toThrow(PayrollPaymentBatchNoEligibleLinesError);
  });

  it("BANKING VALIDATION: fails entirely (all-or-nothing) when an eligible employee has no banking details on file, listing the missing employeeId", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeRunLine(2, 1, 502, "800.00");
    makeBanking(501); // 502 has none
    try {
      await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(PayrollPaymentBatchMissingBankingError);
      expect((err as InstanceType<typeof PayrollPaymentBatchMissingBankingError>).employeeIds).toEqual([502]);
    }
    // Nothing partial was created.
    expect(fixtures.batchRows).toHaveLength(0);
  });

  it("CORRECTION-AWARE: uses the latest approved correction's net pay as the effective amount, and records the source correction", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    fixtures.correctionRows.push({ id: 7, organizationId: ORG, originalRunLineId: 1, status: "approved", netPay: "1250.00", approvedAt: new Date("2026-02-01") });

    const result = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    expect(result.lines[0].amount).toBe("1250.00");
    expect(result.lines[0].sourceCorrectionId).toBe(7);
    expect(result.batch.totalAmount).toBe("1250.00");
  });

  it("a DRAFT (unapproved) correction is never used for the effective amount", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    fixtures.correctionRows.push({ id: 7, organizationId: ORG, originalRunLineId: 1, status: "draft", netPay: "1250.00", approvedAt: null });

    const result = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    expect(result.lines[0].amount).toBe("900.00");
    expect(result.lines[0].sourceCorrectionId).toBeNull();
  });

  it("BANKING SNAPSHOT: copies the currently-open banking record at creation time and each batch line carries a collision-safe payment reference", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501, "9988776655");

    const result = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    expect(result.lines[0].accountNumber).toBe("9988776655");
    expect(result.lines[0].bankCode).toBe("GCB");
    expect(result.lines[0].paymentReference).toContain(result.batch.reference);
    expect(result.lines[0].staffNumberSnapshot).toBe("EMP-501");
  });
});

describe("deletePaymentBatch", () => {
  it("deletes a draft batch", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    const { batch } = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    await deletePaymentBatch(ORG, batch.id);
    expect(fixtures.batchRows).toHaveLength(0);
    expect(fixtures.batchLineRows).toHaveLength(0);
  });

  it("rejects deleting an already-exported batch", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    const { batch } = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });
    await exportPaymentBatch({ organizationId: ORG, id: batch.id, actorMembershipId: EXPORTER });
    await expect(deletePaymentBatch(ORG, batch.id)).rejects.toThrow(PayrollPaymentBatchNotDraftError);
  });

  it("'not found' for a nonexistent batch", async () => {
    resetFixtures();
    await expect(deletePaymentBatch(ORG, 999)).rejects.toThrow(PayrollPaymentBatchNotFoundError);
  });
});

describe("exportPaymentBatch", () => {
  it("transitions draft -> exported exactly once, recording exportedAt/exportedByMembershipId", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    const { batch } = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });

    const result = await exportPaymentBatch({ organizationId: ORG, id: batch.id, actorMembershipId: EXPORTER });
    expect(result.wasAlreadyExported).toBe(false);
    expect(result.batch.status).toBe("exported");
    expect(result.batch.exportedByMembershipId).toBe(EXPORTER);
    expect(result.batch.exportedAt).toBeInstanceOf(Date);
  });

  it("NON-MUTATING RE-DOWNLOAD: a repeat export call performs no further mutation and re-serves identical content", async () => {
    resetFixtures();
    makeRun(1, "locked");
    makeRunLine(1, 1, 501, "900.00");
    makeBanking(501);
    const { batch } = await createPaymentBatch({ organizationId: ORG, payrollRunId: 1, actorMembershipId: PREPARER });

    const first = await exportPaymentBatch({ organizationId: ORG, id: batch.id, actorMembershipId: EXPORTER });
    const second = await exportPaymentBatch({ organizationId: ORG, id: batch.id, actorMembershipId: 999 });
    expect(second.wasAlreadyExported).toBe(true);
    expect(second.batch.exportedByMembershipId).toBe(first.batch.exportedByMembershipId); // unchanged by the second, different actor
    expect(second.lines).toEqual(first.lines);
  });
});

describe("maskAccountNumber", () => {
  it("keeps only the last 4 characters visible", () => {
    expect(maskAccountNumber("9988776655")).toBe("******6655");
  });
  it("masks fully when the value is 4 characters or fewer", () => {
    expect(maskAccountNumber("123")).toBe("***");
  });
});

describe("architectural regression: no live recalculation", () => {
  it("payrollPaymentBatches.ts never imports the live calculation engine", () => {
    const content = readFileSync(join(__dirname, "..", "lib", "payrollPaymentBatches.ts"), "utf-8");
    expect(content).not.toMatch(/from ["']\.\/payrollCalculation["']/);
    expect(content).not.toMatch(/\bcalculateEmployeePayroll\s*\(/);
  });
});
