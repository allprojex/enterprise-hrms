/**
 * Integration tests for the Asset Register (Phase 3E, W96), exercising the
 * real requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain plus real service-layer validation through supertest. @workspace/db
 * is mocked with the same generic Cond-matching select/insert/update
 * harness established by learningCoursesAndSessions.test.ts, extended with
 * a unique-violation-simulating insert/update for assets (assetTag/
 * serialNumber), mirroring the real W95 partial unique indexes. No real
 * database connection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  return true;
}

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { cause?: { code: string } };
  err.cause = { code: "23505" };
  return err;
}

const {
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  branchesTable,
  assetsTable,
  assetAssignmentsTable,
  auditEventsTable,
  state,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    branchesTable: mockTable("branches", ["id", "organizationId"]),
    assetsTable: mockTable("assets", [
      "id", "organizationId", "assetTag", "categoryCode", "name", "description", "manufacturer", "model",
      "serialNumber", "branchId", "purchaseDate", "purchaseCost", "purchaseCurrency", "warrantyExpiryDate",
      "condition", "status", "notes", "createdBy",
    ]),
    assetAssignmentsTable: mockTable("asset_assignments", ["id", "organizationId", "assetId", "employeeId", "custodyEndedAt", "endReason"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      assetRows: [] as Record<string, unknown>[],
      assetAssignmentRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      nextIds: new Map<string, number>(),
    },
  };
});

function nextId(tableName: string): number {
  const n = (state.nextIds.get(tableName) ?? 0) + 1;
  state.nextIds.set(tableName, n);
  return n;
}

const TABLE_STATE_KEY: Record<string, keyof typeof state> = {
  employees: "employeeRows",
  employee_user_links: "employeeUserLinkRows",
  branches: "branchRows",
  assets: "assetRows",
  asset_assignments: "assetAssignmentRows",
  audit_events: "auditRows",
};

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "organization_memberships") return state.membershipRows;
  if (table.__name === "membership_roles") return state.membershipRoleRows as Record<string, unknown>[];
  if (table.__name === "role_permissions") return state.permissionRows as Record<string, unknown>[];
  if (table.__name === "modules") return state.moduleRows;
  if (table.__name === "organization_modules") return state.organizationModuleRows;
  const key = TABLE_STATE_KEY[table.__name];
  return key ? (state[key] as Record<string, unknown>[]) : [];
}
function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  const key = TABLE_STATE_KEY[table.__name];
  if (key) (state as never as Record<string, unknown>)[key] = rows;
}

/** Simulates W95's own partial unique indexes for assets — thrown as a real unique-violation-shaped error, exercising the real isUniqueViolation-based translation in lib/assets.ts, not merely asserted around. */
function checkAssetUniqueness(table: { __name: string }, candidate: Record<string, unknown>, excludeId?: number) {
  if (table.__name !== "assets") return;
  const rows = rowsFor(table).filter((r) => r.id !== excludeId);
  if (candidate.assetTag != null) {
    if (rows.some((r) => r.organizationId === candidate.organizationId && r.assetTag === candidate.assetTag)) throw uniqueViolation();
  }
  if (candidate.serialNumber != null) {
    if (rows.some((r) => r.organizationId === candidate.organizationId && r.serialNumber === candidate.serialNumber)) throw uniqueViolation();
  }
}

function makeQueryClient(): unknown {
  const client = {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = state.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }
        if (table === membershipRolesTable || table === rolePermissionsTable || table === modulesTable) {
          const rows = rowsFor(table);
          const passthrough = {
            innerJoin: () => passthrough,
            where: () => passthrough,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return passthrough;
        }

        const isCount = !!proj && Object.values(proj).includes("count");
        const rows = rowsFor(table);
        const stage = (
          current: Record<string, unknown>[],
          off = 0,
          lim: number | undefined = undefined,
        ): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const resolved = (): Record<string, unknown>[] => {
            if (isCount) return [{ value: current.length }];
            return lim === undefined ? current.slice(off) : current.slice(off, off + lim);
          };
          const promise = Promise.resolve(resolved());
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond)), off, lim),
            orderBy: () => stage(current, off, lim),
            limit: (n: number) => stage(current, off, n),
            offset: (n: number) => stage(current, n, lim),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const items = Array.isArray(v) ? v : [v];
        for (const item of items) checkAssetUniqueness(table, item);
        const inserted = items.map((item) => ({ id: nextId(table.__name), createdAt: new Date(), updatedAt: new Date(), ...item }));
        setRowsFor(table, [...rowsFor(table), ...inserted]);
        return { returning: () => Promise.resolve(inserted) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = rowsFor(table);
          const updated: Record<string, unknown>[] = [];
          const next = rows.map((r) => {
            if (matches(r, cond)) {
              if (table.__name === "assets") checkAssetUniqueness(table, { ...r, ...patch }, r.id as number);
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
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        return Promise.resolve();
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const db = makeQueryClient();

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
  employeeUserLinksTable,
  branchesTable,
  assetsTable,
  assetAssignmentsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  ilike: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => "count",
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const OTHER_ORG_HR_USER_ID = 3;

function mockSession(userId: number) {
  state.sessionRows = [
    {
      session: { id: userId, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee",
        organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date(),
      },
    },
  ];
}
function mockMembership(userId: number, organizationId: number, membershipId: number) {
  state.membershipRows = [
    ...state.membershipRows.filter((m) => (m as Record<string, unknown>).applicationUserId !== userId),
    { id: membershipId, applicationUserId: userId, organizationId, status: "active" },
  ];
}
function mockPermissions(permissionKeys: string[]) {
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = permissionKeys.map((key) => ({ key }));
}
function mockAssetModuleEnabled(organizationId: number) {
  state.moduleRows = [{ id: 1, key: "asset_management", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  state.organizationModuleRows = [
    ...state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== organizationId),
    { id: state.organizationModuleRows.length + 1, organizationId, moduleId: 1, enabled: true },
  ];
}

const EMPLOYEE_PERMISSIONS = ["asset_management.read.own", "asset_management.write.own", "asset_management.reports.read"];
const HR_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, "asset_management.manage"];

function hrHeaders() {
  mockSession(HR_USER_ID);
  mockPermissions(HR_PERMISSIONS);
  return { Authorization: `Bearer token-${HR_USER_ID}` };
}
function employeeHeaders() {
  mockSession(EMPLOYEE_USER_ID);
  mockPermissions(EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${EMPLOYEE_USER_ID}` };
}
function otherOrgHrHeaders() {
  mockSession(OTHER_ORG_HR_USER_ID);
  mockPermissions(HR_PERMISSIONS);
  return { Authorization: `Bearer token-${OTHER_ORG_HR_USER_ID}` };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [];
  state.organizationModuleRows = [];
  state.employeeRows = [];
  state.employeeUserLinkRows = [];
  state.branchRows = [];
  state.assetRows = [];
  state.assetAssignmentRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockMembership(HR_USER_ID, ORG_ID, 100);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 101);
  mockMembership(OTHER_ORG_HR_USER_ID, OTHER_ORG_ID, 102);
  mockAssetModuleEnabled(ORG_ID);
  mockAssetModuleEnabled(OTHER_ORG_ID);

  state.branchRows = [
    { id: 500, organizationId: ORG_ID },
    { id: 600, organizationId: OTHER_ORG_ID },
  ];
});

describe("Asset Register (W96)", () => {
  describe("module / auth gating", () => {
    it("denies access when asset_management is not enabled", async () => {
      state.organizationModuleRows = [];
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders());
      expect(res.status).toBe(403);
    });

    it("denies unauthenticated requests", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets`);
      expect(res.status).toBe(401);
    });

    it("denies list to an employee without asset_management.manage", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets`).set(employeeHeaders());
      expect(res.status).toBe(403);
    });

    it("denies creation to an employee without asset_management.manage", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(employeeHeaders()).send({ categoryCode: "laptop", name: "Dell Latitude" });
      expect(res.status).toBe(403);
    });
  });

  describe("create", () => {
    it("creates an asset with a server-generated tag, available status, good condition by default", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "Dell Latitude 5420" });
      expect(res.status).toBe(201);
      expect(res.body.assetTag).toBe("AST-00001");
      expect(res.body.status).toBe("available");
      expect(res.body.condition).toBe("good");
      expect(res.body.organizationId).toBe(ORG_ID);
    });

    it("increments the tag sequentially per organization", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "First" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "Second" });
      expect(res.body.assetTag).toBe("AST-00002");
    });

    it("never trusts a client-supplied organizationId, status, or assetTag", async () => {
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets`)
        .set(hrHeaders())
        .send({ categoryCode: "laptop", name: "Spoofed", organizationId: OTHER_ORG_ID, status: "retired", assetTag: "AST-99999" });
      expect(res.status).toBe(201);
      expect(res.body.organizationId).toBe(ORG_ID);
      expect(res.body.status).toBe("available");
      expect(res.body.assetTag).toBe("AST-00001");
    });

    it("accepts free-text categoryCode with no Master Data domain validation (matches learning_courses.categoryCode precedent)", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "totally_made_up_category", name: "Widget" });
      expect(res.status).toBe(201);
      expect(res.body.categoryCode).toBe("totally_made_up_category");
    });

    it("validates branchId belongs to the caller's own organization", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", branchId: 600 });
      expect(res.status).toBe(400);
    });

    it("accepts a same-org branchId", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", branchId: 500 });
      expect(res.status).toBe(201);
      expect(res.body.branchId).toBe(500);
    });

    it("rejects a negative purchaseCost", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", purchaseCost: -5 });
      expect(res.status).toBe(400);
    });

    it("accepts purchaseCost without purchaseCurrency and vice versa — no pairing requirement", async () => {
      const res1 = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", purchaseCost: 1200 });
      expect(res1.status).toBe(201);
      const res2 = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "Y", purchaseCurrency: "GHS" });
      expect(res2.status).toBe(201);
    });

    it("stores an empty-string serialNumber as null (never as a literal empty value, per the partial unique index's own intent)", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", serialNumber: "" });
      expect(res.status).toBe(201);
      expect(res.body.serialNumber).toBeNull();
    });

    it("allows two assets with no serial number in the same organization (both stored as null, never colliding)", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "A" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "B" });
      expect(res.status).toBe(201);
    });

    it("rejects a duplicate serial number within the same organization with a controlled 409, never a raw DB error", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "A", serialNumber: "SN-123" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "B", serialNumber: "SN-123" });
      expect(res.status).toBe(409);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).not.toMatch(/23505|constraint|SQLSTATE/i);
    });

    it("allows the same serial number to exist in two different organizations", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "A", serialNumber: "SN-SHARED" });
      const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "B", serialNumber: "SN-SHARED" });
      expect(res.status).toBe(201);
    });

    it("emits asset.created and no event for a failed validation attempt", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      expect(state.auditRows.some((r) => r.eventType === "asset.created")).toBe(true);
      const countBefore = state.auditRows.length;
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "Y", purchaseCost: -1 });
      expect(state.auditRows.length).toBe(countBefore);
    });

    it("accepts an explicit initial condition", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", condition: "new" });
      expect(res.body.condition).toBe("new");
    });
  });

  describe("list", () => {
    it("is organization-scoped", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "WWM Asset" });
      await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "Acme Asset" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders());
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe("WWM Asset");
    });

    it("returns the {items,total,page,pageSize} pagination shape", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders());
      expect(res.body).toHaveProperty("items");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("pageSize");
    });

    it("filters by status", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "A" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets?status=retired`).set(hrHeaders());
      expect(res.body.items).toHaveLength(0);
    });

    it("filters by categoryCode", async () => {
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "phone", name: "A" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "B" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets?categoryCode=phone`).set(hrHeaders());
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].categoryCode).toBe("phone");
    });
  });

  describe("detail", () => {
    it("returns 404 for a nonexistent asset", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/999999`).set(hrHeaders());
      expect(res.status).toBe(404);
    });

    it("returns 404 (not 403) for a real foreign-org asset id, never leaking existence", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "Acme Only" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders());
      expect(res.status).toBe(404);
    });

    it("allows an asset_management.manage holder to view any org-scoped asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders());
      expect(res.status).toBe(200);
    });

    it("denies an employee holding only asset_management.read.own with no active assignment on this asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(employeeHeaders());
      expect(res.status).toBe(403);
    });
  });

  describe("update", () => {
    it("updates base register fields", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "Old Name" });
      const res = await request(app).patch(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders()).send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("never allows status to change via generic PATCH (not accepted by the schema at all)", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).patch(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders()).send({ status: "retired" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("available");
    });

    it("never allows condition to change via generic PATCH (not accepted by the schema at all)", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).patch(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders()).send({ condition: "damaged" });
      expect(res.status).toBe(200);
      expect(res.body.condition).toBe("good");
    });

    it("returns 404 for a foreign-org asset", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).patch(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders()).send({ name: "Hijacked" });
      expect(res.status).toBe(404);
    });

    it("emits exactly asset.updated with before/after state", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).patch(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders()).send({ name: "Y" });
      const event = state.auditRows.find((r) => r.eventType === "asset.updated");
      expect(event).toBeTruthy();
    });
  });

  describe("retire / mark-lost / recover / condition — the W96-owned lifecycle transitions", () => {
    it("retires an available asset with a mandatory reason", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "End of life" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("retired");
    });

    it("rejects retire without a reason", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({});
      expect(res.status).toBe(400);
    });

    it("is permanently terminal — a second retire attempt is a controlled 409, never a silent no-op or reopen", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "r" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "r2" });
      expect(res.status).toBe(409);
    });

    it("marks an available asset lost with a mandatory reason", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/mark-lost`).set(hrHeaders()).send({ reason: "Missing after office move" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("lost");
    });

    it("recovers a lost asset back to available with a mandatory reason", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/recover`).set(hrHeaders()).send({ reason: "Found in storage" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("available");
    });

    it("rejects recover on an asset that is not currently lost", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/recover`).set(hrHeaders()).send({ reason: "r" });
      expect(res.status).toBe(409);
    });

    it("updates condition via the dedicated route, with a mandatory reason, independent of status", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/condition`).set(hrHeaders()).send({ condition: "damaged", reason: "Screen cracked" });
      expect(res.status).toBe(200);
      expect(res.body.condition).toBe("damaged");
      expect(res.body.status).toBe("available");
    });

    it("rejects condition update without a reason", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/condition`).set(hrHeaders()).send({ condition: "damaged" });
      expect(res.status).toBe(400);
    });

    it("emits exactly asset.retired / asset.marked_lost / asset.recovered / asset.condition_updated — the frozen W96 event names", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/condition`).set(hrHeaders()).send({ condition: "poor", reason: "r" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/recover`).set(hrHeaders()).send({ reason: "r" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "r" });
      const events = state.auditRows.map((r) => r.eventType);
      expect(events).toContain("asset.condition_updated");
      expect(events).toContain("asset.marked_lost");
      expect(events).toContain("asset.recovered");
      expect(events).toContain("asset.retired");
    });

    it("GET/list routes never emit an audit row", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const countAfterCreate = state.auditRows.length;
      await request(app).get(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders());
      await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}`).set(hrHeaders());
      expect(state.auditRows.length).toBe(countAfterCreate);
    });
  });

  describe("scope boundary — no later-workstream surface exists yet", () => {
    it("has no assignment route", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: 1 });
      expect(res.status).toBe(404);
    });
    it("has no incident route", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/report-issue`).set(employeeHeaders()).send({});
      expect(res.status).toBe(404);
    });
    it("has no maintenance route", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/maintenance`).set(hrHeaders());
      expect(res.status).toBe(404);
    });
    it("has no evidence route", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/evidence`).set(hrHeaders());
      expect(res.status).toBe(404);
    });
    it("the Asset DTO carries no employeeId/custody field", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      expect(created.body).not.toHaveProperty("employeeId");
    });
  });
});
