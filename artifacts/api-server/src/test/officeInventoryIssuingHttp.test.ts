/**
 * Office Inventory, Workstream 4 — HTTP authorization boundary for
 * issue/direct-issue/confirm/custody routes. Mirrors the established
 * W1-W3 harness, scoped to the auth chain (401/403/module-disabled) —
 * full business logic (partial/over-fulfilment, custody, direct issue,
 * confirmation eligibility, concurrency) was proven live against the real
 * development database (see PROJECT_STATUS.md's Workstream 4 entry). No
 * real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
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
  employeesTable,
  departmentsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryStockMovementsTable,
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
      employeeRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      requestRows: [] as Record<string, unknown>[],
      requestLineRows: [] as Record<string, unknown>[],
      movementRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
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
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    officeInventoryRequestsTable: mockTable("office_inventory_requests", ["id", "organizationId", "status"]),
    officeInventoryRequestLinesTable: mockTable("office_inventory_request_lines", ["id", "organizationId", "requestId", "approvalStatus"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId", "movementType", "holderType", "holderId", "confirmedAt"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === officeInventoryRequestsTable) return fixtures.requestRows;
  if (table === officeInventoryRequestLinesTable) return fixtures.requestLineRows;
  if (table === officeInventoryStockMovementsTable) return fixtures.movementRows;
  return fixtures.sessionRows;
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
            limit: (n: number) => stage(current.slice(0, n)),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    execute: () => Promise.resolve(undefined),
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
  employeesTable,
  departmentsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryStockMovementsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  inArray: () => undefined,
  or: () => undefined,
  gt: () => undefined,
  gte: () => undefined,
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: () => Promise.resolve(undefined),
}));

vi.mock("../lib/leaveRequests", () => ({
  resolveOwnEmployeeId: () => Promise.resolve(null),
  toIsoDate: (d: Date) => d.toISOString().slice(0, 10),
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: { issueNumber: { prefix: "ISS", sequenceLength: 5 }, directIssueEnabled: true } }),
}));

vi.mock("../lib/numbering", () => ({
  resolvePeriodKey: () => "none",
  lockAndIncrementSequence: () => Promise.resolve(1),
  formatGeneratedNumber: (config: { prefix?: string }, seq: number) => `${config.prefix ?? ""}-${String(seq).padStart(5, "0")}`,
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

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.departmentRows = [];
  fixtures.requestRows = [];
  fixtures.requestLineRows = [];
  fixtures.movementRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("Awaiting-fulfilment queue — office_inventory.issue", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests/awaiting-fulfilment`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.issue", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests/awaiting-fulfilment`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.issue"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests/awaiting-fulfilment`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("200 (empty) for an authorized actor", async () => {
    mockPermissions(["office_inventory.issue"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests/awaiting-fulfilment`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Issue against a request line — office_inventory.issue", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/1/issue`).send({ storeId: 1, quantity: "1.00" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.issue", async () => {
    mockPermissions([]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/1/issue`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, quantity: "1.00" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown line even with the permission", async () => {
    mockPermissions(["office_inventory.issue"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/9999/issue`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, quantity: "1.00" });
    expect(res.status).toBe(404);
  });
});

describe("Direct issue — office_inventory.issue.direct (distinct from .issue)", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/direct-issue`).send({ storeId: 1, itemId: 1, quantity: "1.00", holderType: "employee", holderId: 1, reason: "x" });
    expect(res.status).toBe(401);
  });

  it("403 holding only .issue, not .issue.direct", async () => {
    mockPermissions(["office_inventory.issue"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/direct-issue`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, itemId: 1, quantity: "1.00", holderType: "employee", holderId: 1, reason: "x" });
    expect(res.status).toBe(403);
  });

  it("400 without a reason, even with the permission", async () => {
    mockPermissions(["office_inventory.issue.direct"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/direct-issue`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, itemId: 1, quantity: "1.00", holderType: "employee", holderId: 1, reason: "" });
    expect(res.status).toBe(400);
  });
});

describe("Confirm receipt — office_inventory.receipt.confirm.own", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/movements/1/confirm`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.receipt.confirm.own", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/movements/1/confirm`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("404 for an unknown movement even with the permission", async () => {
    mockPermissions(["office_inventory.receipt.confirm.own"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/movements/9999/confirm`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Custody reads — office_inventory.custody.read", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/employees/1`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.custody.read", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/employees/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 for an actor holding only office_inventory.issue (custody.read is a distinct permission)", async () => {
    mockPermissions(["office_inventory.issue"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/employees/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("404 for an unknown employee, even with the permission", async () => {
    mockPermissions(["office_inventory.custody.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/employees/9999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("200 (empty custody) for a known employee with the permission", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: ORG_ID, departmentId: null }];
    mockPermissions(["office_inventory.custody.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/employees/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("department custody: 404 for an unknown department", async () => {
    mockPermissions(["office_inventory.custody.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/custody/departments/9999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
