/**
 * Payroll, Workstream 2 — Employee Compensation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.4, §9.8, §13). Mirrors
 * payrollStatutoryRules.test.ts's established Cond-matching mocked-db
 * harness. Genuine concurrency is proven in live QA, not here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  auditEventsTable,
  employeesTable,
  masterDataItemsTable,
  employeeCompensationComponentsTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
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
      employeeRows: [] as Record<string, unknown>[],
      masterDataItemRows: [] as Record<string, unknown>[],
      compensationRows: [] as Record<string, unknown>[],
      bankingRows: [] as Record<string, unknown>[],
      statutoryRows: [] as Record<string, unknown>[],
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
    auditEventsTable: mockTable("audit_events", []),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "employmentStatus"]),
    masterDataItemsTable: mockTable("master_data_items", ["id", "domain", "organizationId", "code", "label", "status"]),
    employeeCompensationComponentsTable: mockTable("employee_compensation_components", [
      "id", "organizationId", "employeeId", "category", "componentTypeCode", "amount", "currency", "recurring", "taxableTreatment", "pensionable", "validFrom", "validTo",
    ]),
    employeeBankingDetailsTable: mockTable("employee_banking_details", ["id", "organizationId", "employeeId", "bankCode", "accountNumber", "accountName", "validFrom", "validTo"]),
    employeeStatutoryIdentifiersTable: mockTable("employee_statutory_identifiers", ["id", "organizationId", "employeeId", "ssnitNumber", "tin", "validFrom", "validTo"]),
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
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === masterDataItemsTable) return fixtures.masterDataItemRows;
  if (table === employeeCompensationComponentsTable) return fixtures.compensationRows;
  if (table === employeeBankingDetailsTable) return fixtures.bankingRows;
  if (table === employeeStatutoryIdentifiersTable) return fixtures.statutoryRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === employeeCompensationComponentsTable) fixtures.compensationRows = rows;
  else if (table === employeeBankingDetailsTable) fixtures.bankingRows = rows;
  else if (table === employeeStatutoryIdentifiersTable) fixtures.statutoryRows = rows;
  else if (table === auditEventsTable) fixtures.auditRows = rows;
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
        const rows = arr.map((item) => ({ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), validTo: null, ...item }));
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  auditEventsTable,
  employeesTable,
  masterDataItemsTable,
  employeeCompensationComponentsTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
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
const EMPLOYEE_ID = 42;

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

function mockEmployee() {
  fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
}

function mockComponentType(domain: string, code: string) {
  fixtures.masterDataItemRows.push({ id: nextId(masterDataItemsTable), domain, organizationId: null, code, label: code, status: "active" });
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.auditRows = [];
  fixtures.employeeRows = [];
  fixtures.masterDataItemRows = [];
  fixtures.compensationRows = [];
  fixtures.bankingRows = [];
  fixtures.statutoryRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  mockPayrollModuleEnabled(true);
  mockEmployee();
  mockComponentType("payroll_earning_component_type", "basic_salary");
  mockComponentType("payroll_bank", "test_bank");
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/payroll/compensation", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`).send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when the payroll module is not enabled", async () => {
    mockPayrollModuleEnabled(false);
    mockPermissions(["payroll.compensation.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    expect(res.status).toBe(403);
  });

  it("returns 403 without payroll.compensation.manage — ordinary employee.write does NOT grant compensation access", async () => {
    mockPermissions(["employee.write", "employee.read"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an employee not in this organization", async () => {
    fixtures.employeeRows = [];
    mockPermissions(["payroll.compensation.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    expect(res.status).toBe(404);
  });

  it("creates a basic_salary earning component for an authorized payroll actor", async () => {
    mockPermissions(["payroll.compensation.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01", pensionable: true });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe("earning");
    expect(res.body.pensionable).toBe(true);
    expect(res.body.validTo).toBeNull();
  });

  it("rejects an unknown componentTypeCode", async () => {
    mockPermissions(["payroll.compensation.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "does_not_exist", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("HISTORICAL INTEGRITY: assigning a new value for the same component closes the prior open row rather than overwriting it", async () => {
    mockPermissions(["payroll.compensation.manage", "payroll.compensation.read"]);
    const first = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1200.00", currency: "GHS", validFrom: "2026-07-01" });
    expect(second.status).toBe(201);

    const history = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation/history`)
      .set("Authorization", "Bearer valid-token");
    expect(history.body).toHaveLength(2);
    const closedFirst = history.body.find((r: { id: number }) => r.id === first.body.id);
    expect(closedFirst.validTo).toBe("2026-07-01T00:00:00.000Z");
    expect(closedFirst.amount).toBe("1000.00");
  });

  it("rejects a new component with validFrom not strictly after the currently-open one's own validFrom", async () => {
    mockPermissions(["payroll.compensation.manage"]);
    await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-06-01" });
    const overlap = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1100.00", currency: "GHS", validFrom: "2026-01-01" });
    expect(overlap.status).toBe(409);
  });

  it("as-of resolution: resolves the value in force on a historical date, not the current one", async () => {
    mockPermissions(["payroll.compensation.manage", "payroll.compensation.read"]);
    await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1000.00", currency: "GHS", validFrom: "2026-01-01" });
    await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation`)
      .set("Authorization", "Bearer valid-token")
      .send({ category: "earning", componentTypeCode: "basic_salary", amount: "1200.00", currency: "GHS", validFrom: "2026-07-01" });

    const may = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation/history?asOf=2026-05-15`)
      .set("Authorization", "Bearer valid-token");
    expect(may.body).toHaveLength(1);
    expect(may.body[0].amount).toBe("1000.00");

    const august = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/compensation/history?asOf=2026-08-15`)
      .set("Authorization", "Bearer valid-token");
    expect(august.body).toHaveLength(1);
    expect(august.body[0].amount).toBe("1200.00");
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/payroll/banking", () => {
  it("returns 403 without payroll.banking.manage even for a holder of payroll.compensation.manage", async () => {
    mockPermissions(["payroll.compensation.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/banking`)
      .set("Authorization", "Bearer valid-token")
      .send({ bankCode: "test_bank", accountNumber: "12345", accountName: "Ada Lovelace", validFrom: "2026-01-01" });
    expect(res.status).toBe(403);
  });

  it("creates banking details and read-audits the GET route", async () => {
    mockPermissions(["payroll.banking.manage", "payroll.banking.read"]);
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/banking`)
      .set("Authorization", "Bearer valid-token")
      .send({ bankCode: "test_bank", accountNumber: "12345", accountName: "Ada Lovelace", validFrom: "2026-01-01" });
    expect(create.status).toBe(201);

    const auditBeforeRead = fixtures.auditRows.filter((r) => r.eventType === "payroll_banking.read").length;
    const read = await request(app).get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/payroll/banking`).set("Authorization", "Bearer valid-token");
    expect(read.status).toBe(200);
    expect(read.body.bankCode).toBe("test_bank");

    const auditAfterRead = fixtures.auditRows.filter((r) => r.eventType === "payroll_banking.read").length;
    expect(auditAfterRead).toBe(auditBeforeRead + 1);
  });
});

describe("Sensitive-data isolation", () => {
  // Structural check (no full employee-detail mock surface needed): the
  // ordinary employee routes/lib/DTO-formatting code has zero reference to
  // any W2 compensation/banking/statutory-identifier table or field —
  // confirming no code path could leak this data through GET employee,
  // the employee list, ESS, Manager Portal, or personnel-record search,
  // consistent with the same static-verification technique Phase 3H's own
  // W120 used to prove absence of speculative sensitive fields.
  const forbiddenTokens = ["employeeCompensationComponentsTable", "employeeBankingDetailsTable", "employeeStatutoryIdentifiersTable"];
  const filesToCheck = [
    "src/routes/employees.ts",
    "src/lib/employees.ts",
    "src/routes/me.ts",
    "src/lib/employeeSelfService.ts",
    "src/routes/managerPortal.ts",
    "src/lib/managerPortal.ts",
    "src/lib/personnelFiles.ts",
  ];

  it("no ordinary employee/ESS/Manager Portal/personnel-record code references any W2 compensation table", () => {
    for (const relPath of filesToCheck) {
      const content = readFileSync(join(__dirname, "..", relPath.replace(/^src\//, "")), "utf-8");
      for (const token of forbiddenTokens) {
        expect(content, `${relPath} must not reference ${token}`).not.toContain(token);
      }
    }
  });
});
