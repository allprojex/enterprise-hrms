/**
 * Payroll, Workstream 3 — Payroll Periods & Runs (HTTP boundary)
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.3, §9.5, §13). Mirrors the
 * established Cond-matching mocked-db harness (W1/W2). Exercises
 * auth/module/permission gating, period/run collision handling, and the
 * calculate endpoint's success/validation-failure paths. The exact
 * calculation math itself is covered by payrollCalculation.test.ts; genuine
 * concurrency is proven in live QA, not here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  organizationSettingsTable,
  auditEventsTable,
  employeesTable,
  masterDataItemsTable,
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
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      orgModuleRows: [] as Record<string, unknown>[],
      orgSettingsRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      masterDataItemRows: [] as Record<string, unknown>[],
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
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "data"]),
    auditEventsTable: mockTable("audit_events", []),
    employeesTable: mockTable("employees", ["id", "organizationId", "hireDate", "separationDate", "employmentStatus"]),
    masterDataItemsTable: mockTable("master_data_items", ["id", "domain", "organizationId", "code", "label", "status"]),
    employeeCompensationComponentsTable: mockTable("employee_compensation_components", [
      "id", "organizationId", "employeeId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment", "pensionable", "validFrom", "validTo",
    ]),
    payrollInputReferencesTable: mockTable("payroll_input_references", [
      "id", "organizationId", "payrollPeriodId", "employeeId", "sourceType", "sourceId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment", "description",
    ]),
    payrollStatutoryRuleVersionsTable: mockTable("payroll_statutory_rule_versions", ["id", "ruleType", "status", "effectiveFrom", "effectiveTo"]),
    payrollPayeBandsTable: mockTable("payroll_paye_bands", ["id", "statutoryRuleVersionId", "bandOrder", "taxpayerCategory", "thresholdAmount", "ratePercent"]),
    payrollPensionRatesTable: mockTable("payroll_pension_rates", ["id", "statutoryRuleVersionId", "employeeRatePercent", "employerRatePercent", "tier1AllocationPercent", "tier2AllocationPercent"]),
    payrollPensionEarningsCeilingTable: mockTable("payroll_pension_earnings_ceiling", ["id", "statutoryRuleVersionId", "minimumInsurableEarnings", "maximumInsurableEarnings"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "validFrom", "validTo"]),
    payrollPeriodsTable: mockTable("payroll_periods", ["id", "organizationId", "frequency", "periodKey", "startDate", "endDate", "payDate"]),
    payrollRunsTable: mockTable("payroll_runs", ["id", "organizationId", "payrollPeriodId", "status", "preparedByMembershipId", "approvedByMembershipId", "lockedAt", "calculatedAt"]),
    payrollRunLinesTable: mockTable("payroll_run_lines", ["id", "organizationId", "payrollRunId", "employeeId"]),
    payrollRunLineComponentsTable: mockTable("payroll_run_line_components", ["id", "payrollRunLineId"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "organization_memberships": return fixtures.membershipRows;
    case "membership_roles": return fixtures.membershipRoleRows as never;
    case "role_permissions": return fixtures.permissionRows as never;
    case "modules": return fixtures.moduleRows;
    case "organization_modules": return fixtures.orgModuleRows;
    case "organization_settings": return fixtures.orgSettingsRows;
    case "audit_events": return fixtures.auditRows;
    case "employees": return fixtures.employeeRows;
    case "master_data_items": return fixtures.masterDataItemRows;
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
    default: return fixtures.sessionRows;
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  switch (table.__name) {
    case "payroll_periods": fixtures.periodRows = rows; break;
    case "payroll_runs": fixtures.runRows = rows; break;
    case "payroll_run_lines": fixtures.runLineRows = rows; break;
    case "payroll_run_line_components": fixtures.runLineComponentRows = rows; break;
    case "payroll_input_references": fixtures.inputReferenceRows = rows; break;
    case "audit_events": fixtures.auditRows = rows; break;
  }
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const stage = (current: Record<string, unknown>[]) => ({
            innerJoin: () => stage(current),
            where: (cond: Cond) => stage(current.filter((r) => matches((r as { session: Record<string, unknown> }).session, cond))),
            limit: (n: number) => Promise.resolve(current.slice(0, n)),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(current).then(resolve, reject),
          });
          return stage(fixtures.sessionRows);
        }
        if (table === membershipRolesTable) {
          const rows = fixtures.membershipRoleRows;
          return { where: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
        }
        if (table === rolePermissionsTable) {
          const rows = fixtures.permissionRows;
          const b = { innerJoin: () => b, where: () => b, then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
          return b;
        }
        if (table === modulesTable || table === organizationModulesTable) {
          const rows = rowsFor(table);
          return { where: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
        }
        if (table === organizationSettingsTable) {
          const rows = fixtures.orgSettingsRows;
          return { where: (cond: Cond) => ({ limit: () => Promise.resolve(rows.filter((r) => matches(r, cond))) }) };
        }

        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            limit: (n: number) => stage(current.slice(0, n)),
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
        const rows = arr.map((item) => ({ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "draft", ...item }));
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
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        return Promise.resolve();
      },
    }),
    execute: () => Promise.resolve({ rows: [] }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const dbMock = makeQueryClient();

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  organizationSettingsTable,
  auditEventsTable,
  employeesTable,
  masterDataItemsTable,
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
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: string) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val: null }),
  gt: () => undefined,
  ilike: () => undefined,
  desc: () => undefined,
  count: () => "count",
  inArray: () => undefined,
  like: () => undefined,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "hr@example.com", firstName: "HR", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(organizationId = ORG_ID, membershipId = 5, userId = 1) {
  fixtures.membershipRows.push({ id: membershipId, applicationUserId: userId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockPayrollModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 99, key: "payroll", requiredModuleKeys: [] }];
  fixtures.orgModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 99, enabled: true }] : [];
}

function mockEmployee(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  fixtures.employeeRows.push({ id, organizationId: ORG_ID, hireDate: new Date("2025-01-01"), separationDate: null, employmentStatus: "active", ...overrides });
}

function setupStandardStatutoryRules() {
  fixtures.statutoryVersionRows = [
    { id: 1, ruleType: "paye_bands", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
    { id: 2, ruleType: "pension_rates", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
    { id: 3, ruleType: "pension_earnings_ceiling", status: "approved", effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
  ];
  fixtures.payeBandRows = [
    { id: 1, statutoryRuleVersionId: 1, bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "500.00", ratePercent: "0.00" },
    { id: 2, statutoryRuleVersionId: 1, bandOrder: 2, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "10.00" },
  ];
  fixtures.pensionRateRows = [{ id: 1, statutoryRuleVersionId: 2, employeeRatePercent: "5.50", employerRatePercent: "13.00", tier1AllocationPercent: "13.50", tier2AllocationPercent: "5.00" }];
  fixtures.pensionCeilingRows = [{ id: 1, statutoryRuleVersionId: 3, minimumInsurableEarnings: null, maximumInsurableEarnings: null }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.orgSettingsRows = [];
  fixtures.auditRows = [];
  fixtures.employeeRows = [];
  fixtures.masterDataItemRows = [];
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
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  mockPayrollModuleEnabled(true);
});

describe("POST /api/organizations/:organizationId/payroll/periods", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/periods`).send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when the payroll module is not enabled", async () => {
    mockPayrollModuleEnabled(false);
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    expect(res.status).toBe(403);
  });

  it("returns 403 without payroll.run.prepare — ordinary employee.write does NOT grant it", async () => {
    mockPermissions(["employee.write"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    expect(res.status).toBe(403);
  });

  it("creates a monthly payroll period", async () => {
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    expect(res.status).toBe(201);
    expect(res.body.periodKey).toBe("2026-01");
  });

  it("rejects endDate not after startDate with 400", async () => {
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-02-01", endDate: "2026-01-01", payDate: "2026-01-31" });
    expect(res.status).toBe(400);
  });

  it("rejects a second period whose date range overlaps an existing one for the same frequency, with 409", async () => {
    mockPermissions(["payroll.run.prepare"]);
    await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-15", endDate: "2026-02-15", payDate: "2026-02-10" });
    expect(res.status).toBe(409);
  });

  it("allows two non-overlapping consecutive periods", async () => {
    mockPermissions(["payroll.run.prepare"]);
    const first = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-02-01", endDate: "2026-03-01", payDate: "2026-02-28" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

describe("Payroll runs — creation, collision, and calculation", () => {
  async function createPeriod(): Promise<number> {
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    return res.body.id;
  }

  it("creates a draft run for a period", async () => {
    const periodId = await createPeriod();
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
  });

  it("returns 404 when creating a run for a nonexistent period", async () => {
    mockPermissions(["payroll.run.prepare"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: 99999 });
    expect(res.status).toBe(404);
  });

  it("rejects a second run for the same period with 409", async () => {
    const periodId = await createPeriod();
    mockPermissions(["payroll.run.prepare"]);
    await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    expect(res.status).toBe(409);
  });

  it("returns 400 (no eligible employees) when calculating a period with nobody hired yet", async () => {
    const periodId = await createPeriod();
    mockPermissions(["payroll.run.prepare"]);
    const run = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/${run.body.id}/calculate`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 422 with structured employeeErrors when an eligible employee has no statutory rule resolvable", async () => {
    const periodId = await createPeriod();
    mockEmployee(501);
    fixtures.compensationRows.push({
      id: 1, organizationId: ORG_ID, employeeId: 501, category: "earning", componentTypeCode: "basic_salary",
      amount: "1000.00", currency: "GHS", taxableTreatment: "ordinary", pensionable: true, validFrom: new Date("2026-01-01"), validTo: null,
    });
    mockPermissions(["payroll.run.prepare"]);
    const run = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    // Compensation exists, but no statutory rules configured at all -> MissingStatutoryRuleError.
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/${run.body.id}/calculate`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(422);
    expect(res.body.employeeErrors).toEqual([{ employeeId: 501, error: expect.stringContaining("paye_bands") }]);

    // Nothing was persisted from the failed attempt.
    const lines = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/${run.body.id}/lines`).set("Authorization", "Bearer valid-token");
    expect(lines.body).toEqual([]);
  });

  it("calculates a run successfully end-to-end and excludes an employee hired after the period ends", async () => {
    const periodId = await createPeriod();
    setupStandardStatutoryRules();
    mockEmployee(501);
    mockEmployee(502, { hireDate: new Date("2026-06-01") }); // hired after this period's endDate (2026-02-01)
    fixtures.compensationRows.push({
      id: 1, organizationId: ORG_ID, employeeId: 501, category: "earning", componentTypeCode: "basic_salary",
      amount: "1000.00", currency: "GHS", taxableTreatment: "ordinary", pensionable: true, validFrom: new Date("2026-01-01"), validTo: null,
    });
    mockPermissions(["payroll.run.prepare"]);

    const run = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs`).set("Authorization", "Bearer valid-token").send({ payrollPeriodId: periodId });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/${run.body.id}/calculate`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.employeeCount).toBe(1);
    expect(res.body.run.status).toBe("calculated");

    const lines = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/${run.body.id}/lines`).set("Authorization", "Bearer valid-token");
    expect(lines.body).toHaveLength(1);
    expect(lines.body[0].line.employeeId).toBe(501);
    // This file's fixture bands: 500.00@0%, then an open-ended band@10%.
    // pension=5.5%x1000=55.00; taxableBase=945.00 -> band1:0 band2(open):445@10%=44.50 -> net=1000-55-44.50=900.50
    expect(lines.body[0].line.netPay).toBe("900.50");
  });
});

describe("One-off payroll inputs", () => {
  it("returns 400 for an unknown componentTypeCode and never touches the run's own statutory tables", async () => {
    mockPermissions(["payroll.run.prepare"]);
    const period = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods`)
      .set("Authorization", "Bearer valid-token")
      .send({ frequency: "monthly", startDate: "2026-01-01", endDate: "2026-02-01", payDate: "2026-01-31" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods/${period.body.id}/inputs`)
      .set("Authorization", "Bearer valid-token")
      .send({ employeeId: 501, category: "earning", componentTypeCode: "does_not_exist", amount: "300.00", currency: "GHS" });
    expect(res.status).toBe(400);
  });
});
