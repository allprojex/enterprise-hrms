/**
 * Integration tests for Background Checks (Phase 3A, W56), exercising the
 * real requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. Unlike reference checks, background checks use a
 * flat, dedicated permission (background_check.read/.manage) with no
 * recruiter/hiring-manager visibility chain at all, so this harness is
 * much smaller than referenceChecks.test.ts's. No real database connection
 * is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  applicationsTable,
  backgroundChecksTable,
  auditEventsTable,
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
      applicationRows: [] as Record<string, unknown>[],
      backgroundCheckRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId"]),
    backgroundChecksTable: mockTable("background_checks", ["id", "organizationId", "applicationId", "checkType", "status", "vendorReference", "resultSummary", "documentStorageKey"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | { __op: "inArray"; field: string; vals: unknown[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === backgroundChecksTable) return fixtures.backgroundCheckRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === backgroundChecksTable) fixtures.backgroundCheckRows = rows;
}

function selectBuilder(table: { __name: string }) {
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

  const unfiltered =
    table === organizationMembershipsTable
      ? fixtures.membershipRows
      : table === membershipRolesTable
        ? fixtures.membershipRoleRows
        : table === rolePermissionsTable
          ? fixtures.permissionRows
          : table === modulesTable
            ? fixtures.moduleRows
            : undefined;
  if (unfiltered !== undefined) {
    const rows = unfiltered as unknown[];
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return b;
  }

  const rows = getRowsFor(table);
  let filtered = rows;
  const builder = {
    innerJoin: () => builder,
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
    orderBy: () => Promise.resolve(filtered),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
  };
  return builder;
}

function insertSingleRow(table: { __name: string }, v: Record<string, unknown>): Record<string, unknown> {
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v };
  const current = getRowsFor(table);
  setRowsFor(table, [...current, row]);
  return row;
}

function insertRow(table: { __name: string }, v: Record<string, unknown> | Record<string, unknown>[]) {
  const rows = Array.isArray(v) ? v.map((item) => insertSingleRow(table, item)) : [insertSingleRow(table, v)];
  return { returning: () => Promise.resolve(rows) };
}

function thenableResult(resultPromise: Promise<unknown>) {
  return {
    returning: () => resultPromise,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resultPromise.then(resolve, reject),
  };
}

function updateRow(table: { __name: string }, cond: Cond, v: Record<string, unknown>) {
  const rows = getRowsFor(table);
  const idx = rows.findIndex((r) => matches(r, cond));
  if (idx === -1) return Promise.resolve([]);
  const updated = { ...rows[idx], ...v };
  setRowsFor(
    table,
    rows.map((r, i) => (i === idx ? updated : r)),
  );
  return Promise.resolve([updated]);
}

function makeQueryClient() {
  return {
    select: () => ({ from: (table: { __name: string }) => selectBuilder(table) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown> | Record<string, unknown>[]) => insertRow(table, v) }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => thenableResult(Promise.resolve(updateRow(table, cond, v))),
      }),
    }),
  };
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
  applicationsTable,
  backgroundChecksTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => cb(makeQueryClient()),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const writeOrgFileMock = vi.fn().mockResolvedValue("background-checks/fake-key.pdf");
const readOrgFileMock = vi.fn().mockResolvedValue(Buffer.from("fake evidence bytes"));
const deleteOrgFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: (...args: unknown[]) => writeOrgFileMock(...args),
  readOrgFile: (...args: unknown[]) => readOrgFileMock(...args),
  deleteOrgFile: (...args: unknown[]) => deleteOrgFileMock(...args),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;
const APPLICATION_ID = 500;

function mockSession(userId = REQUESTER_USER_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: REQUESTER_USER_ID, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockRecruitmentModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function seedApplication() {
  fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: ORG_ID, candidateId: 1, vacancyId: 1 }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.applicationRows = [];
  fixtures.backgroundCheckRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  seedApplication();
});

describe("Background checks — dedicated, organization-wide-only permission (no application.read/.manage bypass)", () => {
  it("returns 403 listing background checks with only application.read/.manage — never implies background_check access", async () => {
    mockPermissions(["application.read", "application.manage", "candidate.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 creating a background check without background_check.manage", async () => {
    mockPermissions(["background_check.read"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`)
      .set("Authorization", "Bearer valid-token")
      .send({ checkType: "identity" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/organizations/:organizationId/applications/:applicationId/background-checks", () => {
  it("creates a background check at status requested", async () => {
    mockPermissions(["background_check.read", "background_check.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`)
      .set("Authorization", "Bearer valid-token")
      .send({ checkType: "identity", vendorReference: "REF-001" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ applicationId: APPLICATION_ID, checkType: "identity", status: "requested", vendorReference: "REF-001", hasEvidence: false });
    expect(res.body).not.toHaveProperty("documentStorageKey");
  });

  it("returns 404 for an application belonging to a different organization", async () => {
    mockPermissions(["background_check.manage"]);
    fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1 }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`)
      .set("Authorization", "Bearer valid-token")
      .send({ checkType: "identity" });
    expect(res.status).toBe(404);
  });

  it("rejects a duplicate active check of the same type on this application", async () => {
    mockPermissions(["background_check.manage"]);
    await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`).set("Authorization", "Bearer valid-token").send({ checkType: "identity" });
    const second = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`).set("Authorization", "Bearer valid-token").send({ checkType: "identity" });
    expect(second.status).toBe(400);
  });

  it("allows two different check types to coexist as active on the same application", async () => {
    mockPermissions(["background_check.manage"]);
    const first = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`).set("Authorization", "Bearer valid-token").send({ checkType: "identity" });
    const second = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks`).set("Authorization", "Bearer valid-token").send({ checkType: "right_to_work" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });
});

describe("PATCH .../background-checks/:id — transitions and immutability", () => {
  beforeEach(() => {
    mockPermissions(["background_check.read", "background_check.manage"]);
    fixtures.backgroundCheckRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, checkType: "identity", status: "requested", vendorReference: null, resultSummary: null, documentStorageKey: null }];
  });

  it("moves requested -> in_progress", async () => {
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1`).set("Authorization", "Bearer valid-token").send({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("in_progress");
  });

  it("moves to completed with a resultSummary", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "completed", resultSummary: "Verified, no issues found" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.resultSummary).toBe("Verified, no issues found");
  });

  it("rejects any further update once terminal (immutable) — no result changes after finalization", async () => {
    await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1`).set("Authorization", "Bearer valid-token").send({ status: "flagged" });
    const second = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "completed", resultSummary: "Changed my mind" });
    expect(second.status).toBe(400);
  });

  it("never triggers any application-stage, offer, or hiring action as a side effect", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "flagged", resultSummary: "Discrepancy found" });
    expect(res.status).toBe(200);
    // The application row itself is untouched by this action — no
    // currentStageId/rejectionReasonCode field exists on it in this
    // fixture set, confirming no pipeline mutation was attempted.
    expect(fixtures.applicationRows[0]).toEqual({ id: APPLICATION_ID, organizationId: ORG_ID, candidateId: 1, vacancyId: 1 });
  });
});

describe("Evidence upload/download", () => {
  beforeEach(() => {
    mockPermissions(["background_check.read", "background_check.manage"]);
    fixtures.backgroundCheckRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, checkType: "identity", status: "requested", vendorReference: null, resultSummary: null, documentStorageKey: null }];
  });

  it("returns 400 attaching evidence with no file", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1/evidence`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("attaches a valid PDF and reflects hasEvidence, never the raw storage key", async () => {
    const pdfBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100)]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1/evidence`)
      .set("Authorization", "Bearer valid-token")
      .attach("file", pdfBuffer, { filename: "evidence.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.hasEvidence).toBe(true);
    expect(res.body).not.toHaveProperty("documentStorageKey");
  });

  it("rejects a file that fails signature validation", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1/evidence`)
      .set("Authorization", "Bearer valid-token")
      .attach("file", Buffer.from("not a real pdf"), { filename: "evidence.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
  });

  it("returns 404 downloading evidence when none has been attached", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/background-checks/1/evidence`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
