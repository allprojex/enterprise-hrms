/**
 * Office Inventory, Workstream 5 — HTTP authorization boundary for
 * returns/handovers/transfers routes. Mirrors the established W1-W4
 * harness, scoped to the auth chain (401/403/module-disabled/400/404) —
 * full business logic (partial return, over-return, all four handover
 * directions, department-to-department authority, store transfer,
 * concurrency) was proven live against the real development database (see
 * PROJECT_STATUS.md's Workstream 5 entry). No real database connection is
 * made. `resolveApprovalAuthority` is mocked directly (not deep-mocked via
 * its own department_heads/delegation table dependencies), matching this
 * suite's own established precedent for cross-cutting lib functions.
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
  officeInventoryItemsTable,
  officeInventoryStoresTable,
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
      itemRows: [] as Record<string, unknown>[],
      storeRows: [] as Record<string, unknown>[],
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
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId", "classification"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId", "idempotencyKey"]),
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
  if (table === officeInventoryItemsTable) return fixtures.itemRows;
  if (table === officeInventoryStoresTable) return fixtures.storeRows;
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
  officeInventoryItemsTable,
  officeInventoryStoresTable,
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
  getNamespaceConfig: () => Promise.resolve({ data: { returnNumber: { prefix: "RET", sequenceLength: 5 }, handoverNumber: { prefix: "HAN", sequenceLength: 5 }, transferNumber: { prefix: "TRF", sequenceLength: 5 } } }),
}));

vi.mock("../lib/numbering", () => ({
  resolvePeriodKey: () => "none",
  lockAndIncrementSequence: () => Promise.resolve(1),
  formatGeneratedNumber: (config: { prefix?: string }, seq: number) => `${config.prefix ?? ""}-${String(seq).padStart(5, "0")}`,
}));

let approvalAuthorityResult: unknown = null;
vi.mock("../lib/officeInventoryDelegations", () => ({
  resolveApprovalAuthority: () => Promise.resolve(approvalAuthorityResult),
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
  fixtures.itemRows = [];
  fixtures.storeRows = [];
  fixtures.movementRows = [];
  fixtures.idCounters = new Map();
  approvalAuthorityResult = null;
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("Return — office_inventory.return", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/returns`).send({ itemId: 1, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "1.00" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.return", async () => {
    mockPermissions([]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/returns`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "1.00" });
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.return"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/returns`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "1.00" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.return"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/returns`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 9999, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "1.00" });
    expect(res.status).toBe(404);
  });

  it("400 for a consumable item", async () => {
    mockPermissions(["office_inventory.return"]);
    fixtures.itemRows = [{ id: 1, organizationId: ORG_ID, classification: "consumable" }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/returns`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "1.00" });
    expect(res.status).toBe(400);
  });

  it("400 for an invalid (zero) quantity", async () => {
    mockPermissions(["office_inventory.return"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/returns`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, holderType: "employee", holderId: 1, destinationStoreId: 1, quantity: "0.00" });
    expect(res.status).toBe(400);
  });
});

describe("Handover — office_inventory.handover", () => {
  const body = { itemId: 1, fromHolderType: "employee", fromHolderId: 1, toHolderType: "employee", toHolderId: 2, quantity: "1.00" };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/handovers`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.handover", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/handovers`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.handover"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/handovers`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("400 when source and destination holder are identical", async () => {
    mockPermissions(["office_inventory.handover"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/handovers`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, toHolderType: "employee", toHolderId: 1 });
    expect(res.status).toBe(400);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.handover"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/handovers`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, itemId: 9999 });
    expect(res.status).toBe(404);
  });

  it("403 for a department-to-department handover when the actor is neither the receiving department's Head nor a valid delegate", async () => {
    mockPermissions(["office_inventory.handover"]);
    fixtures.itemRows = [{ id: 1, organizationId: ORG_ID, classification: "returnable" }];
    fixtures.departmentRows = [
      { id: 1, organizationId: ORG_ID },
      { id: 2, organizationId: ORG_ID },
    ];
    approvalAuthorityResult = null;
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/handovers`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, fromHolderType: "department", fromHolderId: 1, toHolderType: "department", toHolderId: 2, quantity: "1.00" });
    expect(res.status).toBe(403);
  });
});

describe("Store transfer — office_inventory.transfer", () => {
  const body = { itemId: 1, fromStoreId: 1, toStoreId: 2, quantity: "1.00" };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/transfers`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.transfer", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/transfers`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.transfer"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/transfers`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("400 when source and destination store are identical", async () => {
    mockPermissions(["office_inventory.transfer"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/transfers`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, toStoreId: 1 });
    expect(res.status).toBe(400);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.transfer"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/transfers`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, itemId: 9999 });
    expect(res.status).toBe(404);
  });
});
