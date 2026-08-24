/**
 * Office Inventory, Workstream 6 — HTTP authorization boundary for
 * incidents/write-offs/adjustments routes. Mirrors the established W1-W5
 * harness, scoped to the auth chain (401/403/module-disabled/400/404) —
 * full business logic (damage/missing report, mark-missing, partial/full
 * recovery, write-off, adjustment, incident linkage, concurrency) was
 * proven live against the real development database (see
 * PROJECT_STATUS.md's Workstream 6 entry). No real database connection is
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
  employeesTable,
  departmentsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryIncidentsTable,
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
      incidentRows: [] as Record<string, unknown>[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId", "classification"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryIncidentsTable: mockTable("office_inventory_incidents", ["id", "organizationId", "itemId", "holderType", "holderId", "incidentType", "status"]),
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
  if (table === officeInventoryIncidentsTable) return fixtures.incidentRows;
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
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ id: 1, status: "reviewed" }]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: 1, status: "open" }]),
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  departmentsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryIncidentsTable,
  officeInventoryStockMovementsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  desc: () => undefined,
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
  getNamespaceConfig: () => Promise.resolve({ data: { writeoffNumber: { prefix: "WOF", sequenceLength: 5 }, adjustmentNumber: { prefix: "ADJ", sequenceLength: 5 } } }),
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
  fixtures.itemRows = [];
  fixtures.storeRows = [];
  fixtures.incidentRows = [];
  fixtures.movementRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("Report incident — office_inventory.report_issue.own", () => {
  const body = { itemId: 1, holderType: "employee", holderId: 1, incidentType: "damage", description: "cracked case" };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.report_issue.own", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.report_issue.own"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.report_issue.own"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/incidents`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, itemId: 9999 });
    expect(res.status).toBe(404);
  });
});

describe("List / get incidents — office_inventory.incident.review", () => {
  it("401 without auth (list)", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/incidents`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.incident.review (list)", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/incidents`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("200 (empty) for an authorized actor (list)", async () => {
    mockPermissions(["office_inventory.incident.review"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/incidents`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("404 for an unknown incident (get one)", async () => {
    mockPermissions(["office_inventory.incident.review"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/incidents/9999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Review incident — office_inventory.incident.review", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/review`).send({ outcome: "dismissed" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.incident.review", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/review`).set("Authorization", "Bearer valid-token").send({ outcome: "dismissed" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown incident even with the permission", async () => {
    mockPermissions(["office_inventory.incident.review"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/9999/review`).set("Authorization", "Bearer valid-token").send({ outcome: "dismissed" });
    expect(res.status).toBe(404);
  });
});

describe("Mark missing — office_inventory.incident.review", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/mark-missing`).send({ quantity: "1.00" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.incident.review", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/mark-missing`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown incident even with the permission", async () => {
    mockPermissions(["office_inventory.incident.review"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/9999/mark-missing`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00" });
    expect(res.status).toBe(404);
  });

  it("400 for an invalid (zero) quantity, even on an open incident", async () => {
    mockPermissions(["office_inventory.incident.review"]);
    fixtures.incidentRows = [{ id: 1, organizationId: ORG_ID, itemId: 1, holderType: "employee", holderId: 1, incidentType: "missing", status: "open" }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/mark-missing`).set("Authorization", "Bearer valid-token").send({ quantity: "0.00" });
    expect(res.status).toBe(400);
  });
});

describe("Recover — office_inventory.recover", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/recover`).send({ quantity: "1.00", destinationStoreId: 1 });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.recover", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/recover`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00", destinationStoreId: 1 });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown incident even with the permission", async () => {
    mockPermissions(["office_inventory.recover"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/9999/recover`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00", destinationStoreId: 1 });
    expect(res.status).toBe(404);
  });
});

describe("Write off (incident-linked) — office_inventory.writeoff", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/write-off`).send({ quantity: "1.00", reason: "confirmed lost" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.writeoff", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/write-off`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00", reason: "confirmed lost" });
    expect(res.status).toBe(403);
  });

  it("400 without a reason, even with the permission", async () => {
    mockPermissions(["office_inventory.writeoff"]);
    fixtures.incidentRows = [{ id: 1, organizationId: ORG_ID, itemId: 1, holderType: "employee", holderId: 1, incidentType: "missing", status: "open" }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/incidents/1/write-off`).set("Authorization", "Bearer valid-token").send({ quantity: "1.00", reason: "" });
    expect(res.status).toBe(400);
  });
});

describe("Direct write-off — office_inventory.writeoff", () => {
  const body = { itemId: 1, sourceType: "store", storeId: 1, quantity: "1.00", reason: "damaged beyond repair" };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/write-offs`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.writeoff", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/write-offs`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("400 when sourceType is store but storeId is missing", async () => {
    mockPermissions(["office_inventory.writeoff"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/write-offs`)
      .set("Authorization", "Bearer valid-token")
      .send({ itemId: 1, sourceType: "store", quantity: "1.00", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("404 for an unknown item even with the permission", async () => {
    mockPermissions(["office_inventory.writeoff"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/write-offs`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, itemId: 9999 });
    expect(res.status).toBe(404);
  });
});

describe("Adjustment — office_inventory.adjust", () => {
  const body = { storeId: 1, itemId: 1, direction: "in", quantity: "2.00", reason: "physical recount" };

  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/adjustments`).send(body);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.adjust", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/adjustments`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("403 when module disabled", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.adjust"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/adjustments`).set("Authorization", "Bearer valid-token").send(body);
    expect(res.status).toBe(403);
  });

  it("400 without a reason, even with the permission", async () => {
    mockPermissions(["office_inventory.adjust"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, reason: "" });
    expect(res.status).toBe(400);
  });

  it("404 for an unknown store even with the permission", async () => {
    mockPermissions(["office_inventory.adjust"]);
    fixtures.itemRows = [{ id: 1, organizationId: ORG_ID, classification: "consumable" }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/adjustments`)
      .set("Authorization", "Bearer valid-token")
      .send({ ...body, storeId: 9999 });
    expect(res.status).toBe(404);
  });
});
