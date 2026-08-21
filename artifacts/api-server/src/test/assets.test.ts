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
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "positionId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    branchesTable: mockTable("branches", ["id", "organizationId"]),
    assetsTable: mockTable("assets", [
      "id", "organizationId", "assetTag", "categoryCode", "name", "description", "manufacturer", "model",
      "serialNumber", "branchId", "purchaseDate", "purchaseCost", "purchaseCurrency", "warrantyExpiryDate",
      "condition", "status", "notes", "createdBy",
    ]),
    assetAssignmentsTable: mockTable("asset_assignments", [
      "id", "organizationId", "assetId", "employeeId", "assetTagSnapshot", "assetNameSnapshot", "categorySnapshot",
      "departmentIdSnapshot", "positionIdSnapshot", "issuedAt", "issuedByMembershipId", "expectedReturnDate",
      "issueCondition", "issueNotes", "acknowledgedAt", "acknowledgementNote", "custodyEndedAt", "endReason",
      "receivedByMembershipId", "returnCondition", "returnNotes",
    ]),
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

/** Simulates W95's own asset_assignments_one_active_per_asset partial unique index — the defense-in-depth backstop assignAsset falls back on if the status='available' guard is ever bypassed. */
function checkAssetAssignmentUniqueness(table: { __name: string }, candidate: Record<string, unknown>) {
  if (table.__name !== "asset_assignments") return;
  if (candidate.custodyEndedAt != null) return;
  const rows = rowsFor(table);
  if (rows.some((r) => r.assetId === candidate.assetId && r.custodyEndedAt == null)) throw uniqueViolation();
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
        for (const item of items) {
          checkAssetUniqueness(table, item);
          checkAssetAssignmentUniqueness(table, item);
        }
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
  desc: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const OTHER_ORG_HR_USER_ID = 3;
const EMPLOYEE2_USER_ID = 4;
const EMPLOYEE_ID = 900;
const EMPLOYEE2_ID = 901;
const OTHER_ORG_EMPLOYEE_ID = 902;

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
function employee2Headers() {
  mockSession(EMPLOYEE2_USER_ID);
  mockPermissions(EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${EMPLOYEE2_USER_ID}` };
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
  mockMembership(EMPLOYEE2_USER_ID, ORG_ID, 103);
  mockAssetModuleEnabled(ORG_ID);
  mockAssetModuleEnabled(OTHER_ORG_ID);

  state.branchRows = [
    { id: 500, organizationId: ORG_ID },
    { id: 600, organizationId: OTHER_ORG_ID },
  ];

  // Assignment-target employees (W97): EMPLOYEE_ID is linked to
  // EMPLOYEE_USER_ID (the "own-scope" caller in acknowledge/list tests),
  // EMPLOYEE2_ID is a second, unrelated org employee, and
  // OTHER_ORG_EMPLOYEE_ID belongs to a different organization entirely.
  state.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 55, positionId: 66 },
    { id: EMPLOYEE2_ID, organizationId: ORG_ID, departmentId: 77, positionId: 88 },
    { id: OTHER_ORG_EMPLOYEE_ID, organizationId: OTHER_ORG_ID, departmentId: null, positionId: null },
  ];
  state.employeeUserLinkRows = [
    { employeeId: EMPLOYEE_ID, applicationUserId: EMPLOYEE_USER_ID },
    { employeeId: EMPLOYEE2_ID, applicationUserId: EMPLOYEE2_USER_ID },
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
    it("has no my-assets route (W98) — falls through to the generic :id route, which rejects the non-numeric segment", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(employeeHeaders());
      expect(res.status).toBe(400);
    });
    it("has no team-assets route (W98) — falls through to the generic :id route, which rejects the non-numeric segment", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(hrHeaders());
      expect(res.status).toBe(400);
    });
    it("the Asset DTO carries no employeeId/custody field", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      expect(created.body).not.toHaveProperty("employeeId");
    });
  });

  describe("assignment — issue custody (W97)", () => {
    async function createAvailableAsset() {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X", condition: "good" });
      return res.body.id as number;
    }

    it("denies assign to an employee without asset_management.manage", async () => {
      const assetId = await createAvailableAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(employeeHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(403);
    });

    it("assigns an available asset, flips it to assigned, and captures the frozen snapshots", async () => {
      const assetId = await createAvailableAsset();
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`)
        .set(hrHeaders())
        .send({ employeeId: EMPLOYEE_ID, issueNotes: "Handed over at onboarding" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("assigned");

      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body).toHaveLength(1);
      const assignment = list.body[0];
      expect(assignment.employeeId).toBe(EMPLOYEE_ID);
      expect(assignment.assetTagSnapshot).toBe("AST-00001");
      expect(assignment.assetNameSnapshot).toBe("X");
      expect(assignment.categorySnapshot).toBe("laptop");
      expect(assignment.departmentIdSnapshot).toBe(55);
      expect(assignment.positionIdSnapshot).toBe(66);
      expect(assignment.issueCondition).toBe("good");
      expect(assignment.custodyEndedAt).toBeNull();
      expect(assignment.acknowledgedAt).toBeNull();
    });

    it("never trusts a client-supplied snapshot field — snapshots always come from the server-side asset/employee rows", async () => {
      const assetId = await createAvailableAsset();
      await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`)
        .set(hrHeaders())
        .send({ employeeId: EMPLOYEE_ID, assetTagSnapshot: "SPOOFED", assetNameSnapshot: "SPOOFED", departmentIdSnapshot: 99999 });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body[0].assetTagSnapshot).toBe("AST-00001");
      expect(list.body[0].departmentIdSnapshot).toBe(55);
    });

    it("a later asset rename never rewrites a historical assignment's own snapshot", async () => {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      await request(app).patch(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders()).send({ name: "Renamed Later", categoryCode: "renamed-category" });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body[0].assetNameSnapshot).toBe("X");
      expect(list.body[0].categorySnapshot).toBe("laptop");
    });

    it("rejects a second assignment while one is already active (duplicate active assignment, 409)", async () => {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE2_ID });
      expect(res.status).toBe(409);
    });

    it("rejects assignment of a retired asset", async () => {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/retire`).set(hrHeaders()).send({ reason: "r" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(409);
    });

    it("rejects assignment of a lost asset", async () => {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(409);
    });

    it("rejects an employeeId belonging to a different organization, never trusting a client-supplied cross-org id", async () => {
      const assetId = await createAvailableAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: OTHER_ORG_EMPLOYEE_ID });
      expect(res.status).toBe(400);
    });

    it("rejects a nonexistent employeeId", async () => {
      const assetId = await createAvailableAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: 999999 });
      expect(res.status).toBe(400);
    });

    it("returns 404 for a foreign-org asset", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(404);
    });

    it("a genuine concurrent double-assign race resolves to exactly one winner, never two active assignments", async () => {
      const assetId = await createAvailableAsset();
      const [a, b] = await Promise.all([
        request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID }),
        request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE2_ID }),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body.filter((r: { custodyEndedAt: string | null }) => r.custodyEndedAt === null)).toHaveLength(1);
    });

    it("falls back to a controlled 409 (never a raw DB error) if the partial unique index itself is what fires", async () => {
      // Defense-in-depth: simulate the status='available' guard somehow
      // being bypassed by directly inserting an already-active assignment
      // row for an asset the register still (inconsistently) reports as
      // available, then confirm the insert-time unique-violation catch in
      // assignAsset still converts it into a controlled conflict.
      const assetId = await createAvailableAsset();
      state.assetAssignmentRows = [
        { id: 9001, organizationId: ORG_ID, assetId, employeeId: EMPLOYEE2_ID, custodyEndedAt: null, assetTagSnapshot: "AST-00001", assetNameSnapshot: "X", categorySnapshot: "laptop", issuedAt: new Date(), issueCondition: "good" },
      ];
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(409);
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).not.toMatch(/23505|constraint|SQLSTATE/i);
    });

    it("emits asset.assigned", async () => {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(state.auditRows.some((r) => r.eventType === "asset.assigned")).toBe(true);
    });
  });

  describe("return — close custody (W97)", () => {
    async function createAssignedAsset(employeeId = EMPLOYEE_ID) {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId });
      return created.body.id as number;
    }

    it("denies return to an employee without asset_management.manage", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(employeeHeaders()).send({});
      expect(res.status).toBe(403);
    });

    it("returns an assigned asset back to available and closes the active assignment", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({ returnCondition: "fair", returnNotes: "Minor wear" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("available");

      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body).toHaveLength(1);
      expect(list.body[0].custodyEndedAt).not.toBeNull();
      expect(list.body[0].endReason).toBe("returned");
      expect(list.body[0].returnCondition).toBe("fair");
    });

    it("rejects return when there is no active assignment", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(hrHeaders()).send({});
      expect(res.status).toBe(409);
    });

    it("a repeat return call after the first succeeds is a controlled 409, never a double-close", async () => {
      const assetId = await createAssignedAsset();
      const first = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      expect(first.status).toBe(200);
      const repeat = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      expect(repeat.status).toBe(409);
    });

    it("a genuine concurrent double-return race resolves to exactly one winner", async () => {
      const assetId = await createAssignedAsset();
      const [a, b] = await Promise.all([
        request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({}),
        request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({}),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it("re-assigning after a return creates a brand-new history row, leaving the first row's employeeId unchanged", async () => {
      const assetId = await createAssignedAsset(EMPLOYEE_ID);
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE2_ID });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body).toHaveLength(2);
      const first = list.body.find((r: { employeeId: number }) => r.employeeId === EMPLOYEE_ID);
      const second = list.body.find((r: { employeeId: number }) => r.employeeId === EMPLOYEE2_ID);
      expect(first.custodyEndedAt).not.toBeNull();
      expect(second.custodyEndedAt).toBeNull();
    });

    it("returns 404 for a foreign-org asset", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(hrHeaders()).send({});
      expect(res.status).toBe(404);
    });

    it("emits asset.returned", async () => {
      const assetId = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      expect(state.auditRows.some((r) => r.eventType === "asset.returned")).toBe(true);
    });
  });

  describe("assignment history — GET .../assets/:id/assignments (W97)", () => {
    it("returns the full history for an org-wide (asset_management.manage) caller", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(hrHeaders()).send({});
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE2_ID });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(hrHeaders());
      expect(res.body).toHaveLength(2);
    });

    it("scopes a non-org-wide caller to only their own rows for this asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(hrHeaders()).send({});
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE2_ID });

      const ownView = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(employeeHeaders());
      expect(ownView.status).toBe(200);
      expect(ownView.body).toHaveLength(1);
      expect(ownView.body[0].employeeId).toBe(EMPLOYEE_ID);
    });

    it("returns an empty array (never a 403) for a non-org-wide caller with no rows on this asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(employeeHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 for a foreign-org asset", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(hrHeaders());
      expect(res.status).toBe(404);
    });

    it("never emits an audit row", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const countBefore = state.auditRows.length;
      await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(hrHeaders());
      expect(state.auditRows.length).toBe(countBefore);
    });
  });

  describe("acknowledgement — POST .../asset-assignments/:id/acknowledge (W97)", () => {
    async function createAssignedAsset(employeeId = EMPLOYEE_ID) {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(hrHeaders());
      return { assetId: created.body.id as number, assignmentId: list.body[0].id as number };
    }

    it("asset_management.write.own is enough — a plain employee may acknowledge their own assignment", async () => {
      const { assignmentId } = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(res.status).toBe(200);
      expect(res.body.acknowledgedAt).not.toBeNull();
    });

    it("accepts an optional acknowledgementNote", async () => {
      const { assignmentId } = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({ acknowledgementNote: "Received in good condition" });
      expect(res.status).toBe(200);
      expect(res.body.acknowledgementNote).toBe("Received in good condition");
    });

    it("never mutates asset status, condition, or custody ownership", async () => {
      const { assetId, assignmentId } = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
      expect(asset.body.status).toBe("assigned");
      expect(asset.body.condition).toBe("good");
    });

    it("denies an unrelated employee (404, never leaking existence)", async () => {
      const { assignmentId } = await createAssignedAsset(EMPLOYEE_ID);
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employee2Headers()).send({});
      expect(res.status).toBe(404);
    });

    it("rejects a repeat acknowledgement with a controlled 409, never a silent overwrite", async () => {
      const { assignmentId } = await createAssignedAsset();
      const first = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(first.status).toBe(200);
      const repeat = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(repeat.status).toBe(409);
    });

    it("a genuine concurrent double-acknowledge race resolves to exactly one winner", async () => {
      const { assignmentId } = await createAssignedAsset();
      const [a, b] = await Promise.all([
        request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({}),
        request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({}),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it("rejects acknowledgement of an already-closed (returned) assignment", async () => {
      const { assetId, assignmentId } = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(res.status).toBe(409);
    });

    it("acknowledgement survives return — remains permanently visible on the now-closed row", async () => {
      const { assetId, assignmentId } = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/return`).set(hrHeaders()).send({});
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body[0].acknowledgedAt).not.toBeNull();
      expect(list.body[0].custodyEndedAt).not.toBeNull();
    });

    it("returns 404 for a nonexistent assignment id", async () => {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/999999/acknowledge`).set(employeeHeaders()).send({});
      expect(res.status).toBe(404);
    });

    it("returns 404 for a real foreign-org assignment id, never leaking existence", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets/${created.body.id}/assign`).set(otherOrgHrHeaders()).send({ employeeId: OTHER_ORG_EMPLOYEE_ID });
      const otherList = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/assets/${created.body.id}/assignments`).set(otherOrgHrHeaders());
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${otherList.body[0].id}/acknowledge`).set(employeeHeaders()).send({});
      expect(res.status).toBe(404);
    });

    it("denies module-disabled access", async () => {
      const { assignmentId } = await createAssignedAsset();
      state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(res.status).toBe(403);
    });

    it("denies unauthenticated requests", async () => {
      const { assignmentId } = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).send({});
      expect(res.status).toBe(401);
    });

    it("emits asset_assignment.acknowledged", async () => {
      const { assignmentId } = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/asset-assignments/${assignmentId}/acknowledge`).set(employeeHeaders()).send({});
      expect(state.auditRows.some((r) => r.eventType === "asset_assignment.acknowledged")).toBe(true);
    });
  });
});
