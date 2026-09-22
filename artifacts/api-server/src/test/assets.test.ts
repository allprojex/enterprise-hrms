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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  branchesTable,
  assetsTable,
  assetAssignmentsTable,
  assetIncidentsTable,
  assetMaintenanceTable,
  assetEvidenceTable,
  employeeDocumentsTable,
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
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "positionId", "reportingManagerId"]),
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
    assetIncidentsTable: mockTable("asset_incidents", [
      "id", "organizationId", "assetId", "assignmentId", "reportedByEmployeeId", "incidentType", "description",
      "reportedAt", "status", "reviewedByMembershipId", "reviewedAt", "resolutionNotes",
    ]),
    assetMaintenanceTable: mockTable("asset_maintenance", [
      "id", "organizationId", "assetId", "maintenanceType", "description", "providerText", "status",
      "startedAt", "completedAt", "cost", "notes", "createdByMembershipId",
    ]),
    assetEvidenceTable: mockTable("asset_evidence", ["id", "organizationId", "assetId", "employeeDocumentId", "addedByMembershipId", "addedAt"]),
    employeeDocumentsTable: mockTable("employee_documents", ["id", "organizationId", "employeeId", "categoryCode", "fileName", "storageKey", "mimeType", "fileSize", "uploadedBy"]),
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
      assetIncidentRows: [] as Record<string, unknown>[],
      assetMaintenanceRows: [] as Record<string, unknown>[],
      assetEvidenceRows: [] as Record<string, unknown>[],
      documentRows: [] as Record<string, unknown>[],
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
  asset_incidents: "assetIncidentRows",
  asset_maintenance: "assetMaintenanceRows",
  asset_evidence: "assetEvidenceRows",
  employee_documents: "documentRows",
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

        if (table === assetEvidenceTable) {
          // The only join shape asset_evidence's own queries ever use:
          // asset_evidence -> employee_documents, matched by
          // employeeDocumentId = id, mirroring
          // performanceReviewEvidence.test.ts's own identical hand-rolled
          // join (the mock's eq() Cond can't express a column-to-column
          // join condition, so it's hand-matched here instead).
          const rows = rowsFor(table);
          return {
            innerJoin(joinTable: { __name: string }) {
              const joinRows = rowsFor(joinTable);
              const joined = rows.map((r) => {
                const match = joinRows.find((j) => j.id === r.employeeDocumentId);
                return { ...match, ...r };
              });
              return {
                where(cond: Cond) {
                  const filtered = joined.filter((r) => matches(r, cond));
                  return {
                    limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
                    orderBy: () => Promise.resolve(filtered),
                    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
                  };
                },
                orderBy: () => Promise.resolve(joined),
                then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(joined).then(resolve, reject),
              };
            },
          };
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
        const inserted = items.map((item) => ({ id: nextId(table.__name), createdAt: new Date(), updatedAt: new Date(), addedAt: new Date(), ...item }));
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
    // A faithful-enough rollback simulation: snapshot the array REFERENCES
    // for every mutable table before running the callback (every
    // update()/insert() in this mock replaces the array with a new one
    // rather than mutating in place, so restoring the pre-transaction
    // reference genuinely undoes any writes made inside the callback) and
    // restore them if the callback throws — needed for W100's maintenance
    // transitions, which throw mid-transaction on a real asset-status race
    // (see lib/assets.ts's own file header) and must prove the maintenance
    // row's own write was actually rolled back, not just that a 409 came
    // back.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        assetRows: state.assetRows,
        assetAssignmentRows: state.assetAssignmentRows,
        assetIncidentRows: state.assetIncidentRows,
        assetMaintenanceRows: state.assetMaintenanceRows,
        assetEvidenceRows: state.assetEvidenceRows,
        documentRows: state.documentRows,
      };
      try {
        return await cb(client);
      } catch (err) {
        Object.assign(state, snapshot);
        throw err;
      }
    },
  };
  return client;
}

const db = makeQueryClient();

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
  employeeUserLinksTable,
  branchesTable,
  assetsTable,
  assetAssignmentsTable,
  assetIncidentsTable,
  assetMaintenanceTable,
  assetEvidenceTable,
  employeeDocumentsTable,
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

// W100: no real disk I/O for evidence uploads/downloads — mirrors
// performanceReviewEvidence.test.ts's/employeeDocuments.test.ts's own
// established `vi.mock("../lib/fileStorage", ...)` precedent exactly.
// documentValidation is deliberately NOT mocked — the real file-signature
// validation runs against real PDF-signature test buffers below.
vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "documents/mock-evidence-key.pdf"),
  readOrgFile: vi.fn(async () => Buffer.from("asset evidence file contents")),
  deleteOrgFile: vi.fn(async () => undefined),
}));

const { default: app } = await import("../app");
const fileStorage = await import("../lib/fileStorage");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const OTHER_ORG_HR_USER_ID = 3;
const EMPLOYEE2_USER_ID = 4;
const MANAGER_USER_ID = 5;
const EMPLOYEE_ID = 900;
const EMPLOYEE2_ID = 901;
const OTHER_ORG_EMPLOYEE_ID = 902;
const MANAGER_EMPLOYEE_ID = 903;

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

// W100: a real PDF-signature buffer — validateDocumentUpload runs for real
// in these tests (not mocked), matching performanceReviewEvidence.test.ts's
// own precedent.
const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0)]);

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
function managerHeaders() {
  // Deliberately plain EMPLOYEE_PERMISSIONS (no separate "manager" role or
  // permission exists) — manager authority in this module is purely
  // relationship-based (employees.reportingManagerId), matching Decision 3's
  // own "no asset_management.read.team" rule.
  mockSession(MANAGER_USER_ID);
  mockPermissions(EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${MANAGER_USER_ID}` };
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
  state.assetIncidentRows = [];
  state.assetMaintenanceRows = [];
  state.assetEvidenceRows = [];
  state.documentRows = [];
  state.auditRows = [];
  state.nextIds = new Map();
  vi.mocked(fileStorage.writeOrgFile).mockClear();
  vi.mocked(fileStorage.readOrgFile).mockClear();
  vi.mocked(fileStorage.deleteOrgFile).mockClear();

  mockMembership(HR_USER_ID, ORG_ID, 100);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 101);
  mockMembership(OTHER_ORG_HR_USER_ID, OTHER_ORG_ID, 102);
  mockMembership(EMPLOYEE2_USER_ID, ORG_ID, 103);
  mockMembership(MANAGER_USER_ID, ORG_ID, 104);
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
  // MANAGER_EMPLOYEE_ID (W98) has no direct reports by default — individual
  // tests set an employee's own reportingManagerId to establish the LIVE
  // relationship they need, never a fixture-wide default.
  state.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 55, positionId: 66, reportingManagerId: null },
    { id: EMPLOYEE2_ID, organizationId: ORG_ID, departmentId: 77, positionId: 88, reportingManagerId: null },
    { id: OTHER_ORG_EMPLOYEE_ID, organizationId: OTHER_ORG_ID, departmentId: null, positionId: null, reportingManagerId: null },
    { id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, positionId: null, reportingManagerId: null },
  ];
  state.employeeUserLinkRows = [
    { employeeId: EMPLOYEE_ID, applicationUserId: EMPLOYEE_USER_ID },
    { employeeId: EMPLOYEE2_ID, applicationUserId: EMPLOYEE2_USER_ID },
    { employeeId: MANAGER_EMPLOYEE_ID, applicationUserId: MANAGER_USER_ID },
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
    it("has no GET .../asset-incidents/:id detail route — the frozen §20 contract names none; the list route's own rows already carry full detail", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents/1`).set(hrHeaders());
      expect(res.status).toBe(404);
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

  describe("my-assets — GET .../assets/my-assets (W98)", () => {
    it("returns the caller's own current + historical assignments across every asset", async () => {
      const a = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "A" });
      const b = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "B" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${a.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${a.body.id}/return`).set(hrHeaders()).send({});
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${b.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });

      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(employeeHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((r: { employeeId: number }) => r.employeeId === EMPLOYEE_ID)).toBe(true);
    });

    it("never exposes an unrelated employee's own assignments", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(employee2Headers());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns an empty array for a caller with no linked employee record", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(hrHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("denies module-disabled access", async () => {
      state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(employeeHeaders());
      expect(res.status).toBe(403);
    });

    it("denies unauthenticated requests", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`);
      expect(res.status).toBe(401);
    });

    it("never emits an audit row", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const countBefore = state.auditRows.length;
      await request(app).get(`/api/organizations/${ORG_ID}/assets/my-assets`).set(employeeHeaders());
      expect(state.auditRows.length).toBe(countBefore);
    });
  });

  describe("team-assets — GET .../assets/team-assets (W98, Decision 3)", () => {
    it("shows current custody for a current direct report", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });

      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].employeeId).toBe(EMPLOYEE_ID);
    });

    it("never shows an employee who is not a current direct report", async () => {
      // EMPLOYEE_ID has no reportingManagerId set — not a direct report of MANAGER_EMPLOYEE_ID.
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("never shows closed (returned) custody, even for a current direct report", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(hrHeaders()).send({});
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(res.body).toEqual([]);
    });

    it("visibility follows the LIVE reporting relationship — an employee who stops reporting to the manager immediately drops out", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });

      const before = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(before.body).toHaveLength(1);

      // The reporting relationship changes — no assignment row is touched at all.
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: null } : e));
      const after = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(after.body).toEqual([]);
    });

    it("cross-org isolation: a manager never sees an Acme employee's custody even with a coincidentally-matching relationship id", async () => {
      // Acme's own employee happens to share OTHER_ORG_EMPLOYEE_ID's reportingManagerId value with MANAGER_EMPLOYEE_ID's id, but is a different organization entirely.
      state.employeeRows = state.employeeRows.map((e) => (e.id === OTHER_ORG_EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets/${created.body.id}/assign`).set(otherOrgHrHeaders()).send({ employeeId: OTHER_ORG_EMPLOYEE_ID });
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(res.body).toEqual([]);
    });

    it("denies module-disabled access", async () => {
      state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(res.status).toBe(403);
    });

    it("denies unauthenticated requests", async () => {
      const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`);
      expect(res.status).toBe(401);
    });

    it("never emits an audit row", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const countBefore = state.auditRows.length;
      await request(app).get(`/api/organizations/${ORG_ID}/assets/team-assets`).set(managerHeaders());
      expect(state.auditRows.length).toBe(countBefore);
    });
  });

  describe("manager mutation boundary (W98, Decision 4 — no manager mutation authority)", () => {
    it("a manager (relationship only, no asset_management.manage) cannot assign an asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(managerHeaders()).send({ employeeId: EMPLOYEE_ID });
      expect(res.status).toBe(403);
    });

    it("a manager cannot return an asset on behalf of a direct report", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/return`).set(managerHeaders()).send({});
      expect(res.status).toBe(403);
    });

    it("a manager cannot acknowledge on behalf of a direct report", async () => {
      state.employeeRows = state.employeeRows.map((e) => (e.id === EMPLOYEE_ID ? { ...e, reportingManagerId: MANAGER_EMPLOYEE_ID } : e));
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assignments`).set(hrHeaders());
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/asset-assignments/${list.body[0].id}/acknowledge`)
        .set(managerHeaders())
        .send({});
      // The manager's own linked employee (MANAGER_EMPLOYEE_ID) does not own
      // this assignment — the identical 404 an unrelated employee gets,
      // never a distinguishing "you're the manager" signal.
      expect(res.status).toBe(404);
    });

    it("a manager cannot retire an asset", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(managerHeaders()).send({ reason: "r" });
      expect(res.status).toBe(403);
    });
  });

  describe("incident reporting — POST .../assets/:id/report-issue (W98, Decision 2)", () => {
    async function createAssignedAsset(employeeId = EMPLOYEE_ID) {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId });
      return created.body.id as number;
    }

    it("lets the caller report an issue on an asset currently assigned to them", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "damage", description: "Screen cracked when dropped" });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("open");
      expect(res.body.incidentType).toBe("damage");
      expect(res.body.reportedByEmployeeId).toBe(EMPLOYEE_ID);
      expect(res.body.assetId).toBe(assetId);
    });

    it("report-only: never mutates the asset's own status", async () => {
      const assetId = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`).set(employeeHeaders()).send({ incidentType: "loss", description: "Cannot locate it" });
      const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
      expect(asset.body.status).toBe("assigned");
    });

    it("report-only: never mutates the asset's own condition", async () => {
      const assetId = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`).set(employeeHeaders()).send({ incidentType: "damage", description: "Dented" });
      const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
      expect(asset.body.condition).toBe("good");
    });

    it("report-only: never closes the active assignment", async () => {
      const assetId = await createAssignedAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`).set(employeeHeaders()).send({ incidentType: "damage", description: "Dented" });
      const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
      expect(list.body[0].custodyEndedAt).toBeNull();
    });

    it("denies an employee reporting against an asset assigned to someone else", async () => {
      const assetId = await createAssignedAsset(EMPLOYEE_ID);
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`)
        .set(employee2Headers())
        .send({ incidentType: "damage", description: "Not mine" });
      expect(res.status).toBe(403);
    });

    it("denies reporting on an asset with no active assignment at all", async () => {
      const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "loss", description: "N/A" });
      expect(res.status).toBe(403);
    });

    it("returns 404 for a foreign-org asset", async () => {
      const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "damage", description: "X" });
      expect(res.status).toBe(404);
    });

    it("rejects an invalid incidentType", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "stolen", description: "X" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing description", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`).set(employeeHeaders()).send({ incidentType: "damage" });
      expect(res.status).toBe(400);
    });

    it("denies module-disabled access", async () => {
      const assetId = await createAssignedAsset();
      state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
      const res = await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "damage", description: "X" });
      expect(res.status).toBe(403);
    });

    it("denies unauthenticated requests", async () => {
      const assetId = await createAssignedAsset();
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`).send({ incidentType: "damage", description: "X" });
      expect(res.status).toBe(401);
    });

    it("emits asset_incident.reported without placing the free-text description in audit metadata", async () => {
      const assetId = await createAssignedAsset();
      await request(app)
        .post(`/api/organizations/${ORG_ID}/assets/${assetId}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType: "damage", description: "A very specific private description" });
      const event = state.auditRows.find((r) => r.eventType === "asset_incident.reported") as Record<string, unknown> | undefined;
      expect(event).toBeTruthy();
      expect(JSON.stringify(event?.metadata ?? {})).not.toContain("A very specific private description");
    });
  });

  describe("incident handling — HR/Asset-Officer (W99)", () => {
    async function reportIncident(orgId = ORG_ID, headers = hrHeaders(), employeeId = EMPLOYEE_ID, incidentType: "damage" | "loss" = "damage") {
      const created = await request(app).post(`/api/organizations/${orgId}/assets`).set(headers).send({ categoryCode: "laptop", name: "X" });
      await request(app).post(`/api/organizations/${orgId}/assets/${created.body.id}/assign`).set(headers).send({ employeeId });
      const reportRes = await request(app)
        .post(`/api/organizations/${orgId}/assets/${created.body.id}/report-issue`)
        .set(employeeHeaders())
        .send({ incidentType, description: "QA incident" });
      return { assetId: created.body.id as number, incidentId: reportRes.body.id as number };
    }

    /**
     * A real foreign-org incident fixture, staged directly (no properly
     * linked Acme employee session exists in this mock harness — every
     * other cross-org check in this suite already reuses HR/admin actors,
     * which are deliberately never linked to an employee record, so a real
     * end-to-end report-issue call as an Acme employee isn't reachable
     * here). This only fabricates the row; the IDOR behavior under test is
     * exercised entirely through the real review/dismiss routes below.
     */
    function stageForeignOrgIncident(): number {
      const id = nextId("asset_incidents");
      state.assetIncidentRows = [
        ...state.assetIncidentRows,
        { id, organizationId: OTHER_ORG_ID, assetId: 1, assignmentId: 1, reportedByEmployeeId: OTHER_ORG_EMPLOYEE_ID, incidentType: "damage", description: "Acme incident", reportedAt: new Date(), status: "open", reviewedByMembershipId: null, reviewedAt: null, resolutionNotes: null },
      ];
      return id;
    }

    describe("list — GET .../asset-incidents", () => {
      it("returns organization-wide incidents for asset_management.manage", async () => {
        await reportIncident();
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(hrHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
      });

      it("filters by status", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        const openRes = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents?status=open`).set(hrHeaders());
        expect(openRes.body).toHaveLength(0);
        const reviewedRes = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents?status=reviewed`).set(hrHeaders());
        expect(reviewedRes.body).toHaveLength(1);
      });

      it("is organization-scoped — never returns another organization's incidents", async () => {
        stageForeignOrgIncident();
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(hrHeaders());
        expect(res.body).toEqual([]);
      });

      it("denies an employee (no asset_management.manage)", async () => {
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(employeeHeaders());
        expect(res.status).toBe(403);
      });

      it("denies a manager, despite current-team visibility elsewhere, since HR review authority is unrelated to the manager relationship", async () => {
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(managerHeaders());
        expect(res.status).toBe(403);
      });

      it("denies module-disabled access", async () => {
        state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(hrHeaders());
        expect(res.status).toBe(403);
      });

      it("denies unauthenticated requests", async () => {
        const res = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`);
        expect(res.status).toBe(401);
      });

      it("never emits an audit row", async () => {
        await reportIncident();
        const countBefore = state.auditRows.length;
        await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(hrHeaders());
        expect(state.auditRows.length).toBe(countBefore);
      });
    });

    describe("review — POST .../asset-incidents/:id/review", () => {
      it("marks an open incident reviewed, with server-derived actor/timestamp", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("reviewed");
        expect(res.body.reviewedByMembershipId).toBe(100);
        expect(res.body.reviewedAt).not.toBeNull();
      });

      it("accepts an optional resolutionNotes", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({ resolutionNotes: "Confirmed with employee" });
        expect(res.body.resolutionNotes).toBe("Confirmed with employee");
      });

      it("does not require resolutionNotes (optional, not mandatory)", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(200);
      });

      it("never itself mutates the asset's own status, condition, or active custody", async () => {
        const { assetId, incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("assigned");
        expect(asset.body.condition).toBe("good");
        const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
        expect(list.body[0].custodyEndedAt).toBeNull();
      });

      it("rejects a repeat review with a controlled 409", async () => {
        const { incidentId } = await reportIncident();
        const first = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(first.status).toBe(200);
        const repeat = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(repeat.status).toBe(409);
      });

      it("rejects reviewing an already-dismissed incident (no dismissed -> reviewed)", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(409);
      });

      it("returns 404 for a nonexistent incident", async () => {
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/999999/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(404);
      });

      it("returns 404 for a real foreign-org incident id, never leaking existence", async () => {
        const incidentId = stageForeignOrgIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(404);
      });

      it("denies an employee", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(employeeHeaders()).send({});
        expect(res.status).toBe(403);
      });

      it("denies a manager despite current-team visibility", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(managerHeaders()).send({});
        expect(res.status).toBe(403);
      });

      it("denies module-disabled access", async () => {
        const { incidentId } = await reportIncident();
        state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(res.status).toBe(403);
      });

      it("denies unauthenticated requests", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).send({});
        expect(res.status).toBe(401);
      });

      it("a genuine concurrent review-vs-dismiss race on the same open incident resolves to exactly one winner", async () => {
        const { incidentId } = await reportIncident();
        const [a, b] = await Promise.all([
          request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({}),
          request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({}),
        ]);
        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual([200, 409]);
        const list = await request(app).get(`/api/organizations/${ORG_ID}/asset-incidents`).set(hrHeaders());
        expect(["reviewed", "dismissed"]).toContain(list.body[0].status);
      });

      it("emits asset_incident.reviewed", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        expect(state.auditRows.some((r) => r.eventType === "asset_incident.reviewed")).toBe(true);
      });
    });

    describe("dismiss — POST .../asset-incidents/:id/dismiss", () => {
      it("marks an open incident dismissed", async () => {
        const { incidentId } = await reportIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("dismissed");
      });

      it("never itself mutates the asset", async () => {
        const { assetId, incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("assigned");
      });

      it("rejects a repeat dismiss with a controlled 409", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        const repeat = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        expect(repeat.status).toBe(409);
      });

      it("rejects dismissing an already-reviewed incident (no reviewed -> dismissed)", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        expect(res.status).toBe(409);
      });

      it("returns 404 for a foreign-org incident id", async () => {
        const incidentId = stageForeignOrgIncident();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        expect(res.status).toBe(404);
      });

      it("denies an employee and a manager", async () => {
        const { incidentId } = await reportIncident();
        const empRes = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(employeeHeaders()).send({});
        expect(empRes.status).toBe(403);
        const mgrRes = await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(managerHeaders()).send({});
        expect(mgrRes.status).toBe(403);
      });

      it("emits asset_incident.dismissed", async () => {
        const { incidentId } = await reportIncident();
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/dismiss`).set(hrHeaders()).send({});
        expect(state.auditRows.some((r) => r.eventType === "asset_incident.dismissed")).toBe(true);
      });
    });

    describe("incident disposition stays separate from asset lifecycle — reused W96 actions (§ incident/asset boundary)", () => {
      it("HR reviews a damage incident, then separately applies a condition update through W96's own dedicated route — the review itself never touched condition", async () => {
        const { assetId, incidentId } = await reportIncident(ORG_ID, hrHeaders(), EMPLOYEE_ID, "damage");
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({ resolutionNotes: "Confirmed damage, updating condition separately" });
        const midway = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(midway.body.condition).toBe("good");

        const conditionRes = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/condition`).set(hrHeaders()).send({ condition: "damaged", reason: "Confirmed via incident report" });
        expect(conditionRes.status).toBe(200);
        expect(conditionRes.body.condition).toBe("damaged");
      });

      it("HR reviews a loss incident, then separately marks the asset lost through W96's own reused mark-lost route (custody closes as that route already defines)", async () => {
        const { assetId, incidentId } = await reportIncident(ORG_ID, hrHeaders(), EMPLOYEE_ID, "loss");
        await request(app).post(`/api/organizations/${ORG_ID}/asset-incidents/${incidentId}/review`).set(hrHeaders()).send({});

        const lostRes = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/mark-lost`).set(hrHeaders()).send({ reason: "Confirmed via incident report" });
        expect(lostRes.status).toBe(200);
        expect(lostRes.body.status).toBe("lost");
        const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
        expect(list.body[0].custodyEndedAt).not.toBeNull();
        expect(list.body[0].endReason).toBe("lost");
      });

      it("lost -> recover -> retired: recover restores availability, retire is then reused unchanged and remains terminal", async () => {
        const { assetId } = await reportIncident(ORG_ID, hrHeaders(), EMPLOYEE_ID, "loss");
        await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
        const recoverRes = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/recover`).set(hrHeaders()).send({ reason: "Found" });
        expect(recoverRes.status).toBe(200);
        expect(recoverRes.body.status).toBe("available");

        const retireRes = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/retire`).set(hrHeaders()).send({ reason: "End of life" });
        expect(retireRes.status).toBe(200);
        expect(retireRes.body.status).toBe("retired");

        const repeatRetire = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/retire`).set(hrHeaders()).send({ reason: "r2" });
        expect(repeatRetire.status).toBe(409);
      });

      it("assigned -> retired remains blocked (custody must close first) — the frozen invariant still holds after W99", async () => {
        const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
        await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/assign`).set(hrHeaders()).send({ employeeId: EMPLOYEE_ID });
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "r" });
        expect(res.status).toBe(409);
      });

      it("there is no disposed status — retirement always results in status=retired", async () => {
        const created = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/retire`).set(hrHeaders()).send({ reason: "Disposal — write-off" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("retired");
        expect(res.body.status).not.toBe("disposed");
      });
    });
  });

  describe("maintenance (W100)", () => {
    async function createAvailableAsset() {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      return res.body.id as number;
    }
    async function createAssignedAsset(employeeId = EMPLOYEE_ID) {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId });
      return assetId;
    }
    async function scheduleMaintenance(assetId: number) {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
      return res.body.id as number;
    }

    describe("create — POST .../assets/:id/maintenance", () => {
      it("schedules a maintenance record on an available asset without touching the asset's own status", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Annual service", cost: 50, notes: "n" });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe("scheduled");
        expect(res.body.startedAt).toBeNull();
        expect(res.body.completedAt).toBeNull();
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("available");
      });

      it("schedules a maintenance record on an assigned asset without touching custody", async () => {
        const assetId = await createAssignedAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(201);
        const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
        expect(list.body[0].custodyEndedAt).toBeNull();
      });

      it("rejects scheduling maintenance on a retired asset", async () => {
        const assetId = await createAvailableAsset();
        await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/retire`).set(hrHeaders()).send({ reason: "r" });
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(409);
      });

      it("rejects a negative cost", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair", cost: -5 });
        expect(res.status).toBe(400);
      });

      it("rejects a missing maintenanceType", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({});
        expect(res.status).toBe(400);
      });

      it("denies an employee without asset_management.manage", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(employeeHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(403);
      });

      it("denies a manager (relationship-only authority, Decision 4)", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(managerHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(403);
      });

      it("returns 404 for a nonexistent asset", async () => {
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/999999/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(404);
      });

      it("returns 404 for a foreign-org asset", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${created.body.id}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(404);
      });

      it("denies module-disabled access", async () => {
        const assetId = await createAvailableAsset();
        state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders()).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(403);
      });

      it("denies unauthenticated requests", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).send({ maintenanceType: "Repair" });
        expect(res.status).toBe(401);
      });
    });

    describe("list — GET .../assets/:id/maintenance", () => {
      it("returns this asset's maintenance history", async () => {
        const assetId = await createAvailableAsset();
        await scheduleMaintenance(assetId);
        await scheduleMaintenance(assetId);
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
      });

      it("is asset-scoped — never returns another asset's history", async () => {
        const assetId = await createAvailableAsset();
        const otherAssetId = await createAvailableAsset();
        await scheduleMaintenance(assetId);
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${otherAssetId}/maintenance`).set(hrHeaders());
        expect(res.body).toEqual([]);
      });

      it("denies an employee and a manager", async () => {
        const assetId = await createAvailableAsset();
        const empRes = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(employeeHeaders());
        expect(empRes.status).toBe(403);
        const mgrRes = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(managerHeaders());
        expect(mgrRes.status).toBe(403);
      });

      it("returns 404 for a foreign-org asset", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/maintenance`).set(hrHeaders());
        expect(res.status).toBe(404);
      });

      it("never emits an audit row", async () => {
        const assetId = await createAvailableAsset();
        await scheduleMaintenance(assetId);
        const countBefore = state.auditRows.length;
        await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders());
        expect(state.auditRows.length).toBe(countBefore);
      });
    });

    describe("transition — PATCH .../asset-maintenance/:id (action=start)", () => {
      it("starts a scheduled record on an available asset, flipping the asset to 'maintenance'", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("in_progress");
        expect(res.body.startedAt).not.toBeNull();
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("maintenance");
      });

      it("starts a scheduled record on an assigned asset — the active assignment row stays open (custody not relinquished)", async () => {
        const assetId = await createAssignedAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("maintenance");
        const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
        expect(list.body[0].custodyEndedAt).toBeNull();
        expect(list.body[0].employeeId).toBe(EMPLOYEE_ID);
      });

      it("rejects starting an already-started record with a controlled 409", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        expect(res.status).toBe(409);
      });

      it("rejects starting when the asset is no longer in a startable state (e.g. marked lost after scheduling) and rolls back the maintenance row", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        expect(res.status).toBe(409);
        const history = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders());
        expect(history.body[0].status).toBe("scheduled");
      });

      it("denies an employee and a manager", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        const empRes = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(employeeHeaders()).send({ action: "start" });
        expect(empRes.status).toBe(403);
        const mgrRes = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(managerHeaders()).send({ action: "start" });
        expect(mgrRes.status).toBe(403);
      });

      it("returns 404 for a nonexistent maintenance id", async () => {
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/999999`).set(hrHeaders()).send({ action: "start" });
        expect(res.status).toBe(404);
      });

      it("returns 404 for a real foreign-org maintenance id, never leaking existence", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const scheduled = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets/${created.body.id}/maintenance`).set(otherOrgHrHeaders()).send({ maintenanceType: "Repair" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${scheduled.body.id}`).set(hrHeaders()).send({ action: "start" });
        expect(res.status).toBe(404);
      });

      it("a genuine concurrent double-start race resolves to exactly one winner", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        const [a, b] = await Promise.all([
          request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" }),
          request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" }),
        ]);
        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual([200, 409]);
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("maintenance");
      });

      it("emits asset_maintenance.started", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        expect(state.auditRows.some((r) => r.eventType === "asset_maintenance.started")).toBe(true);
      });
    });

    describe("transition — PATCH .../asset-maintenance/:id (action=complete)", () => {
      async function startedMaintenance(assetId: number) {
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        return maintenanceId;
      }

      it("derives 'available' when no active assignment exists", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("completed");
        expect(res.body.completedAt).not.toBeNull();
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("available");
      });

      it("derives 'assigned' when an active assignment still exists, and never touches the assignment row", async () => {
        const assetId = await createAssignedAsset();
        const maintenanceId = await startedMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("assigned");
        const list = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/assignments`).set(hrHeaders());
        expect(list.body[0].custodyEndedAt).toBeNull();
        expect(list.body[0].employeeId).toBe(EMPLOYEE_ID);
      });

      it("the caller cannot supply a target asset status — an extraneous field is ignored, the derivation alone decides", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete", targetStatus: "lost", status: "lost" });
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("available");
      });

      it("rejects completing a record that has not been started yet", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        expect(res.status).toBe(409);
      });

      it("rejects completing an already-completed record", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        expect(res.status).toBe(409);
      });

      it("a real race — the asset is marked lost while maintenance is in_progress — blocks completion with a controlled 409 and leaves the maintenance record in_progress", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/mark-lost`).set(hrHeaders()).send({ reason: "r" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        expect(res.status).toBe(409);
        const history = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders());
        expect(history.body[0].status).toBe("in_progress");
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("lost");
      });

      it("a genuine concurrent double-complete race resolves to exactly one winner, and the final DB state is independently consistent", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        const [a, b] = await Promise.all([
          request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" }),
          request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" }),
        ]);
        const statuses = [a.status, b.status].sort();
        expect(statuses).toEqual([200, 409]);
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("available");
        const history = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/maintenance`).set(hrHeaders());
        expect(history.body[0].status).toBe("completed");
      });

      it("denies an employee and a manager", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        const empRes = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(employeeHeaders()).send({ action: "complete" });
        expect(empRes.status).toBe(403);
        const mgrRes = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(managerHeaders()).send({ action: "complete" });
        expect(mgrRes.status).toBe(403);
      });

      it("emits asset_maintenance.completed", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await startedMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "complete" });
        expect(state.auditRows.some((r) => r.eventType === "asset_maintenance.completed")).toBe(true);
      });
    });

    describe("transition — PATCH .../asset-maintenance/:id (action=cancel)", () => {
      it("cancels a merely-scheduled record without ever touching the asset's own status", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "cancel" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("cancelled");
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("available");
      });

      it("cancels an in-progress record and restores the asset's own derived status", async () => {
        const assetId = await createAssignedAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "start" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "cancel" });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("cancelled");
        const asset = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}`).set(hrHeaders());
        expect(asset.body.status).toBe("assigned");
      });

      it("rejects cancelling an already-terminal record", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "cancel" });
        const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "cancel" });
        expect(res.status).toBe(409);
      });

      it("emits asset_maintenance.cancelled", async () => {
        const assetId = await createAvailableAsset();
        const maintenanceId = await scheduleMaintenance(assetId);
        await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "cancel" });
        expect(state.auditRows.some((r) => r.eventType === "asset_maintenance.cancelled")).toBe(true);
      });
    });

    it("rejects an unknown action value", async () => {
      const assetId = await createAvailableAsset();
      const maintenanceId = await scheduleMaintenance(assetId);
      const res = await request(app).patch(`/api/organizations/${ORG_ID}/asset-maintenance/${maintenanceId}`).set(hrHeaders()).send({ action: "delete" });
      expect(res.status).toBe(400);
    });
  });

  describe("evidence (W100)", () => {
    async function createAvailableAsset() {
      const res = await request(app).post(`/api/organizations/${ORG_ID}/assets`).set(hrHeaders()).send({ categoryCode: "laptop", name: "X" });
      return res.body.id as number;
    }
    async function createAssignedAsset(employeeId = EMPLOYEE_ID) {
      const assetId = await createAvailableAsset();
      await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/assign`).set(hrHeaders()).send({ employeeId });
      return assetId;
    }
    function upload(assetId: number, headers: Record<string, string>, opts: { buffer?: Buffer; filename?: string; contentType?: string; orgId?: number } = {}) {
      return request(app)
        .post(`/api/organizations/${opts.orgId ?? ORG_ID}/assets/${assetId}/evidence`)
        .set(headers)
        .attach("file", opts.buffer ?? PDF_BUFFER, { filename: opts.filename ?? "evidence.pdf", contentType: opts.contentType ?? "application/pdf" });
    }

    describe("upload — POST .../assets/:id/evidence", () => {
      it("lets an organization-wide (asset_management.manage) caller attach evidence", async () => {
        const assetId = await createAvailableAsset();
        const res = await upload(assetId, hrHeaders());
        expect(res.status).toBe(201);
        expect(res.body.assetId).toBe(assetId);
        expect(res.body.fileName).toBe("evidence.pdf");
        expect(res.body.mimeType).toBe("application/pdf");
      });

      it("lets an employee who currently holds this asset attach evidence too — the same visibility tier as the asset itself, not .manage-only", async () => {
        const assetId = await createAssignedAsset();
        const res = await upload(assetId, employeeHeaders());
        expect(res.status).toBe(201);
      });

      it("creates the employee_documents row with employeeId=null — an asset has no natural single-employee owner", async () => {
        const assetId = await createAvailableAsset();
        await upload(assetId, hrHeaders());
        expect(state.documentRows).toHaveLength(1);
        expect(state.documentRows[0].employeeId).toBeNull();
      });

      it("denies an employee with no active assignment on this asset", async () => {
        const assetId = await createAvailableAsset();
        const res = await upload(assetId, employeeHeaders());
        expect(res.status).toBe(403);
      });

      it("denies an unrelated employee even when someone else currently holds the asset", async () => {
        const assetId = await createAssignedAsset(EMPLOYEE_ID);
        const res = await upload(assetId, employee2Headers());
        expect(res.status).toBe(403);
      });

      it("denies a manager (relationship-only authority) with no active assignment of their own", async () => {
        const assetId = await createAssignedAsset(EMPLOYEE_ID);
        const res = await upload(assetId, managerHeaders());
        expect(res.status).toBe(403);
      });

      it("rejects a file whose content does not match an allowed type, with a controlled 400 not a raw 500", async () => {
        const assetId = await createAvailableAsset();
        const res = await upload(assetId, hrHeaders(), { buffer: Buffer.from("not a real pdf"), filename: "fake.pdf" });
        expect(res.status).toBe(400);
        expect(state.assetEvidenceRows).toHaveLength(0);
      });

      it("rejects an oversized file with a typed 400, not a raw 500", async () => {
        const assetId = await createAvailableAsset();
        const oversized = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(11 * 1024 * 1024, 0)]);
        const res = await upload(assetId, hrHeaders(), { buffer: oversized });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/10MB/);
      });

      it("returns 404 for a nonexistent asset", async () => {
        const res = await upload(999999, hrHeaders());
        expect(res.status).toBe(404);
      });

      it("returns 404 for a foreign-org asset", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const res = await upload(created.body.id, hrHeaders());
        expect(res.status).toBe(404);
      });

      it("denies module-disabled access", async () => {
        const assetId = await createAvailableAsset();
        state.organizationModuleRows = state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== ORG_ID);
        const res = await upload(assetId, hrHeaders());
        expect(res.status).toBe(403);
      });

      it("denies unauthenticated requests", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).post(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence`).attach("file", PDF_BUFFER, { filename: "evidence.pdf", contentType: "application/pdf" });
        expect(res.status).toBe(401);
      });

      it("cleans up the written file if the DB transaction fails (no orphan)", async () => {
        const assetId = await createAvailableAsset();
        const spy = vi.spyOn(db as { transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> }, "transaction").mockRejectedValueOnce(new Error("simulated DB failure"));
        const res = await upload(assetId, hrHeaders());
        expect(res.status).toBe(500);
        expect(fileStorage.deleteOrgFile).toHaveBeenCalledWith(ORG_ID, "documents/mock-evidence-key.pdf");
        expect(state.documentRows).toHaveLength(0);
        expect(state.assetEvidenceRows).toHaveLength(0);
        spy.mockRestore();
      });

      it("emits both employee_document.uploaded and asset_evidence.attached", async () => {
        const assetId = await createAvailableAsset();
        await upload(assetId, hrHeaders());
        expect(state.auditRows.some((r) => r.eventType === "employee_document.uploaded")).toBe(true);
        expect(state.auditRows.some((r) => r.eventType === "asset_evidence.attached")).toBe(true);
      });
    });

    describe("list — GET .../assets/:id/evidence", () => {
      it("returns evidence for an organization-wide caller", async () => {
        const assetId = await createAvailableAsset();
        await upload(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence`).set(hrHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].fileName).toBe("evidence.pdf");
      });

      it("returns evidence for an employee who currently holds the asset", async () => {
        const assetId = await createAssignedAsset();
        await upload(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence`).set(employeeHeaders());
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
      });

      it("denies an unrelated employee", async () => {
        const assetId = await createAssignedAsset(EMPLOYEE_ID);
        await upload(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence`).set(employee2Headers());
        expect(res.status).toBe(403);
      });

      it("returns 404 for a foreign-org asset", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/evidence`).set(hrHeaders());
        expect(res.status).toBe(404);
      });

      it("never emits an audit row", async () => {
        const assetId = await createAvailableAsset();
        await upload(assetId, hrHeaders());
        const countBefore = state.auditRows.length;
        await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence`).set(hrHeaders());
        expect(state.auditRows.length).toBe(countBefore);
      });
    });

    describe("download — GET .../assets/:id/evidence/:evidenceId/download", () => {
      async function uploadedEvidence(assetId: number, headers: Record<string, string>, orgId = ORG_ID) {
        const res = await upload(assetId, headers, { orgId });
        return res.body.id as number;
      }

      it("streams the file for an organization-wide caller, bytes matching what readOrgFile returns", async () => {
        const assetId = await createAvailableAsset();
        const evidenceId = await uploadedEvidence(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/${evidenceId}/download`).set(hrHeaders());
        expect(res.status).toBe(200);
        expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe("asset evidence file contents");
      });

      it("authorization is checked before any storage read — a denied caller never triggers readOrgFile", async () => {
        const assetId = await createAssignedAsset(EMPLOYEE_ID);
        const evidenceId = await uploadedEvidence(assetId, hrHeaders());
        vi.mocked(fileStorage.readOrgFile).mockClear();
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/${evidenceId}/download`).set(employee2Headers());
        expect(res.status).toBe(403);
        expect(fileStorage.readOrgFile).not.toHaveBeenCalled();
      });

      it("lets an employee who currently holds the asset download", async () => {
        const assetId = await createAssignedAsset();
        const evidenceId = await uploadedEvidence(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/${evidenceId}/download`).set(employeeHeaders());
        expect(res.status).toBe(200);
      });

      it("returns 404 for a nonexistent evidence id", async () => {
        const assetId = await createAvailableAsset();
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/999999/download`).set(hrHeaders());
        expect(res.status).toBe(404);
      });

      it("returns 404 for a real foreign-org evidence id, never leaking existence", async () => {
        const created = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/assets`).set(otherOrgHrHeaders()).send({ categoryCode: "laptop", name: "X" });
        const evidenceId = await uploadedEvidence(created.body.id, otherOrgHrHeaders(), OTHER_ORG_ID);
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${created.body.id}/evidence/${evidenceId}/download`).set(hrHeaders());
        expect(res.status).toBe(404);
      });

      it("denies unauthenticated requests", async () => {
        const assetId = await createAvailableAsset();
        const evidenceId = await uploadedEvidence(assetId, hrHeaders());
        const res = await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/${evidenceId}/download`);
        expect(res.status).toBe(401);
      });

      it("never emits an audit row", async () => {
        const assetId = await createAvailableAsset();
        const evidenceId = await uploadedEvidence(assetId, hrHeaders());
        const countBefore = state.auditRows.length;
        await request(app).get(`/api/organizations/${ORG_ID}/assets/${assetId}/evidence/${evidenceId}/download`).set(hrHeaders());
        expect(state.auditRows.length).toBe(countBefore);
      });
    });
  });
});
