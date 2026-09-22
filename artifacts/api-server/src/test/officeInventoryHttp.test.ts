/**
 * Office Inventory, Workstream 1 — HTTP authorization boundary
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §K). Exercises the real
 * requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest with a mocked @workspace/db, mirroring
 * payrollPaymentBatchesHttp.test.ts's established harness. Business logic
 * (code generation, effective-dating, collision handling) is covered by
 * departmentHeads.test.ts / officeInventoryCatalog.test.ts, not duplicated
 * here. No real database connection is made.
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
  departmentsTable,
  departmentHeadsTable,
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
      departmentRows: [] as Record<string, unknown>[],
      headRows: [] as Record<string, unknown>[],
      itemRows: [] as Record<string, unknown>[],
      storeRows: [] as Record<string, unknown>[],
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
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "headMembershipId", "validFrom", "validTo"]),
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId", "itemCode", "name", "categoryCode", "classification", "status"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId", "name", "code", "status"]),
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
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === departmentHeadsTable) return fixtures.headRows;
  if (table === officeInventoryItemsTable) return fixtures.itemRows;
  if (table === officeInventoryStoresTable) return fixtures.storeRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === departmentHeadsTable) fixtures.headRows = rows;
  else if (table === officeInventoryItemsTable) fixtures.itemRows = rows;
  else if (table === officeInventoryStoresTable) fixtures.storeRows = rows;
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
            limit: (n: number) => stage(current.slice(0, n)),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), validTo: null, ...v };
        setRowsFor(table, [...rowsFor(table), row]);
        return { returning: () => Promise.resolve([row]) };
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
  departmentsTable,
  departmentHeadsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  or: () => undefined,
  gt: () => undefined,
  inArray: () => undefined,
  ilike: () => undefined,
  desc: () => undefined,
  count: () => "count",
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: () => Promise.resolve(undefined),
}));

const { default: app } = await import("../app");

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
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function seedDepartment(organizationId = ORG_ID) {
  const dept = { id: nextId(departmentsTable), organizationId };
  fixtures.departmentRows = [...fixtures.departmentRows, dept];
  return dept;
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
  fixtures.departmentRows = [];
  fixtures.headRows = [];
  fixtures.itemRows = [];
  fixtures.storeRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
});

describe("Department Head routes — general primitive, independent of office_inventory module state", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/departments/1/head`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a plain employee with no department.head.manage permission", async () => {
    mockPermissions([]);
    const dept = seedDepartment();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/departments/${dept.id}/head`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 for an org_admin who lacks department.head.manage specifically", async () => {
    mockPermissions(["organization.read", "membership.manage"]);
    const dept = seedDepartment();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/departments/${dept.id}/head`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("works even when office_inventory is disabled — Department Headship is a general primitive, not gated by the module", async () => {
    setModuleEnabled(false);
    mockPermissions(["department.head.manage"]);
    const dept = seedDepartment();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/departments/${dept.id}/head`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("an explicitly authorized actor can assign a Head, and cross-org department IDs 404", async () => {
    mockPermissions(["department.head.manage"]);
    const deptOrgA = seedDepartment(ORG_ID);
    const deptOrgB = seedDepartment(OTHER_ORG_ID);

    const assignRes = await request(app)
      .post(`/api/organizations/${ORG_ID}/departments/${deptOrgA.id}/head`)
      .set("Authorization", "Bearer valid-token")
      .send({ headMembershipId: 5 });
    expect(assignRes.status).toBe(201);
    expect(assignRes.body.headMembershipId).toBe(5);

    const crossOrgRes = await request(app)
      .post(`/api/organizations/${ORG_ID}/departments/${deptOrgB.id}/head`)
      .set("Authorization", "Bearer valid-token")
      .send({ headMembershipId: 5 });
    expect(crossOrgRes.status).toBe(404);
  });

  it("resolves as-of a historical date via the query parameter", async () => {
    mockPermissions(["department.head.manage"]);
    const dept = seedDepartment();
    fixtures.headRows = [
      { id: 1, organizationId: ORG_ID, departmentId: dept.id, headMembershipId: 100, validFrom: new Date("2026-01-01T00:00:00Z"), validTo: new Date("2026-06-01T00:00:00Z") },
      { id: 2, organizationId: ORG_ID, departmentId: dept.id, headMembershipId: 200, validFrom: new Date("2026-06-01T00:00:00Z"), validTo: null },
    ];

    const mayRes = await request(app).get(`/api/organizations/${ORG_ID}/departments/${dept.id}/head/as-of?date=2026-05-15T00:00:00Z`).set("Authorization", "Bearer valid-token");
    expect(mayRes.body.headMembershipId).toBe(100);

    const augRes = await request(app).get(`/api/organizations/${ORG_ID}/departments/${dept.id}/head/as-of?date=2026-08-15T00:00:00Z`).set("Authorization", "Bearer valid-token");
    expect(augRes.body.headMembershipId).toBe(200);
  });
});

describe("Office Inventory catalog routes — module-gated", () => {
  it("returns 403 when office_inventory is not enabled for the organization, even with full permissions", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.item.manage", "office_inventory.store.manage"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/items`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 for hr_manager-shaped permissions without office_inventory.item.manage, even with the module enabled", async () => {
    setModuleEnabled(true);
    mockPermissions(["employee.read", "employee.write"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/items`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("succeeds for an explicitly authorized actor once the module is enabled", async () => {
    setModuleEnabled(true);
    mockPermissions(["office_inventory.store.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/stores`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Head Office Store", code: "HO-01" });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe("HO-01");
  });

  it("cross-org store IDs 404 rather than leaking another organization's store", async () => {
    setModuleEnabled(true);
    mockPermissions(["office_inventory.store.manage"]);
    fixtures.storeRows = [{ id: 1, organizationId: OTHER_ORG_ID, name: "Other Org Store", code: "X-01", status: "active" }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/stores/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
