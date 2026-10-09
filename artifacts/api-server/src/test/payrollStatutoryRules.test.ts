/**
 * Payroll, Workstream 1 — Statutory-Rule Foundation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §8, §9.2, §13). Exercises the real
 * requireAuth/requireMembership/requireModuleEnabled/requirePermission chain
 * through supertest with a mocked @workspace/db, mirroring
 * employeeNumbering.test.ts's established Cond-matching harness. Genuine
 * concurrency (row locking, the partial unique index) is not exercised
 * here, per this codebase's own established precedent — proven in live QA
 * instead.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "and"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "isNull") return row[cond.field] == null;
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
  auditEventsTable,
  payrollStatutoryRuleVersionsTable,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
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
      versionRows: [] as Record<string, unknown>[],
      payeBandRows: [] as Record<string, unknown>[],
      pensionRateRows: [] as Record<string, unknown>[],
      pensionCeilingRows: [] as Record<string, unknown>[],
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
    auditEventsTable: mockTable("audit_events", []),
    payrollStatutoryRuleVersionsTable: mockTable("payroll_statutory_rule_versions", [
      "id", "ruleType", "status", "effectiveFrom", "effectiveTo", "createdByMembershipId", "approvedByMembershipId", "approvedAt",
    ]),
    payrollPayeBandsTable: mockTable("payroll_paye_bands", ["id", "statutoryRuleVersionId", "bandOrder", "taxpayerCategory", "thresholdAmount", "ratePercent"]),
    payrollPensionRatesTable: mockTable("payroll_pension_rates", ["id", "statutoryRuleVersionId"]),
    payrollPensionEarningsCeilingTable: mockTable("payroll_pension_earnings_ceiling", ["id", "statutoryRuleVersionId"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === auditEventsTable) return fixtures.auditRows;
  if (table === payrollStatutoryRuleVersionsTable) return fixtures.versionRows;
  if (table === payrollPayeBandsTable) return fixtures.payeBandRows;
  if (table === payrollPensionRatesTable) return fixtures.pensionRateRows;
  if (table === payrollPensionEarningsCeilingTable) return fixtures.pensionCeilingRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === payrollStatutoryRuleVersionsTable) fixtures.versionRows = rows;
  else if (table === payrollPayeBandsTable) fixtures.payeBandRows = rows;
  else if (table === payrollPensionRatesTable) fixtures.pensionRateRows = rows;
  else if (table === payrollPensionEarningsCeilingTable) fixtures.pensionCeilingRows = rows;
  else if (table === auditEventsTable) fixtures.auditRows = rows;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: (fields?: Record<string, unknown>) => ({
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
          const b = { innerJoin() { return this; }, where: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
          return b;
        }
        if (table === rolePermissionsTable) {
          const rows = fixtures.permissionRows;
          const b = {
            innerJoin: () => b,
            where: () => b,
            then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
          };
          return b;
        }
        if (table === modulesTable || table === organizationModulesTable) {
          const rows = rowsFor(table);
          const b = { where: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve) };
          return b;
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
        const rows = arr.map((item) => ({ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "draft", effectiveTo: null, approvedByMembershipId: null, approvedAt: null, ...item }));
        setRowsFor(table, [...rowsFor(table), ...rows]);
        const result = { returning: () => Promise.resolve(rows) };
        return { ...result, onConflictDoNothing: () => result };
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
  auditEventsTable,
  payrollStatutoryRuleVersionsTable,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gt: () => undefined,
  ilike: () => undefined,
  desc: () => undefined,
  count: () => "count",
  inArray: () => undefined,
  like: () => undefined,
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

function mockSecondSession(userId: number) {
  fixtures.sessionRows.push({
    session: { id: userId + 100, token: `valid-token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
    user: { id: userId, email: `user${userId}@example.com`, firstName: "User", lastName: String(userId), role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
  });
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

const validPayeBands = [
  { bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "490.00", ratePercent: "0.00" },
  { bandOrder: 2, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "5.00" },
];

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.auditRows = [];
  fixtures.versionRows = [];
  fixtures.payeBandRows = [];
  fixtures.pensionRateRows = [];
  fixtures.pensionCeilingRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  mockPayrollModuleEnabled(true);
});

describe("POST /api/organizations/:organizationId/payroll/statutory-rules", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`).send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when the payroll module is not enabled, even with the permission", async () => {
    mockPayrollModuleEnabled(false);
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "paye_bands", effectiveFrom: "2026-01-01", payeBands: validPayeBands });
    expect(res.status).toBe(403);
  });

  it("returns 403 without payroll.statutory.manage (module enabled, wrong permission)", async () => {
    mockPermissions(["payroll.statutory.approve"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "paye_bands", effectiveFrom: "2026-01-01", payeBands: validPayeBands });
    expect(res.status).toBe(403);
  });

  it("creates a draft paye_bands version with valid, sequentially-ordered bands", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "paye_bands", effectiveFrom: "2026-01-01", sourceUrl: "https://gra.gov.gh/test", payeBands: validPayeBands });
    expect(res.status).toBe(201);
    expect(res.body.version.status).toBe("draft");
    expect(res.body.version.ruleType).toBe("paye_bands");
    expect(res.body.payeBands).toHaveLength(2);
  });

  it("rejects a paye_bands payload with non-sequential bandOrder", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({
        ruleType: "paye_bands",
        effectiveFrom: "2026-01-01",
        payeBands: [
          { bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: "490.00", ratePercent: "0.00" },
          { bandOrder: 3, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "5.00" },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects a paye_bands payload where a non-final band has a null (open-ended) thresholdAmount", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({
        ruleType: "paye_bands",
        effectiveFrom: "2026-01-01",
        payeBands: [
          { bandOrder: 1, taxpayerCategory: "resident", thresholdAmount: null, ratePercent: "0.00" },
          { bandOrder: 2, taxpayerCategory: "resident", thresholdAmount: "1000.00", ratePercent: "5.00" },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects ruleType pension_rates with no pensionRates payload supplied", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "pension_rates", effectiveFrom: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("creates a draft pension_rates version with four independent percentages", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({
        ruleType: "pension_rates",
        effectiveFrom: "2026-01-01",
        pensionRates: { employeeRatePercent: "5.50", employerRatePercent: "13.00", tier1AllocationPercent: "13.50", tier2AllocationPercent: "5.00" },
      });
    expect(res.status).toBe(201);
    expect(res.body.pensionRates.tier1AllocationPercent).toBe("13.50");
    expect(res.body.pensionRates.tier2AllocationPercent).toBe("5.00");
  });

  it("creates a draft pension_earnings_ceiling version, independently of pension_rates", async () => {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "pension_earnings_ceiling", effectiveFrom: "2026-01-01", pensionEarningsCeiling: { maximumInsurableEarnings: "69000.00" } });
    expect(res.status).toBe(201);
    expect(res.body.pensionEarningsCeiling.maximumInsurableEarnings).toBe("69000.00");
  });
});

describe("Statutory rule version lifecycle", () => {
  async function createDraft(): Promise<number> {
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/payroll/statutory-rules`)
      .set("Authorization", "Bearer valid-token")
      .send({ ruleType: "paye_bands", effectiveFrom: "2026-01-01", payeBands: validPayeBands });
    return res.body.version.id;
  }

  it("moves draft -> validated", async () => {
    const id = await createDraft();
    mockPermissions(["payroll.statutory.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/validate`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("validated");
  });

  it("rejects validating a version that is not draft (already validated)", async () => {
    const id = await createDraft();
    mockPermissions(["payroll.statutory.manage"]);
    await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/validate`).set("Authorization", "Bearer valid-token");
    const second = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/validate`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
  });

  it("approves a validated version when the approver differs from the creator (maker-checker)", async () => {
    const id = await createDraft();
    mockPermissions(["payroll.statutory.manage"]);
    await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/validate`).set("Authorization", "Bearer valid-token");

    mockSecondSession(2);
    mockActiveMembership(ORG_ID, 6, 2);
    mockPermissions(["payroll.statutory.approve"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/approve`).set("Authorization", "Bearer valid-token-2");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedByMembershipId).toBe(6);
  });

  it("SERVER-SIDE rejects self-approval — the creator calling /approve directly, even holding payroll.statutory.approve, cannot bypass maker-checker", async () => {
    const id = await createDraft();
    mockPermissions(["payroll.statutory.manage", "payroll.statutory.approve"]);
    await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/validate`).set("Authorization", "Bearer valid-token");

    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/creator|approve/i);
  });

  it("rejects approving a version that is not validated (still draft)", async () => {
    const id = await createDraft();
    mockSecondSession(2);
    mockActiveMembership(ORG_ID, 6, 2);
    mockPermissions(["payroll.statutory.approve"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/${id}/approve`).set("Authorization", "Bearer valid-token-2");
    expect(res.status).toBe(409);
  });

  it("returns 404 for a nonexistent version id on validate/approve", async () => {
    mockPermissions(["payroll.statutory.manage", "payroll.statutory.approve"]);
    const v = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/999999/validate`).set("Authorization", "Bearer valid-token");
    expect(v.status).toBe(404);
    const a = await request(app).post(`/api/organizations/${ORG_ID}/payroll/statutory-rules/999999/approve`).set("Authorization", "Bearer valid-token");
    expect(a.status).toBe(404);
  });
});

describe("GET /api/organizations/:organizationId/payroll/statutory-rules", () => {
  it("allows read access to a holder of payroll.statutory.approve alone (no .manage)", async () => {
    mockPermissions(["payroll.statutory.approve"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/statutory-rules`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 403 for a caller holding neither payroll.statutory.manage nor .approve", async () => {
    mockPermissions(["employee.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/statutory-rules`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("Statutory-vs-organization-config separation", () => {
  it("the organization payroll-policy namespace default config carries only organization-policy fields, never a statutory parameter", async () => {
    const { CONFIG_NAMESPACES } = await import("../services/organizationConfig");
    const defaults = CONFIG_NAMESPACES.payroll.defaults();
    expect(Object.keys(defaults).sort()).toEqual(["defaultCurrency", "payFrequency", "roundingRule"]);
    const parsed = CONFIG_NAMESPACES.payroll.schema.safeParse({ payFrequency: "monthly", defaultCurrency: "GHS", roundingRule: "round" });
    expect(parsed.success).toBe(true);
  });

  it("the payroll namespace is gated behind the payroll module, mirroring every other module-gated namespace", async () => {
    const { CONFIG_NAMESPACES } = await import("../services/organizationConfig");
    expect(CONFIG_NAMESPACES.payroll.moduleKey).toBe("payroll");
  });
});
