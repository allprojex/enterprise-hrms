/**
 * Office Inventory, Workstream 10 — HTTP authorization boundary for the
 * Assets Handoff route. Mirrors the established W1-W9 harness, scoped to
 * the auth chain (401/403/module-disabled/eligibility/404) — the deep
 * cross-module transaction (createAsset + ledger append under lock,
 * concurrency, replay, failure atomicity) is proven live against the real
 * development database (see PROJECT_STATUS.md's Workstream 10 entry),
 * mirroring this same epic's own established precedent (W9's reporting
 * tests) rather than this codebase's JS query-chain mock, which cannot
 * meaningfully simulate a real cross-module transaction. No real database
 * connection is made.
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
  officeInventoryItemsTable,
  officeInventoryStoresTable,
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
      itemRows: [] as Record<string, unknown>[],
      storeRows: [] as Record<string, unknown>[],
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
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId", "classification"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === officeInventoryItemsTable) return fixtures.itemRows;
  if (table === officeInventoryStoresTable) return fixtures.storeRows;
  return [];
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const b = { innerJoin: () => b, where: () => b, limit: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject) };
          return b;
        }
        if (table === membershipRolesTable || table === rolePermissionsTable) {
          const rows = rowsFor(table);
          const b = { innerJoin: () => b, where: () => b, limit: () => Promise.resolve(rows), orderBy: () => Promise.resolve(rows), then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject) };
          return b;
        }
        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return { where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))), limit: (n: number) => stage(current.slice(0, n)), then: promise.then.bind(promise) } as never;
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
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable: (() => {
    const t: Record<string, string> & { __name: string } = { __name: "office_inventory_stock_movements" } as never;
    for (const c of ["id", "organizationId", "idempotencyKey"]) t[c] = `office_inventory_stock_movements.${c}`;
    return t;
  })(),
  assetsTable: (() => {
    const t: Record<string, string> & { __name: string } = { __name: "assets" } as never;
    for (const c of ["id"]) t[c] = `assets.${c}`;
    return t;
  })(),
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  gt: () => undefined,
  gte: () => undefined,
  lte: () => undefined,
  or: () => undefined,
  isNull: () => undefined,
  inArray: () => undefined,
  desc: () => undefined,
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({ recordAuditEvent: () => Promise.resolve(undefined) }));

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
function setModulesEnabled(officeInventory: boolean, assetManagement: boolean) {
  fixtures.moduleRows = [
    { id: 1, key: "office_inventory", defaultEnabled: false, requiredModuleKeys: [], status: "hidden" },
    { id: 2, key: "asset_management", defaultEnabled: false, requiredModuleKeys: [], status: "hidden" },
  ];
  fixtures.orgModuleRows = [
    ...(officeInventory ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : []),
    ...(assetManagement ? [{ id: 2, organizationId: ORG_ID, moduleId: 2, enabled: true }] : []),
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.itemRows = [];
  fixtures.storeRows = [];
  mockSession();
  mockActiveMembership();
  setModulesEnabled(true, true);
});

const body = { itemId: 1, storeId: 1, assetCategoryCode: "IT_EQUIPMENT" };

describe("POST asset-handoff — office_inventory.asset_handoff + both modules enabled", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.asset_handoff", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when office_inventory module disabled, even with the permission", async () => {
    setModulesEnabled(false, true);
    mockPermissions(["office_inventory.asset_handoff"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when asset_management module disabled, even with office_inventory enabled and the permission (never silently enables Assets)", async () => {
    setModulesEnabled(true, false);
    mockPermissions(["office_inventory.asset_handoff"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.asset_handoff"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(404);
  });

  it("400 for a consumable item (not eligible for handoff)", async () => {
    mockPermissions(["office_inventory.asset_handoff"]);
    fixtures.itemRows = [{ id: 1, organizationId: ORG_ID, classification: "consumable" }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(400);
  });

  it("404 for an unknown store, for a returnable item", async () => {
    mockPermissions(["office_inventory.asset_handoff"]);
    fixtures.itemRows = [{ id: 1, organizationId: ORG_ID, classification: "returnable" }];
    fixtures.storeRows = [];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(404);
  });

  it("400 for a missing required assetCategoryCode", async () => {
    mockPermissions(["office_inventory.asset_handoff"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/asset-handoff`).set("Authorization", "Bearer valid-token").send({ itemId: 1, storeId: 1 });
    expect(res.status).toBe(400);
  });
});
