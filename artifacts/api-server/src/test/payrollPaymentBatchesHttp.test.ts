/**
 * Payroll, Frozen Workstream 8 — HTTP boundary for payment batches. Mirrors
 * the established Cond-matching mocked-db harness (W1-W5). Exercises
 * permission/module gating, tenant isolation, masking, export/audit
 * behavior — exact figures/logic covered by payrollPaymentBatches.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  payrollCorrectionsTable,
  payrollPaymentBatchesTable,
  payrollPaymentBatchLinesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  masterDataItemsTable,
  employeesTable,
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
      runLineRows: [] as Record<string, unknown>[],
      correctionRows: [] as Record<string, unknown>[],
      batchRows: [] as Record<string, unknown>[],
      batchLineRows: [] as Record<string, unknown>[],
      bankingRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName"]),
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
    case "payroll_run_lines": return fixtures.runLineRows;
    case "payroll_corrections": return fixtures.correctionRows;
    case "payroll_payment_batches": return fixtures.batchRows;
    case "payroll_payment_batch_lines": return fixtures.batchLineRows;
    case "employee_banking_details": return fixtures.bankingRows;
    case "employees": return fixtures.employeeRows;
    default: return fixtures.sessionRows;
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table.__name === "audit_events") fixtures.auditRows = rows;
  if (table.__name === "payroll_payment_batches") fixtures.batchRows = rows;
  if (table.__name === "payroll_payment_batch_lines") fixtures.batchLineRows = rows;
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
            for: () => stage(current),
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
  payrollCorrectionsTable,
  payrollPaymentBatchesTable,
  payrollPaymentBatchLinesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  masterDataItemsTable,
  employeesTable,
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
  fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked" });
  fixtures.runLineRows.push({ id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: "EMP-0501", netPay: "922.75", currency: "GHS" });
  fixtures.bankingRows.push({ id: 1, organizationId: ORG_ID, employeeId: 501, bankCode: "GCB", accountNumber: "9988776655", accountName: "Ada Lovelace", branch: "Accra Main", validFrom: new Date("2020-01-01"), validTo: null });
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
  fixtures.runLineRows = [];
  fixtures.correctionRows = [];
  fixtures.batchRows = [];
  fixtures.batchLineRows = [];
  fixtures.bankingRows = [];
  fixtures.employeeRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  mockPayrollModuleEnabled(ORG_ID, true);
});

describe("POST /api/organizations/:organizationId/payroll/runs/:runId/payment-batches", () => {
  it("returns 403 without payroll.payment.manage", async () => {
    baseFixture();
    mockPermissions(["payroll.report.read"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("creates a batch for an authorized actor, masking the account number in the JSON response", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(res.body.batch.status).toBe("draft");
    expect(res.body.batch.totalAmount).toBe("922.75");
    expect(res.body.lines[0].accountNumber).toBe("******6655");
    expect(fixtures.auditRows.some((e) => e.eventType === "payroll_payment_batch.created")).toBe(true);
  });

  it("returns 409 for a non-locked run", async () => {
    baseFixture();
    fixtures.runRows[0].status = "approved";
    mockPermissions(["payroll.payment.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 409 when a batch already exists for the run", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 422 with the missing employeeIds when banking is absent", async () => {
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked" });
    fixtures.runLineRows.push({ id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: "EMP-0501", netPay: "922.75", currency: "GHS" });
    // No banking row for employee 501.
    mockPermissions(["payroll.payment.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(422);
    expect(res.body.employeeIds).toEqual([501]);
  });

  it("cross-org creation is denied (no membership in the other org)", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("GET/DELETE /api/organizations/:organizationId/payroll/payment-batches/:id", () => {
  it("detail view masks the account number and resolves the employee name", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    const create = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.lines[0].accountNumber).toBe("******6655");
    expect(res.body.lines[0].employeeName).toBe("Ada Lovelace");
  });

  it("deletes a draft batch, then 404s on a further get", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    const create = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    const del = await request(app).delete(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}`).set("Authorization", "Bearer valid-token");
    expect(del.status).toBe(204);
    const get = await request(app).get(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}`).set("Authorization", "Bearer valid-token");
    expect(get.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/payroll/payment-batches/:id/export", () => {
  it("returns a CSV with the FULL, unmasked account number and audits the disclosure exactly once across repeat calls", async () => {
    baseFixture();
    mockPermissions(["payroll.payment.manage"]);
    const create = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");

    const first = await request(app).post(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}/export`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toContain("text/csv");
    expect(first.text).toContain("9988776655"); // full account number, unmasked
    expect(first.text).toContain("Ada Lovelace");

    const second = await request(app).post(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}/export`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);

    expect(fixtures.auditRows.filter((e) => e.eventType === "payroll_payment_batch.exported")).toHaveLength(1);
  });

  it("CSV FORMULA-INJECTION HARDENING: a leading '=' in the account name is neutralized with a guard quote", async () => {
    fixtures.runRows.push({ id: 1, organizationId: ORG_ID, payrollPeriodId: 1, status: "locked" });
    fixtures.runLineRows.push({ id: 1, organizationId: ORG_ID, payrollRunId: 1, employeeId: 501, staffNumberSnapshot: "EMP-0501", netPay: "922.75", currency: "GHS" });
    fixtures.bankingRows.push({ id: 1, organizationId: ORG_ID, employeeId: 501, bankCode: "GCB", accountNumber: "9988776655", accountName: "=SUM(A1:A9)", branch: null, validFrom: new Date("2020-01-01"), validTo: null });
    fixtures.employeeRows.push({ id: 501, organizationId: ORG_ID, firstName: "Ada", lastName: "Lovelace" });
    mockPermissions(["payroll.payment.manage"]);
    const create = await request(app).post(`/api/organizations/${ORG_ID}/payroll/runs/1/payment-batches`).set("Authorization", "Bearer valid-token");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/payroll/payment-batches/${create.body.batch.id}/export`).set("Authorization", "Bearer valid-token");
    expect(res.text).not.toContain(",=SUM(A1:A9),");
    expect(res.text).toContain("'=SUM(A1:A9)");
  });
});
