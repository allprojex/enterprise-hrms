/**
 * Office Inventory, Workstream 7 — HTTP authorization boundary for
 * stocktake routes. Mirrors the established W1-W6 harness, scoped to the
 * auth chain (401/403/module-disabled/400/404/409) — full business logic
 * (snapshot-at-start, post-snapshot reconciliation, count/recount,
 * adjustment/missing resolution, finalization rules and immutability,
 * concurrency) was proven live against the real development database (see
 * PROJECT_STATUS.md's Workstream 7 entry). No real database connection is
 * made.
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  officeInventoryStoresTable,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
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
      storeRows: [] as Record<string, unknown>[],
      stocktakeRows: [] as Record<string, unknown>[],
      stocktakeLineRows: [] as Record<string, unknown>[],
      movementRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "defaultEnabled", "requiredModuleKeys", "status"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryStocktakesTable: mockTable("office_inventory_stocktakes", ["id", "organizationId", "storeId", "status", "startedAt"]),
    officeInventoryStocktakeLinesTable: mockTable("office_inventory_stocktake_lines", ["id", "organizationId", "stocktakeId", "itemId", "countedQuantity"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId", "idempotencyKey"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === officeInventoryStoresTable) return fixtures.storeRows;
  if (table === officeInventoryStocktakesTable) return fixtures.stocktakeRows;
  if (table === officeInventoryStocktakeLinesTable) return fixtures.stocktakeLineRows;
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  officeInventoryStoresTable,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
  officeInventoryStockMovementsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  desc: () => undefined,
  gt: () => undefined,
  inArray: () => undefined,
  or: () => undefined,
  gte: () => undefined,
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: () => Promise.resolve(undefined),
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: { stocktakeNumber: { prefix: "STK", sequenceLength: 5 }, adjustmentNumber: { prefix: "ADJ", sequenceLength: 5 } } }),
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
  fixtures.storeRows = [];
  fixtures.stocktakeRows = [];
  fixtures.stocktakeLineRows = [];
  fixtures.movementRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("Create stocktake — office_inventory.stocktake", () => {
  const body = { storeId: 1 };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("404 for an unknown store even with the permission", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 9999 });
    expect(res.status).toBe(404);
  });
});

describe("List / get stocktakes — office_inventory.stocktake", () => {
  it("401 without auth (list)", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake (list)", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("200 (empty) for an authorized actor (list)", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stocktakes`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("404 for an unknown stocktake (get one)", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/9999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Start stocktake — office_inventory.stocktake", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/start`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/start`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("404 for an unknown stocktake even with the permission", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/9999/start`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("409 when the stocktake is not draft", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    fixtures.stocktakeRows = [{ id: 1, organizationId: ORG_ID, storeId: 1, status: "counting", startedAt: new Date() }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/start`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });
});

describe("Record count — office_inventory.stocktake", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/lines/1/count`).send({ countedQuantity: "5.00" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/lines/1/count`).set("Authorization", "Bearer valid-token").send({ countedQuantity: "5.00" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown stocktake even with the permission", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/9999/lines/1/count`).set("Authorization", "Bearer valid-token").send({ countedQuantity: "5.00" });
    expect(res.status).toBe(404);
  });

  it("400 for a negative counted quantity, even on a countable stocktake", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    fixtures.stocktakeRows = [{ id: 1, organizationId: ORG_ID, storeId: 1, status: "counting", startedAt: new Date() }];
    fixtures.stocktakeLineRows = [{ id: 1, organizationId: ORG_ID, stocktakeId: 1, itemId: 1, countedQuantity: null }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/lines/1/count`).set("Authorization", "Bearer valid-token").send({ countedQuantity: "-1.00" });
    expect(res.status).toBe(400);
  });
});

describe("Resolve line — office_inventory.stocktake", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/lines/1/resolve`).send({ resolutionType: "adjustment", reason: "x" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/lines/1/resolve`).set("Authorization", "Bearer valid-token").send({ resolutionType: "adjustment", reason: "x" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown stocktake even with the permission", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/9999/lines/1/resolve`).set("Authorization", "Bearer valid-token").send({ resolutionType: "adjustment", reason: "x" });
    expect(res.status).toBe(404);
  });
});

describe("Finalize stocktake — office_inventory.stocktake", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/finalize`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.stocktake", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("404 for an unknown stocktake even with the permission", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/9999/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("409 when the stocktake is draft (never started)", async () => {
    mockPermissions(["office_inventory.stocktake"]);
    fixtures.stocktakeRows = [{ id: 1, organizationId: ORG_ID, storeId: 1, status: "draft", startedAt: null }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/stocktakes/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });
});
