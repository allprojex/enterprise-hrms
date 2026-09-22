/**
 * Integration tests for Performance Evidence/Attachments (Phase 3C, W82),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus real service-layer authorization/stage
 * gating through supertest. Mock harness mirrors
 * performanceReviewGoals.test.ts's own generic select/insert/delete/
 * transaction Cond-matching pattern, extended with a hand-rolled innerJoin
 * (performance_review_evidence -> employee_documents, matched by
 * employeeDocumentId = id — the only join shape this workstream's own
 * queries ever use) and employeeDocuments.test.ts's own
 * `vi.mock("../lib/fileStorage", ...)` (no real disk I/O). No real
 * database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  return true;
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
  employeeUserLinksTable,
  employeesTable,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewEvidenceTable,
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
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "applicationUserId", "employeeId"]),
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    performanceReviewsTable: mockTable("performance_reviews", ["id", "organizationId", "cycleId", "employeeId", "reviewerEmployeeId", "status"]),
    performanceReviewGoalsTable: mockTable("performance_review_goals", ["id", "organizationId", "reviewId", "title"]),
    performanceReviewEvidenceTable: mockTable("performance_review_evidence", ["id", "organizationId", "reviewId", "goalId", "employeeDocumentId", "addedByMembershipId", "addedAt"]),
    employeeDocumentsTable: mockTable("employee_documents", ["id", "organizationId", "employeeId", "categoryCode", "fileName", "storageKey", "mimeType", "fileSize", "uploadedBy"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId", "metadata"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      reviewRows: [] as Record<string, unknown>[],
      goalRows: [] as Record<string, unknown>[],
      evidenceRows: [] as Record<string, unknown>[],
      documentRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      nextIds: new Map<string, number>() as Map<string, number>,
    },
  };
});

function nextId(tableName: string): number {
  const n = (state.nextIds.get(tableName) ?? 0) + 1;
  state.nextIds.set(tableName, n);
  return n;
}

const TABLE_STATE_KEY: Record<string, keyof typeof state> = {
  employee_user_links: "employeeUserLinkRows",
  employees: "employeeRows",
  performance_reviews: "reviewRows",
  performance_review_goals: "goalRows",
  performance_review_evidence: "evidenceRows",
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

function makeQueryClient(): unknown {
  const client = {
    select: () => ({
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
        const rows = rowsFor(table);
        const builder = {
          // The only join shape this workstream's queries ever use:
          // performance_review_evidence -> employee_documents, matched by
          // employeeDocumentId = id. The real condition object carries no
          // usable value in this mock's Cond-matching scheme (it compares a
          // column to a literal, not column-to-column), so the relationship
          // is hand-matched here instead — honest, narrow test scaffolding.
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
                  orderBy: () => Promise.resolve(filtered),
                  limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
                  then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
                };
              },
              orderBy: () => Promise.resolve(joined),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(joined).then(resolve, reject),
            };
          },
          where(cond: Cond) {
            const filtered = rows.filter((r) => matches(r, cond));
            return {
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              orderBy: () => Promise.resolve(filtered),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
            };
          },
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const items = Array.isArray(v) ? v : [v];
        const inserted = items.map((item) => ({
          id: nextId(table.__name),
          createdAt: new Date(),
          addedAt: new Date(),
          ...item,
        }));
        setRowsFor(table, [...rowsFor(table), ...inserted]);
        return { returning: () => Promise.resolve(inserted) };
      },
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeeUserLinksTable,
  employeesTable,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewEvidenceTable,
  employeeDocumentsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "documents/mock-key.pdf"),
  readOrgFile: vi.fn(async () => Buffer.from("evidence file contents")),
  deleteOrgFile: vi.fn(async () => undefined),
}));

const { default: app } = await import("../app");
const fileStorage = await import("../lib/fileStorage");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const REVIEWER_USER_ID = 3;
const UNRELATED_USER_ID = 4;

const EMPLOYEE_ID = 1;
const REVIEWER_ID = 2;
const UNRELATED_EMPLOYEE_ID = 3;

const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0)]);

function mockSession(userId: number) {
  state.sessionRows = [
    {
      session: { id: 1, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: `user${userId}@example.com`, firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockMembership(membershipId: number, organizationId: number, applicationUserId: number) {
  state.membershipRows = [...state.membershipRows.filter((m) => m.applicationUserId !== applicationUserId), { id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

function mockPermissions(permissionKeys: string[]) {
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockModuleEnabled() {
  state.moduleRows = [{ id: 1, key: "performance", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  state.organizationModuleRows = [
    { id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true },
    { id: 2, organizationId: OTHER_ORG_ID, moduleId: 1, enabled: true },
  ];
}

function review(overrides: Record<string, unknown> = {}) {
  return { id: 1, organizationId: ORG_ID, cycleId: 1, employeeId: EMPLOYEE_ID, reviewerEmployeeId: REVIEWER_ID, status: "self_assessment", ...overrides };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [];
  state.organizationModuleRows = [];
  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: EMPLOYEE_USER_ID, employeeId: EMPLOYEE_ID },
    { id: 2, applicationUserId: REVIEWER_USER_ID, employeeId: REVIEWER_ID },
    { id: 3, applicationUserId: UNRELATED_USER_ID, employeeId: UNRELATED_EMPLOYEE_ID },
  ];
  state.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID },
    { id: REVIEWER_ID, organizationId: ORG_ID },
    { id: UNRELATED_EMPLOYEE_ID, organizationId: ORG_ID },
  ];
  state.reviewRows = [review()];
  state.goalRows = [];
  state.evidenceRows = [];
  state.documentRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockModuleEnabled();
  vi.mocked(fileStorage.writeOrgFile).mockClear();
  vi.mocked(fileStorage.deleteOrgFile).mockClear();
});

function upload(userId: number, token: string, reviewId: number, opts: { goalId?: number; buffer?: Buffer; filename?: string; contentType?: string } = {}) {
  mockSession(userId);
  const req = request(app)
    .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId}/evidence`)
    .set("Authorization", `Bearer ${token}`);
  if (opts.goalId != null) req.field("goalId", String(opts.goalId));
  return req.attach("file", opts.buffer ?? PDF_BUFFER, { filename: opts.filename ?? "evidence.pdf", contentType: opts.contentType ?? "application/pdf" });
}

describe("POST /api/organizations/:organizationId/performance/reviews/:id/evidence", () => {
  it("returns 403 when the performance module is not enabled", async () => {
    state.moduleRows = [];
    state.organizationModuleRows = [];
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller holds none of the three coarse permissions", async () => {
    mockMembership(5, ORG_ID, UNRELATED_USER_ID);
    mockPermissions([]);
    const res = await upload(UNRELATED_USER_ID, `token-${UNRELATED_USER_ID}`, 1);
    expect(res.status).toBe(403);
  });

  it("the employee uploads evidence to their own review during self_assessment", async () => {
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1);
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("evidence.pdf");
    expect(state.documentRows).toHaveLength(1);
    expect(state.documentRows[0].employeeId).toBe(EMPLOYEE_ID);
    expect(state.documentRows[0].categoryCode).toBe("performance_evidence");
    expect(state.evidenceRows).toHaveLength(1);
    expect(state.evidenceRows[0].reviewId).toBe(1);
    const eventTypes = state.auditRows.map((r) => r.eventType);
    expect(eventTypes).toContain("employee_document.uploaded");
    expect(eventTypes).toContain("performance_review.evidence_attached");
  });

  it("an unrelated employee cannot upload evidence to someone else's review", async () => {
    mockMembership(5, ORG_ID, UNRELATED_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(UNRELATED_USER_ID, `token-${UNRELATED_USER_ID}`, 1);
    expect(res.status).toBe(403);
    expect(state.documentRows).toHaveLength(0);
  });

  it("the employee is denied (409, stale-stage) once the review has moved past self_assessment", async () => {
    state.reviewRows = [review({ status: "manager_review" })];
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1);
    expect(res.status).toBe(409);
    expect(state.documentRows).toHaveLength(0);
  });

  it("the reviewer of record uploads evidence during manager_review", async () => {
    state.reviewRows = [review({ status: "manager_review" })];
    mockMembership(6, ORG_ID, REVIEWER_USER_ID);
    mockPermissions(["performance.review.write"]);
    const res = await upload(REVIEWER_USER_ID, `token-${REVIEWER_USER_ID}`, 1);
    expect(res.status).toBe(201);
    expect(state.documentRows[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("a manager who isn't reviewer-of-record cannot upload, even during manager_review", async () => {
    state.reviewRows = [review({ status: "manager_review" })];
    mockMembership(7, ORG_ID, UNRELATED_USER_ID);
    mockPermissions(["performance.review.write"]);
    const res = await upload(UNRELATED_USER_ID, `token-${UNRELATED_USER_ID}`, 1);
    expect(res.status).toBe(403);
  });

  it("HR uploads evidence (performance.manage) during hr_review", async () => {
    state.reviewRows = [review({ status: "hr_review" })];
    mockMembership(8, ORG_ID, HR_USER_ID);
    mockPermissions(["performance.manage"]);
    const res = await upload(HR_USER_ID, `token-${HR_USER_ID}`, 1);
    expect(res.status).toBe(201);
  });

  it("HR cannot upload while the review is still in hr_review's earlier stages", async () => {
    state.reviewRows = [review({ status: "manager_review" })];
    mockMembership(8, ORG_ID, HR_USER_ID);
    mockPermissions(["performance.manage"]);
    const res = await upload(HR_USER_ID, `token-${HR_USER_ID}`, 1);
    expect(res.status).toBe(409);
  });

  it("no actor can upload once the review is finalized", async () => {
    state.reviewRows = [review({ status: "finalized" })];
    mockMembership(8, ORG_ID, HR_USER_ID);
    mockPermissions(["performance.manage"]);
    const res = await upload(HR_USER_ID, `token-${HR_USER_ID}`, 1);
    expect(res.status).toBe(409);
  });

  it("returns 404 for a review outside this organization", async () => {
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(9, OTHER_ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app)
      .post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/1/evidence`)
      .set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`)
      .attach("file", PDF_BUFFER, { filename: "evidence.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });

  it("rejects a file whose content does not match an allowed type", async () => {
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1, { buffer: Buffer.from("not a real pdf"), filename: "fake.pdf" });
    expect(res.status).toBe(400);
    expect(state.documentRows).toHaveLength(0);
  });

  it("rejects an oversized file with a typed 400, not a raw 500 (multer's own LIMIT_FILE_SIZE error handled explicitly)", async () => {
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const oversized = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(11 * 1024 * 1024, 0)]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1, { buffer: oversized });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10MB/);
    expect(state.documentRows).toHaveLength(0);
  });

  it("accepts an optional goalId belonging to this review", async () => {
    state.goalRows = [{ id: 1, organizationId: ORG_ID, reviewId: 1, title: "Ship X" }];
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1, { goalId: 1 });
    expect(res.status).toBe(201);
    expect(res.body.goalId).toBe(1);
  });

  it("rejects a goalId that doesn't belong to this review", async () => {
    state.goalRows = [{ id: 1, organizationId: ORG_ID, reviewId: 999, title: "Someone else's goal" }];
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1, { goalId: 1 });
    expect(res.status).toBe(404);
    expect(state.documentRows).toHaveLength(0);
  });

  it("cleans up the written file if the DB transaction fails (no orphan)", async () => {
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const originalTransaction = db as { transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    const spy = vi.spyOn(originalTransaction, "transaction").mockRejectedValueOnce(new Error("simulated DB failure"));
    const res = await upload(EMPLOYEE_USER_ID, `token-${EMPLOYEE_USER_ID}`, 1);
    expect(res.status).toBe(500);
    expect(fileStorage.deleteOrgFile).toHaveBeenCalledWith(ORG_ID, "documents/mock-key.pdf");
    expect(state.documentRows).toHaveLength(0);
    expect(state.evidenceRows).toHaveLength(0);
    spy.mockRestore();
  });
});

describe("GET /api/organizations/:organizationId/performance/reviews/:id/evidence", () => {
  beforeEach(() => {
    state.documentRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, categoryCode: "performance_evidence", fileName: "evidence.pdf", storageKey: "documents/k.pdf", mimeType: "application/pdf", fileSize: 100, uploadedBy: EMPLOYEE_USER_ID }];
    state.evidenceRows = [{ id: 1, organizationId: ORG_ID, reviewId: 1, goalId: null, employeeDocumentId: 1, addedByMembershipId: 5, addedAt: new Date() }];
  });

  it("the review's own employee can list evidence", async () => {
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence`).set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fileName).toBe("evidence.pdf");
  });

  it("evidence remains visible after finalization (durable historical record)", async () => {
    state.reviewRows = [review({ status: "finalized" })];
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence`).set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("an unrelated employee is denied (IDOR guard)", async () => {
    mockSession(UNRELATED_USER_ID);
    mockMembership(7, ORG_ID, UNRELATED_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence`).set("Authorization", `Bearer token-${UNRELATED_USER_ID}`);
    expect(res.status).toBe(403);
  });

  it("HR (performance.manage) can view evidence organization-wide", async () => {
    mockSession(HR_USER_ID);
    mockMembership(8, ORG_ID, HR_USER_ID);
    mockPermissions(["performance.manage"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence`).set("Authorization", `Bearer token-${HR_USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("GET /api/organizations/:organizationId/performance/reviews/:id/evidence/:evidenceId/download", () => {
  beforeEach(() => {
    state.documentRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, categoryCode: "performance_evidence", fileName: "evidence.pdf", storageKey: "documents/k.pdf", mimeType: "application/pdf", fileSize: 100, uploadedBy: EMPLOYEE_USER_ID }];
    state.evidenceRows = [{ id: 1, organizationId: ORG_ID, reviewId: 1, goalId: null, employeeDocumentId: 1, addedByMembershipId: 5, addedAt: new Date() }];
  });

  it("the review's own employee can download their evidence", async () => {
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence/1/download`).set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe("evidence file contents");
  });

  it("an unrelated employee is denied download (IDOR guard)", async () => {
    mockSession(UNRELATED_USER_ID);
    mockMembership(7, ORG_ID, UNRELATED_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence/1/download`).set("Authorization", `Bearer token-${UNRELATED_USER_ID}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for an evidence ID that doesn't belong to this review", async () => {
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(5, ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/1/evidence/999/download`).set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a review ID from a different organization (cross-org)", async () => {
    mockSession(EMPLOYEE_USER_ID);
    mockMembership(9, OTHER_ORG_ID, EMPLOYEE_USER_ID);
    mockPermissions(["performance.write.own"]);
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/1/evidence/1/download`).set("Authorization", `Bearer token-${EMPLOYEE_USER_ID}`);
    expect(res.status).toBe(404);
  });
});
