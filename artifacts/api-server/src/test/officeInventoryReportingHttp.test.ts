/**
 * Office Inventory, Workstream 9 — HTTP authorization boundary for
 * dashboard/reporting routes. Mirrors the established W1-W8 harness, scoped
 * to the auth chain (401/403/module-disabled/404-unknown-report) — the
 * underlying aggregation math (SUM/GROUP BY over the real ledger, batched
 * name resolution) is proven live against the real development database
 * (see PROJECT_STATUS.md's Workstream 9 entry and its Report Reconciliation
 * Master Scenario), not through this codebase's own JS-based query-chain
 * mock, which cannot meaningfully execute real SQL aggregation. No real
 * database connection is made.
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  reportsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryIncidentsTable,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
  departmentsTable,
  departmentHeadsTable,
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
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "defaultEnabled", "requiredModuleKeys", "status"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId"]),
    officeInventoryRequestsTable: mockTable("office_inventory_requests", ["id", "organizationId", "status"]),
    officeInventoryRequestLinesTable: mockTable("office_inventory_request_lines", ["id", "organizationId", "approvalStatus"]),
    officeInventoryIncidentsTable: mockTable("office_inventory_incidents", ["id", "organizationId", "status"]),
    officeInventoryStocktakesTable: mockTable("office_inventory_stocktakes", ["id", "organizationId", "status"]),
    officeInventoryStocktakeLinesTable: mockTable("office_inventory_stocktake_lines", ["id", "organizationId", "stocktakeId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "validTo"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === reportsTable) return fixtures.reportRows;
  return [];
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }
        if (table === membershipRolesTable || table === rolePermissionsTable) {
          const rows = rowsFor(table);
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }

        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            groupBy: () => stage(current),
            selectDistinctOn: () => stage(current),
            limit: (n: number) => stage(current.slice(0, n)),
            for: () => stage(current),
            innerJoin: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    selectDistinctOn: () => ({
      from(table: { __name: string }) {
        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
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
  reportsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryIncidentsTable,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
  departmentsTable,
  departmentHeadsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: () => undefined,
  gt: () => undefined,
  gte: () => undefined,
  lte: () => undefined,
  inArray: () => undefined,
  desc: () => undefined,
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: {} }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}
function mockActiveMembership(organizationId = ORG_ID, membershipId = 5) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}
function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}
function setModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "office_inventory", defaultEnabled: false, requiredModuleKeys: [], status: "hidden" }];
  fixtures.orgModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}
function registerReport(key: string) {
  fixtures.reportRows = [{ key, label: "Test Report", description: "Test", category: "office_inventory", requiredPermissionKey: "office_inventory.reports.read" }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.reportRows = [];
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("GET dashboard — office_inventory.reports.read", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/dashboard`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.reports.read", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 when module disabled even with the permission", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.reports.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("200 with zero-filled tiles for an authorized actor with no data", async () => {
    mockPermissions(["office_inventory.reports.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      stockItems: 0,
      lowStockItems: 0,
      outOfStockItems: 0,
      outstandingReturnables: 0,
      overdueReturnables: 0,
      pendingApprovals: 0,
      pendingIssues: 0,
      pendingReceiptConfirmations: 0,
      openMissingDamagedIncidents: 0,
      unresolvedStocktakeVariances: 0,
    });
  });
});

describe("GET reports/:reportKey — office_inventory.reports.read", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/office_inventory_current_stock`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.reports.read", async () => {
    mockPermissions([]);
    registerReport("office_inventory_current_stock");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/office_inventory_current_stock`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 when module disabled even with the permission", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.reports.read"]);
    registerReport("office_inventory_current_stock");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/office_inventory_current_stock`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("404 for a report key not registered in the reports table", async () => {
    mockPermissions(["office_inventory.reports.read"]);
    fixtures.reportRows = [];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/not_a_real_report`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("404 for a report registered under a DIFFERENT category (never runnable cross-category)", async () => {
    mockPermissions(["office_inventory.reports.read"]);
    fixtures.reportRows = [{ key: "headcount", label: "Headcount", description: "x", category: "workforce", requiredPermissionKey: "employee.read" }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/headcount`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("200 (empty rows) for a known, correctly-categorized report with no data", async () => {
    mockPermissions(["office_inventory.reports.read"]);
    registerReport("office_inventory_current_stock");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/office_inventory_current_stock`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("office_inventory_current_stock");
    expect(res.body.rows).toEqual([]);
  });

  it("200 text/csv for ?format=csv on a known report", async () => {
    mockPermissions(["office_inventory.reports.read"]);
    registerReport("office_inventory_current_stock");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/reports/office_inventory_current_stock?format=csv`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
  });
});
