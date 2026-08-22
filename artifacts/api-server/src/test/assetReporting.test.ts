/**
 * Integration tests for Asset Dashboard & Reporting (Phase 3E, W102 per the
 * frozen plan's own §24 numbering), exercising the real requireAuth/
 * requireMembership/requireModuleEnabled/requirePermission chain plus
 * scope resolution and aggregation through supertest. Mock harness mirrors
 * performanceReporting.test.ts's own field-based-filtering pattern, with a
 * live-resolved (never cached) direct-report query for Assets' own Owner-
 * Decision-3 manager tier — a genuine structural difference from
 * Performance's/Learning's own snapshot-based reviewer/manager-of-record
 * model. No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const COUNT_SENTINEL = "__COUNT__";

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
  employeeUserLinksTable,
  assetsTable,
  assetAssignmentsTable,
  assetMaintenanceTable,
  assetIncidentsTable,
  reportsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      assetRows: [] as Record<string, unknown>[],
      assetAssignmentRows: [] as Record<string, unknown>[],
      assetMaintenanceRows: [] as Record<string, unknown>[],
      assetIncidentRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status", "expiresAt"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "reportingManagerId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    assetsTable: mockTable("assets", ["id", "organizationId", "assetTag", "name", "categoryCode", "status", "condition", "branchId", "serialNumber", "purchaseCost", "purchaseCurrency"]),
    assetAssignmentsTable: mockTable("asset_assignments", [
      "id", "organizationId", "assetId", "employeeId", "assetTagSnapshot", "assetNameSnapshot", "categorySnapshot",
      "departmentIdSnapshot", "issuedAt", "expectedReturnDate", "issueCondition", "custodyEndedAt",
    ]),
    assetMaintenanceTable: mockTable("asset_maintenance", ["id", "organizationId", "assetId", "maintenanceType", "description", "providerText", "status", "startedAt", "completedAt", "cost", "notes", "createdAt"]),
    assetIncidentsTable: mockTable("asset_incidents", ["id", "organizationId", "assetId", "status"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "gte"; field: string; val: unknown }
  | { __op: "lte"; field: string; val: unknown }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "gte") return new Date(row[cond.field] as string | number | Date).getTime() >= new Date(cond.val as string | number | Date).getTime();
  if (cond.__op === "lte") return new Date(row[cond.field] as string | number | Date).getTime() <= new Date(cond.val as string | number | Date).getTime();
  return true;
}

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
  assetsTable,
  assetAssignmentsTable,
  assetMaintenanceTable,
  assetIncidentsTable,
  reportsTable,
  db: {
    select: (selection?: { value: string }) => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const sessionBuilder = {
            innerJoin: () => sessionBuilder,
            where: () => sessionBuilder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return sessionBuilder;
        }

        const unfiltered =
          table === membershipRolesTable
            ? fixtures.membershipRoleRows
            : table === rolePermissionsTable
              ? fixtures.permissionRows
              : table === modulesTable
                ? fixtures.moduleRows
                : undefined;
        if (unfiltered !== undefined) {
          const rows = unfiltered as unknown[];
          const passthroughBuilder = {
            innerJoin: () => passthroughBuilder,
            where: () => passthroughBuilder,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return passthroughBuilder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows as Record<string, unknown>[];
        else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === assetsTable) rows = fixtures.assetRows;
        else if (table === assetAssignmentsTable) rows = fixtures.assetAssignmentRows;
        else if (table === assetMaintenanceTable) rows = fixtures.assetMaintenanceRows;
        else if (table === assetIncidentsTable) rows = fixtures.assetIncidentRows;
        else if (table === reportsTable) rows = fixtures.reportRows;

        let filtered = rows;
        const isCount = selection?.value === COUNT_SENTINEL;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            if (isCount) return Promise.resolve([{ value: filtered.length }]);
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => {
    const filtered = conds.filter(Boolean);
    return filtered.length > 0 ? { __op: "or", conds: filtered } : undefined;
  },
  isNull: (col: string) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val: null }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  gte: (col: string, val: unknown) => ({ __op: "gte", field: typeof col === "string" ? col.split(".").pop() : col, val: val instanceof Date ? val.toISOString() : val }),
  lte: (col: string, val: unknown) => ({ __op: "lte", field: typeof col === "string" ? col.split(".").pop() : col, val: val instanceof Date ? val.toISOString() : val }),
  gt: () => undefined,
  desc: () => undefined,
  count: () => COUNT_SENTINEL,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_ID = 1;
const MANAGER_ID = 2;
const DIRECT_REPORT_ID = 3;
const UNRELATED_ID = 4;

function mockSession(userId = HR_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID, applicationUserId = HR_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockModuleEnabled(organizationId = ORG_ID) {
  fixtures.moduleRows = [{ id: 1, key: "asset_management", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId, moduleId: 1, enabled: true }];
}

function mockOwnEmployeeLinked(employeeId: number, applicationUserId: number) {
  fixtures.employeeUserLinkRows = [...fixtures.employeeUserLinkRows.filter((r) => r.applicationUserId !== applicationUserId), { employeeId, applicationUserId }];
}

function mockReportDefinitions() {
  fixtures.reportRows = [
    { key: "headcount", label: "Headcount", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
    { key: "asset_register", label: "Asset Register", description: "d", category: "asset_management", requiredPermissionKey: "asset_management.reports.read" },
    { key: "asset_unreturned_by_employee", label: "Unreturned Assets by Employee", description: "d", category: "asset_management", requiredPermissionKey: "asset_management.reports.read" },
    { key: "asset_maintenance_history", label: "Maintenance History", description: "d", category: "asset_management", requiredPermissionKey: "asset_management.reports.read" },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [
    { id: HR_ID, organizationId: ORG_ID, firstName: "Hana", lastName: "Hr", reportingManagerId: null },
    { id: MANAGER_ID, organizationId: ORG_ID, firstName: "Mona", lastName: "Manager", reportingManagerId: null },
    { id: DIRECT_REPORT_ID, organizationId: ORG_ID, firstName: "Dara", lastName: "Report", reportingManagerId: MANAGER_ID },
    { id: UNRELATED_ID, organizationId: ORG_ID, firstName: "Uma", lastName: "Unrelated", reportingManagerId: null },
  ];
  fixtures.employeeUserLinkRows = [];
  fixtures.assetRows = [];
  fixtures.assetAssignmentRows = [];
  fixtures.assetMaintenanceRows = [];
  fixtures.assetIncidentRows = [];
  fixtures.reportRows = [];

  mockSession();
  mockActiveMembership();
  mockModuleEnabled();
  mockReportDefinitions();
});

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, organizationId: ORG_ID, assetTag: "AST-00001", name: "Laptop", categoryCode: "laptop",
    status: "available", condition: "good", branchId: null, serialNumber: null, purchaseCost: null, purchaseCurrency: null,
    ...overrides,
  };
}
function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, organizationId: ORG_ID, assetId: 1, employeeId: DIRECT_REPORT_ID,
    assetTagSnapshot: "AST-00001", assetNameSnapshot: "Laptop", categorySnapshot: "laptop", departmentIdSnapshot: 100,
    issuedAt: new Date("2026-01-01"), expectedReturnDate: null, issueCondition: "good", custodyEndedAt: null,
    ...overrides,
  };
}
function maintenance(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, organizationId: ORG_ID, assetId: 1, maintenanceType: "Repair", description: null, providerText: null,
    status: "completed", startedAt: new Date("2026-01-05"), completedAt: new Date("2026-01-06"), cost: "50.00", notes: null,
    createdAt: new Date("2026-01-04"),
    ...overrides,
  };
}
function incident(overrides: Record<string, unknown> = {}) {
  return { id: 1, organizationId: ORG_ID, assetId: 1, status: "open", ...overrides };
}

function dashboard(userToken = "valid-token") {
  return request(app).get(`/api/organizations/${ORG_ID}/assets/dashboard`).set("Authorization", `Bearer ${userToken}`);
}
function report(key: string, query = "", userToken = "valid-token") {
  return request(app)
    .get(`/api/organizations/${ORG_ID}/assets/reports/${key}${query ? `?${query}` : ""}`)
    .set("Authorization", `Bearer ${userToken}`);
}

describe("GET /api/organizations/:organizationId/assets/dashboard", () => {
  it("returns 403 when asset_management is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("returns 403 without asset_management.reports.read", async () => {
    mockPermissions(["asset_management.manage"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/dashboard`);
    expect(res.status).toBe(401);
  });

  it("org-wide (asset_management.manage) sees every asset with a zero-filled status breakdown", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1, status: "available" }), asset({ id: 2, status: "assigned" }), asset({ id: 3, status: "assigned" })];
    fixtures.assetAssignmentRows = [assignment({ id: 1, assetId: 2, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null }), assignment({ id: 2, assetId: 3, employeeId: UNRELATED_ID, custodyEndedAt: null })];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.totalAssetCount).toBe(3);
    const buckets: Record<string, number> = Object.fromEntries(res.body.statusBreakdown.map((b: { status: string; count: number }) => [b.status, b.count]));
    expect(buckets).toEqual({ available: 1, assigned: 2, maintenance: 0, lost: 0, retired: 0 });
    expect(res.body.employeesWithAssignedAssetsCount).toBe(2);
  });

  it("openIncidentCount reflects only status=open, org-wide", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1 })];
    fixtures.assetIncidentRows = [incident({ id: 1, status: "open" }), incident({ id: 2, status: "reviewed" }), incident({ id: 3, status: "dismissed" })];
    const res = await dashboard();
    expect(res.body.openIncidentCount).toBe(1);
  });

  it("overdueReturnCount counts only active assignments past expectedReturnDate, never one with no expectedReturnDate set", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1, status: "assigned" }), asset({ id: 2, status: "assigned" }), asset({ id: 3, status: "assigned" })];
    fixtures.assetAssignmentRows = [
      assignment({ id: 1, assetId: 1, expectedReturnDate: "2020-01-01", custodyEndedAt: null }),
      assignment({ id: 2, assetId: 2, expectedReturnDate: "2999-01-01", custodyEndedAt: null }),
      assignment({ id: 3, assetId: 3, expectedReturnDate: null, custodyEndedAt: null }),
    ];
    const res = await dashboard();
    expect(res.body.overdueReturnCount).toBe(1);
  });

  it("own scope: an employee sees only assets currently under their own active custody", async () => {
    mockSession(DIRECT_REPORT_ID);
    mockActiveMembership(6, ORG_ID, DIRECT_REPORT_ID);
    mockOwnEmployeeLinked(DIRECT_REPORT_ID, DIRECT_REPORT_ID);
    mockPermissions(["asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1, status: "assigned" }), asset({ id: 2, status: "assigned" })];
    fixtures.assetAssignmentRows = [assignment({ id: 1, assetId: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null }), assignment({ id: 2, assetId: 2, employeeId: UNRELATED_ID, custodyEndedAt: null })];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.totalAssetCount).toBe(1);
    expect(res.body.employeesWithAssignedAssetsCount).toBe(1);
  });

  it("manager scope: sees only current direct reports' active custody, never an unrelated employee's", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(7, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1, status: "assigned" }), asset({ id: 2, status: "assigned" })];
    fixtures.assetAssignmentRows = [assignment({ id: 1, assetId: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null }), assignment({ id: 2, assetId: 2, employeeId: UNRELATED_ID, custodyEndedAt: null })];
    const res = await dashboard();
    expect(res.body.totalAssetCount).toBe(1);
  });

  it("manager scope never widens to org-wide merely by holding reports.read", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(7, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1 }), asset({ id: 2 }), asset({ id: 3 })];
    const res = await dashboard();
    expect(res.body.totalAssetCount).toBe(0);
  });

  it("a caller with no linked employee and no asset_management.manage gets a valid, empty scope (never an error)", async () => {
    mockPermissions(["asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1 })];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.totalAssetCount).toBe(0);
    expect(res.body.statusBreakdown.every((b: { count: number }) => b.count === 0)).toBe(true);
  });

  it("live relationship: manager visibility disappears immediately when the direct report is reassigned, no caching", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(7, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1, status: "assigned" })];
    fixtures.assetAssignmentRows = [assignment({ id: 1, assetId: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null })];
    const before = await dashboard();
    expect(before.body.totalAssetCount).toBe(1);

    fixtures.employeeRows = fixtures.employeeRows.map((e) => (e.id === DIRECT_REPORT_ID ? { ...e, reportingManagerId: null } : e));
    const after = await dashboard();
    expect(after.body.totalAssetCount).toBe(0);
  });

  it("denies cross-organization membership entirely", async () => {
    mockActiveMembership(5, OTHER_ORG_ID, HR_ID);
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/assets/reports/:reportKey", () => {
  it("returns 404 for an unknown report key", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    expect((await report("bogus_key")).status).toBe(404);
  });

  it("returns 404 for a real report key from a different category", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    expect((await report("headcount")).status).toBe(404);
  });

  it("returns 403 when asset_management is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    expect((await report("asset_register")).status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/reports/asset_register`);
    expect(res.status).toBe(401);
  });

  describe("asset_register — organization-wide only", () => {
    it("returns one row per in-scope asset with current live fields and current holder", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, assetTag: "AST-00001", name: "Laptop", status: "assigned" })];
      fixtures.assetAssignmentRows = [assignment({ id: 1, assetId: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null })];
      const res = await report("asset_register");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].assetTag).toBe("AST-00001");
      expect(res.body.rows[0].currentHolder).toBe("Dara Report");
    });

    it("shows '—' for current holder when unassigned", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, status: "available" })];
      const res = await report("asset_register");
      expect(res.body.rows[0].currentHolder).toBe("—");
    });

    it("purchaseCost is passed through as a plain reference field, never a computed book value", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, purchaseCost: "1200.00", purchaseCurrency: "GHS" })];
      const res = await report("asset_register");
      expect(res.body.rows[0].purchaseCost).toBe("1200.00");
      expect(res.body.rows[0]).not.toHaveProperty("bookValue");
      expect(res.body.rows[0]).not.toHaveProperty("depreciatedValue");
    });

    it("categoryCode filter narrows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, categoryCode: "laptop" }), asset({ id: 2, categoryCode: "phone" })];
      const res = await report("asset_register", "categoryCode=phone");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].categoryCode).toBe("phone");
    });

    it("status filter narrows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, status: "available" }), asset({ id: 2, status: "retired" })];
      const res = await report("asset_register", "status=retired");
      expect(res.body.rows).toHaveLength(1);
    });

    it("branchId filter narrows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, branchId: 500 }), asset({ id: 2, branchId: 600 })];
      const res = await report("asset_register", "branchId=500");
      expect(res.body.rows).toHaveLength(1);
    });

    it("denies a non-org-wide caller with a controlled 403, never a silently-empty or silently-full result", async () => {
      mockSession(DIRECT_REPORT_ID);
      mockActiveMembership(6, ORG_ID, DIRECT_REPORT_ID);
      mockOwnEmployeeLinked(DIRECT_REPORT_ID, DIRECT_REPORT_ID);
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1 })];
      const res = await report("asset_register");
      expect(res.status).toBe(403);
    });

    it("cross-org isolation: never returns another organization's assets", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, organizationId: OTHER_ORG_ID })];
      const res = await report("asset_register");
      expect(res.body.rows).toHaveLength(0);
    });

    it("supports ?format=csv with a text/csv content type", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, name: "Laptop" })];
      const res = await report("asset_register", "format=csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toContain("Laptop");
    });

    it("JSON and CSV expose the same underlying rows for the same filters", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1 }), asset({ id: 2 })];
      const json = await report("asset_register");
      const csv = await report("asset_register", "format=csv");
      expect(json.body.rows).toHaveLength(2);
      expect(csv.text.split("\n")).toHaveLength(3);
    });
  });

  describe("asset_unreturned_by_employee — own/manager-current/org-wide", () => {
    it("only active custody rows are included; returned/closed custody is excluded", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, custodyEndedAt: null }), assignment({ id: 2, custodyEndedAt: new Date("2026-01-10") })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows).toHaveLength(1);
    });

    it("uses snapshot fields for display, not a live join to the asset's own current name/category", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, assetNameSnapshot: "Old Name At Issue", categorySnapshot: "old_category", custodyEndedAt: null })];
      fixtures.assetRows = [asset({ id: 1, name: "Renamed Since", categoryCode: "new_category" })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows[0].assetName).toBe("Old Name At Issue");
      expect(res.body.rows[0].category).toBe("old_category");
    });

    it("marks overdue rows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, expectedReturnDate: "2020-01-01", custodyEndedAt: null }), assignment({ id: 2, expectedReturnDate: "2999-01-01", custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows.map((r: { overdue: string }) => r.overdue).sort()).toEqual(["No", "Yes"]);
    });

    it("own scope: an employee sees only their own outstanding custody", async () => {
      mockSession(DIRECT_REPORT_ID);
      mockActiveMembership(6, ORG_ID, DIRECT_REPORT_ID);
      mockOwnEmployeeLinked(DIRECT_REPORT_ID, DIRECT_REPORT_ID);
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null }), assignment({ id: 2, employeeId: UNRELATED_ID, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(DIRECT_REPORT_ID);
    });

    it("manager scope: sees only current direct reports' outstanding custody", async () => {
      mockSession(MANAGER_ID);
      mockActiveMembership(7, ORG_ID, MANAGER_ID);
      mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, employeeId: DIRECT_REPORT_ID, custodyEndedAt: null }), assignment({ id: 2, employeeId: UNRELATED_ID, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].employeeId).toBe(DIRECT_REPORT_ID);
    });

    it("employeeId filter for an unrelated (out of scope) employee returns empty, never broadens a manager's own scope", async () => {
      mockSession(MANAGER_ID);
      mockActiveMembership(7, ORG_ID, MANAGER_ID);
      mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, employeeId: UNRELATED_ID, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee", `employeeId=${UNRELATED_ID}`);
      expect(res.body.rows).toHaveLength(0);
    });

    it("departmentId filter narrows by departmentIdSnapshot, not the employee's current department", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, departmentIdSnapshot: 100, custodyEndedAt: null }), assignment({ id: 2, departmentIdSnapshot: 999, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee", "departmentId=100");
      expect(res.body.rows).toHaveLength(1);
    });

    it("a caller with no linked employee and no asset_management.manage gets a valid, empty scope", async () => {
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(0);
    });

    it("historical rows are never treated as outstanding — no residual reach after return", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, custodyEndedAt: new Date("2026-01-15") })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows).toHaveLength(0);
    });

    it("cross-org isolation: never returns another organization's assignments", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, organizationId: OTHER_ORG_ID, custodyEndedAt: null })];
      const res = await report("asset_unreturned_by_employee");
      expect(res.body.rows).toHaveLength(0);
    });

    it("supports ?format=csv, identical row count to JSON", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetAssignmentRows = [assignment({ id: 1, custodyEndedAt: null })];
      const json = await report("asset_unreturned_by_employee");
      const csv = await report("asset_unreturned_by_employee", "format=csv");
      expect(json.body.rows).toHaveLength(1);
      expect(csv.text.split("\n")).toHaveLength(2);
    });
  });

  describe("asset_maintenance_history — organization-wide only", () => {
    it("completed historical maintenance remains visible regardless of the asset's current status", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, status: "available" })];
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, assetId: 1, status: "completed" })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].status).toBe("completed");
    });

    it("a currently assigned asset still shows its own completed maintenance history", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, status: "assigned" })];
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, assetId: 1, status: "completed" })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows).toHaveLength(1);
    });

    it("cancelled maintenance records remain visible too — history is preserved, not filtered by outcome", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, status: "cancelled" })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].status).toBe("cancelled");
    });

    it("resolves the asset name/tag via a live join, since asset_maintenance has no snapshot fields", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetRows = [asset({ id: 1, assetTag: "AST-00042", name: "Renamed Printer" })];
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, assetId: 1 })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows[0].assetTag).toBe("AST-00042");
      expect(res.body.rows[0].assetName).toBe("Renamed Printer");
    });

    it("assetId filter narrows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, assetId: 1 }), maintenance({ id: 2, assetId: 2 })];
      const res = await report("asset_maintenance_history", "assetId=1");
      expect(res.body.rows).toHaveLength(1);
    });

    it("status filter narrows correctly", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, status: "completed" }), maintenance({ id: 2, status: "scheduled" })];
      const res = await report("asset_maintenance_history", "status=scheduled");
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].status).toBe("scheduled");
    });

    it("date range filters (dateFrom/dateTo) narrow by createdAt", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, createdAt: new Date("2026-01-04") }), maintenance({ id: 2, createdAt: new Date("2026-06-01") })];
      const res = await report("asset_maintenance_history", "dateFrom=2026-01-01&dateTo=2026-02-01");
      expect(res.body.rows).toHaveLength(1);
    });

    it("no vendor/SLA/downtime analytics field appears anywhere in the response", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1 })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows[0]).not.toHaveProperty("slaBreached");
      expect(res.body.rows[0]).not.toHaveProperty("downtimeHours");
      expect(res.body.rows[0]).not.toHaveProperty("vendorRating");
    });

    it("denies a non-org-wide caller with a controlled 403", async () => {
      mockSession(DIRECT_REPORT_ID);
      mockActiveMembership(6, ORG_ID, DIRECT_REPORT_ID);
      mockOwnEmployeeLinked(DIRECT_REPORT_ID, DIRECT_REPORT_ID);
      mockPermissions(["asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1 })];
      const res = await report("asset_maintenance_history");
      expect(res.status).toBe(403);
    });

    it("cross-org isolation: never returns another organization's maintenance records", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1, organizationId: OTHER_ORG_ID })];
      const res = await report("asset_maintenance_history");
      expect(res.body.rows).toHaveLength(0);
    });

    it("supports ?format=csv, identical row count to JSON", async () => {
      mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
      fixtures.assetMaintenanceRows = [maintenance({ id: 1 })];
      const json = await report("asset_maintenance_history");
      const csv = await report("asset_maintenance_history", "format=csv");
      expect(json.body.rows).toHaveLength(1);
      expect(csv.text.split("\n")).toHaveLength(2);
    });
  });

  it("GET report/dashboard routes never emit an audit row", async () => {
    mockPermissions(["asset_management.manage", "asset_management.reports.read"]);
    fixtures.assetRows = [asset({ id: 1 })];
    const resDashboard = await dashboard();
    const resReport = await report("asset_register");
    expect(resDashboard.status).toBe(200);
    expect(resReport.status).toBe(200);
    // No audit_events table is even mocked in this harness — a call that
    // tried to write one would throw (undefined table), not silently pass.
  });
});
