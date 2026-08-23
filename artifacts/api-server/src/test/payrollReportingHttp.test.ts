/**
 * Payroll, Workstream 5 — HTTP boundary for payslips/reports.
 * Mirrors the established Cond-matching mocked-db harness (W1-W4).
 * Exercises permission/module gating, tenant isolation, CSV export, and
 * audit recording — exact figures/logic covered by payrollReporting.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  auditEventsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollPeriodsTable,
  payrollStatutoryRuleVersionsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  employeesTable,
  employeeStatutoryIdentifiersTable,
  employeeUserLinksTable,
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
      auditRows: [] as Record<string, unknown>[],
      runRows: [] as Record<string, unknown>[],
      lineRows: [] as Record<string, unknown>[],
      lineComponentRows: [] as Record<string, unknown>[],
      periodRows: [] as Record<string, unknown>[],
      statutoryVersionRows: [] as Record<string, unknown>[],
      correctionRows: [] as Record<string, unknown>[],
      correctionComponentRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      statutoryIdentifierRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    auditEventsTable: mockTable("audit_events", []),
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
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName"]),
    employeeStatutoryIdentifiersTable: mockTable("employee_statutory_identifiers", ["id", "organizationId", "employeeId", "ssnitNumber", "tin", "validFrom", "validTo"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "organizationId", "employeeId", "applicationUserId"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "organization_memberships": return fixtures.membershipRows;
    case "membership_roles": return fixtures.membershipRoleRows as never;
    case "role_permissions": return fixtures.permissionRows as never;
    case "modules": return fixtures.moduleRows;
    case "organization_modules": return fixtures.orgModuleRows;
    case "audit_events": return fixtures.auditRows;
    case "payroll_runs": return fixtures.runRows;
    case "payroll_run_lines": return fixtures.lineRows;
    case "payroll_run_line_components": return fixtures.lineComponentRows;
    case "payroll_periods": return fixtures.periodRows;
    case "payroll_statutory_rule_versions": return fixtures.statutoryVersionRows;
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_correction_components": return fixtures.correctionComponentRows;
    case "employees": return fixtures.employeeRows;
    case "employee_statutory_identifiers": return fixtures.statutoryIdentifierRows;
    case "employee_user_links": return fixtures.employeeUserLinkRows;
    default: return fixtures.sessionRows;
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table.__name === "audit_events") fixtures.auditRows = rows;
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

        const project = (row: Record<string, unknown>) => {
          if (!proj) return row;
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(proj)) out[key] = row[key];
          return out;
        };
        const rows = rowsFor(table);
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
            limit: (n: number) => stage(current.slice(0, n)),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(v) ? v : [v];
        const rows = arr.map((item, i) => ({ id: (rowsFor(table).length + i + 1), createdAt: new Date(), updatedAt: new Date(), ...item }));
        setRowsFor(table, [...rowsFor(table), ...rows]);
        return { returning: () => Promise.resolve(rows) };
      },
    }),
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
  auditEventsTable,
  payrollRunsTable,
  payrollRunLinesTable,
  payrollRunLineComponentsTable,
  payrollPeriodsTable,
  payrollStatutoryRuleVersionsTable,
  payrollCorrectionsTable,
  payrollCorrectionComponentsTable,
  employeesTable,
  employeeStatutoryIdentifiersTable,
  employeeUserLinksTable,
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
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  like: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

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
function mockPayrollModuleEnabled(organizationId: number, enabled: boolean) {
  fixtures.moduleRows = [{ id: 99, key: "payroll", requiredModuleKeys: [] }];
  const others = fixtures.orgModuleRows.filter((r) => r.organizationId !== organizationId);
  fixtures.orgModuleRows = enabled ? [...others, { id: organizationId, organizationId, moduleId: 99, enabled: true }] : others;
}

function baseFixture() {
  fixtures.periodRows.push({ id: 1, organizationId: ORG_ID, frequency: "monthly", periodKey: "2026-01", startDate: new Date("2026-01-01"), endDate: new Date("2026-02-01"), payDate: new Date("2026-01-31") });
  fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked" });
  fixtures.lineRows.push({
    id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: "EMP-0501",
    payeBandsVersionId: null, pensionRatesVersionId: null, pensionEarningsCeilingVersionId: null,
    grossEarnings: "1000.00", pensionableEarnings: "1000.00", employeePensionDeduction: "55.00", employerPensionContribution: "130.00",
    tier1Amount: "135.00", tier2Amount: "50.00", taxableIncome: "945.00", payeAmount: "22.25", otherDeductions: "0.00", netPay: "922.75", currency: "GHS",
  });
  fixtures.employeeRows.push({ id: 501, organizationId: ORG_ID, firstName: "Ada", lastName: "Lovelace" });
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.auditRows = [];
  fixtures.runRows = [];
  fixtures.lineRows = [];
  fixtures.lineComponentRows = [];
  fixtures.periodRows = [];
  fixtures.statutoryVersionRows = [];
  fixtures.correctionRows = [];
  fixtures.correctionComponentRows = [];
  fixtures.employeeRows = [];
  fixtures.statutoryIdentifierRows = [];
  fixtures.employeeUserLinkRows = [];
  mockSession();
  mockActiveMembership();
  mockPayrollModuleEnabled(ORG_ID, true);
});

describe("GET /api/organizations/:organizationId/payroll/runs/:runId/lines/:lineId/payslip", () => {
  it("returns 403 without payroll.payslip.read", async () => {
    baseFixture();
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/lines/1/payslip`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns the payslip for an authorized actor", async () => {
    baseFixture();
    mockPermissions(["payroll.payslip.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/lines/1/payslip`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.employeeName).toBe("Ada Lovelace");
    expect(res.body.original.netPay).toBe("922.75");
  });

  it("cross-org access is denied (no membership in the other org)", async () => {
    baseFixture();
    mockPermissions(["payroll.payslip.read"]);
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/payroll/runs/1/lines/1/payslip`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/payroll/runs/:runId/reports/:reportKey", () => {
  it("returns 403 without payroll.report.read", async () => {
    baseFixture();
    mockPermissions(["payroll.payslip.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_register`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns the register as JSON by default", async () => {
    baseFixture();
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_register`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows[0].employeeName).toBe("Ada Lovelace");
    expect(res.body.totals.netPay).toBe("922.75");
  });

  it("returns the identical data as CSV with ?format=csv", async () => {
    baseFixture();
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_register?format=csv`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Ada Lovelace");
    expect(res.text).toContain("922.75");
    // Header row + exactly 1 data row.
    expect(res.text.trim().split("\n")).toHaveLength(2);
  });

  it("returns 409 for a non-locked run", async () => {
    baseFixture();
    fixtures.runRows[0].status = "calculated";
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_register`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown report key", async () => {
    baseFixture();
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/not_a_real_report`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("omits SSNIT numbers and never audits a read when statutory-identifier access is not granted", async () => {
    baseFixture();
    fixtures.statutoryIdentifierRows.push({ id: 1, organizationId: ORG_ID, employeeId: 501, ssnitNumber: "SSN-123", tin: null, validFrom: new Date("2020-01-01"), validTo: null });
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_pension_schedule`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows[0].ssnitNumber).toBeUndefined();
    expect(fixtures.auditRows.some((e) => e.eventType === "payroll_statutory_identifiers.read")).toBe(false);
  });

  it("includes SSNIT numbers and audits the read when statutory-identifier access is granted", async () => {
    baseFixture();
    fixtures.statutoryIdentifierRows.push({ id: 1, organizationId: ORG_ID, employeeId: 501, ssnitNumber: "SSN-123", tin: null, validFrom: new Date("2020-01-01"), validTo: null });
    mockPermissions(["payroll.report.read", "payroll.statutory_identifiers.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/runs/1/reports/payroll_pension_schedule`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows[0].ssnitNumber).toBe("SSN-123");
    expect(fixtures.auditRows.some((e) => e.eventType === "payroll_statutory_identifiers.read")).toBe(true);
  });
});

describe("GET /api/organizations/:organizationId/payroll/me/payslips", () => {
  it("returns 403 without payroll.payslip.read.own", async () => {
    mockPermissions(["payroll.payslip.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/me/payslips`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns an empty array when the caller has no linked employee", async () => {
    mockPermissions(["payroll.payslip.read.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/me/payslips`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
