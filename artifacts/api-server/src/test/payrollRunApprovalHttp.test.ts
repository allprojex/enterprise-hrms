/**
 * Payroll, Workstream 4 — HTTP boundary for approve/lock/corrections
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §14). Mirrors the established
 * Cond-matching mocked-db harness (W1-W3). Exercises permission/module
 * gating and audit recording — exact lifecycle logic is covered by
 * payrollRunLifecycle.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;

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
  rolesTable,
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
      correctionRows: [] as Record<string, unknown>[],
      correctionComponentRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
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
    payrollInputReferencesTable: mockTable("payroll_input_references", ["id", "organizationId", "payrollPeriodId", "employeeId", "sourceType", "sourceId", "category", "componentTypeCode", "amount", "currency", "taxableTreatment", "description"]),
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
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_correction_components": return fixtures.correctionComponentRows;
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
    case "payroll_corrections": fixtures.correctionRows = rows; break;
    case "payroll_correction_components": fixtures.correctionComponentRows = rows; break;
    case "audit_events": fixtures.auditRows = rows; break;
  }
}

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { cause?: { code: string } };
  err.cause = { code: "23505" };
  return err;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: (proj?: Record<string, unknown>) => ({
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
          return { innerJoin() { return this; }, where: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
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
          const isCount = proj && "count" in proj;
          const resolved = isCount ? ([{ count: current.length }] as unknown as Record<string, unknown>[]) : current;
          const promise = Promise.resolve(resolved);
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
        if (table === payrollCorrectionsTable) {
          for (const item of arr) {
            const openDraft = fixtures.correctionRows.find((r) => r.originalRunLineId === item.originalRunLineId && r.status === "draft");
            if (openDraft) throw uniqueViolation();
          }
        }
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
  rolesTable,
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
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
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

function mockActiveMembership(membershipId: number, userId: number, organizationId = ORG_ID) {
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

function tokenFor(userId: number, membershipId: number): string {
  const token = `token-${membershipId}`;
  fixtures.sessionRows.push({
    session: { id: membershipId, token, userId, expiresAt: new Date(Date.now() + 100000) },
    user: { id: userId, email: `user${userId}@example.com`, firstName: "U", lastName: String(userId), role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
  });
  fixtures.membershipRows.push({ id: membershipId, applicationUserId: userId, organizationId: ORG_ID, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() });
  return token;
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
  fixtures.correctionRows = [];
  fixtures.correctionComponentRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership(5, 1);
  mockPayrollModuleEnabled(true);
});

describe("POST /api/organizations/:organizationId/payroll/runs/:id/approve", () => {
  it("returns 403 without payroll.run.approve — payroll.run.prepare alone is not enough", async () => {
    mockPermissions(["payroll.run.prepare"]);
    fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "p1", startDate: new Date(), endDate: new Date(), payDate: new Date() });
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "calculated", preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: new Date() });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 409 when the approver is the same membership that prepared the run", async () => {
    mockPermissions(["payroll.run.approve"]);
    fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "p1", startDate: new Date(), endDate: new Date(), payDate: new Date() });
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "calculated", preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: new Date() });
    fixtures.runLineRows.push({ id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: null, netPay: "900.00", currency: "GHS" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("approves with a genuinely different, authorized actor and records an audit event", async () => {
    fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "p1", startDate: new Date(), endDate: new Date(), payDate: new Date() });
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "calculated", preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: new Date() });
    fixtures.runLineRows.push({ id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: null, netPay: "900.00", currency: "GHS" });

    const approverToken = tokenFor(2, 7);
    mockPermissions(["payroll.run.approve"]);

    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/approve`).set("Authorization", `Bearer ${approverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(fixtures.auditRows.some((e) => e.eventType === "payroll_run.approved")).toBe(true);
  });
});

describe("Lock-invariant hardening on existing W3 routes", () => {
  it("rejects recalculation once the run is approved", async () => {
    mockPermissions(["payroll.run.prepare"]);
    fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "p1", startDate: new Date(), endDate: new Date(), payDate: new Date() });
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "approved", preparedByMembershipId: 5, approvedByMembershipId: 7, lockedAt: null, calculatedAt: new Date() });

    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/calculate`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("rejects adding a one-off input once the period's run is locked", async () => {
    mockPermissions(["payroll.run.prepare"]);
    mockPayrollModuleEnabled(true);
    fixtures.masterDataItemRows.push({ id: 1, domain: "payroll_earning_component_type", organizationId: null, code: "bonus_oneoff", label: "Bonus", status: "active" });
    fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "p1", startDate: new Date(), endDate: new Date(), payDate: new Date() });
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked", preparedByMembershipId: 5, approvedByMembershipId: 7, lockedAt: new Date(), calculatedAt: new Date() });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/periods/1/inputs`)
      .set("Authorization", "Bearer valid-token")
      .send({ employeeId: 501, category: "earning", componentTypeCode: "bonus_oneoff", amount: "100.00", currency: "GHS" });
    expect(res.status).toBe(409);
  });
});

describe("Corrections HTTP boundary", () => {
  it("returns 403 without payroll.run.correct", async () => {
    mockPermissions(["payroll.run.approve"]);
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked", preparedByMembershipId: 5, approvedByMembershipId: 7, lockedAt: new Date(), calculatedAt: new Date() });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/runs/1/corrections`)
      .set("Authorization", "Bearer valid-token")
      .send({ originalRunLineId: 1, reason: "test" });
    expect(res.status).toBe(403);
  });

  it("returns 409 creating a correction against a run that is not locked", async () => {
    mockPermissions(["payroll.run.correct"]);
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "calculated", preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: new Date() });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/runs/1/corrections`)
      .set("Authorization", "Bearer valid-token")
      .send({ originalRunLineId: 1, reason: "test" });
    expect(res.status).toBe(409);
  });
});
