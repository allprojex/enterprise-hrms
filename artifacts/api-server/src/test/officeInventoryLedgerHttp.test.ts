/**
 * Office Inventory, Workstream 2 — HTTP authorization boundary
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §20, §23). Mirrors
 * officeInventoryHttp.test.ts's (W1) established harness. Business logic is
 * covered by officeInventoryReceiving.test.ts / officeInventoryLedger.test.ts;
 * this file exercises the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus the "no generic
 * ledger-write route" architectural boundary. No real database connection
 * is made.
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
  officeInventoryStoresTable,
  officeInventoryItemsTable,
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
      itemRows: [] as Record<string, unknown>[],
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
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId", "itemId", "storeId", "movementType", "referenceNumber", "idempotencyKey", "occurredAt"]),
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
  if (table === officeInventoryStoresTable) return fixtures.storeRows;
  if (table === officeInventoryItemsTable) return fixtures.itemRows;
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
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const row = { id: nextId(table), occurredAt: new Date(), createdAt: new Date(), ...v };
          if (table === officeInventoryStockMovementsTable) fixtures.movementRows.push(row);
          return Promise.resolve([row]);
        },
      }),
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
  officeInventoryStoresTable,
  officeInventoryItemsTable,
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
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: () => Promise.resolve(undefined),
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: { receiptNumber: { prefix: "RCV", sequenceLength: 5 } } }),
}));

vi.mock("../lib/numbering", () => ({
  resolvePeriodKey: () => "none",
  lockAndIncrementSequence: () => Promise.resolve(1),
  formatGeneratedNumber: (config: { prefix?: string }, seq: number) => `${config.prefix ?? ""}-${String(seq).padStart(5, "0")}`,
}));

const { default: app } = await import("../app");
const { default: officeInventoryLedgerRouter } = await import("../routes/officeInventoryLedger");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

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
  fixtures.storeRows = [{ id: 1, organizationId: ORG_ID }, { id: 2, organizationId: OTHER_ORG_ID }];
  fixtures.itemRows = [{ id: 100, organizationId: ORG_ID }, { id: 200, organizationId: OTHER_ORG_ID }];
  fixtures.movementRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("no generic ledger-write route exists", () => {
  it("registers only GET and POST methods on office-inventory ledger paths — no PATCH/PUT/DELETE anywhere", () => {
    const stack = (officeInventoryLedgerRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const routes = stack.filter((layer) => layer.route).map((layer) => layer.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const methods = Object.keys(route.methods);
      for (const method of methods) {
        expect(["get", "post"]).toContain(method);
      }
    }
  });

  it("the only POST route is receiving — no route lets a client POST an arbitrary movementType", () => {
    const stack = (officeInventoryLedgerRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const postRoutes = stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route!.path);
    expect(postRoutes).toEqual(["/organizations/:organizationId/office-inventory/receiving"]);
  });
});

describe("POST /api/organizations/:organizationId/office-inventory/receiving", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/receiving`).send({ storeId: 1, lines: [{ itemId: 100, quantity: "10.00" }] });
    expect(res.status).toBe(401);
  });

  it("returns 403 without office_inventory.receive", async () => {
    mockPermissions(["office_inventory.custody.read"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/receiving`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, lines: [{ itemId: 100, quantity: "10.00" }] });
    expect(res.status).toBe(403);
  });

  it("returns 403 when office_inventory module is disabled, even with the permission", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/receiving`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, lines: [{ itemId: 100, quantity: "10.00" }] });
    expect(res.status).toBe(403);
  });

  it("succeeds for an explicitly authorized actor", async () => {
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/receiving`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, lines: [{ itemId: 100, quantity: "10.00" }] });
    expect(res.status).toBe(201);
    expect(res.body.lines).toHaveLength(1);
  });

  it("rejects a cross-org store even for an explicitly authorized actor (IDOR)", async () => {
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/receiving`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 2, lines: [{ itemId: 100, quantity: "10.00" }] }); // store 2 belongs to OTHER_ORG_ID
    expect(res.status).toBe(400);
  });

  it("rejects a cross-org item even for an explicitly authorized actor (IDOR)", async () => {
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/receiving`)
      .set("Authorization", "Bearer valid-token")
      .send({ storeId: 1, lines: [{ itemId: 200, quantity: "10.00" }] }); // item 200 belongs to OTHER_ORG_ID
    expect(res.status).toBe(400);
  });
});

describe("GET stock balance / movements / receiving — office_inventory.receive", () => {
  it("returns 403 for hr_manager-shaped permissions without office_inventory.receive", async () => {
    mockPermissions(["employee.read", "employee.write"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stock/balance?itemId=100`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  // Permission reconciliation (post-W2): office_inventory.custody.read is
  // reserved exclusively for future HOLDER (employee/department) custody —
  // it must NOT grant access to store-stock/movement/receiving reads, per
  // the frozen plan's own "no confidential HR data exposed merely because
  // someone manages Inventory operations" principle (§35) and its own
  // consistent "balance" (storeId) vs "custody" (holderType/holderId)
  // schema-comment vocabulary (§7.3).
  it("custody.read alone does NOT grant access to store stock/movement/receiving reads", async () => {
    mockPermissions(["office_inventory.custody.read"]);
    const balanceRes = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stock/balance?itemId=100`).set("Authorization", "Bearer valid-token");
    const movementsRes = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stock/movements?itemId=100`).set("Authorization", "Bearer valid-token");
    const receivingRes = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/receiving`).set("Authorization", "Bearer valid-token");
    expect(balanceRes.status).toBe(403);
    expect(movementsRes.status).toBe(403);
    expect(receivingRes.status).toBe(403);
  });

  it("succeeds for an authorized actor and returns a zero balance for a never-moved item", async () => {
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stock/movements?itemId=100`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("succeeds for an authorized actor listing receiving history", async () => {
    mockPermissions(["office_inventory.receive"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/receiving`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
