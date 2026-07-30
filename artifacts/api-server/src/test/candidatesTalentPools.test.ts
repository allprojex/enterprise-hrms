/**
 * Integration tests for Candidate Notes, Tags, and Talent Pools (Phase 3A,
 * W53), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain through supertest. Mirrors
 * applicationPipeline.test.ts's harness style. No real database connection
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
  employeesTable,
  employeeUserLinksTable,
  applicationsTable,
  candidatesTable,
  candidateNotesTable,
  candidateTagsTable,
  vacanciesTable,
  jobRequisitionsTable,
  talentPoolsTable,
  talentPoolMembersTable,
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
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      applicationRows: [] as Record<string, unknown>[],
      candidateRows: [] as Record<string, unknown>[],
      candidateNoteRows: [] as Record<string, unknown>[],
      candidateTagRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      talentPoolRows: [] as Record<string, unknown>[],
      talentPoolMemberRows: [] as Record<string, unknown>[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "branchId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "firstName", "lastName", "email", "phone", "source", "isActive"]),
    candidateNotesTable: mockTable("candidate_notes", ["id", "organizationId", "candidateId", "applicationId", "authorMembershipId", "note"]),
    candidateTagsTable: mockTable("candidate_tags", ["id", "organizationId", "candidateId", "tag"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "recruiterEmployeeId", "hiringManagerEmployeeId"]),
    talentPoolsTable: mockTable("talent_pools", ["id", "organizationId", "name", "description", "isActive"]),
    talentPoolMembersTable: mockTable("talent_pool_members", ["id", "organizationId", "talentPoolId", "candidateId", "addedByMembershipId"]),
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
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === employeeUserLinksTable) return fixtures.employeeUserLinkRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === candidateNotesTable) return fixtures.candidateNoteRows;
  if (table === candidateTagsTable) return fixtures.candidateTagRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === talentPoolsTable) return fixtures.talentPoolRows;
  if (table === talentPoolMembersTable) return fixtures.talentPoolMemberRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === candidateNotesTable) fixtures.candidateNoteRows = rows;
  else if (table === candidateTagsTable) fixtures.candidateTagRows = rows;
  else if (table === talentPoolsTable) fixtures.talentPoolRows = rows;
  else if (table === talentPoolMembersTable) fixtures.talentPoolMemberRows = rows;
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

function deleteRow(table: { __name: string }, cond: Cond) {
  const rows = getRowsFor(table);
  const idx = rows.findIndex((r) => matches(r, cond));
  if (idx === -1) return Promise.resolve([]);
  const removed = rows[idx];
  setRowsFor(
    table,
    rows.filter((_, i) => i !== idx),
  );
  return Promise.resolve([removed]);
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
    delete: (table: { __name: string }) => ({
      where: (cond: Cond) => thenableResult(Promise.resolve(deleteRow(table, cond))),
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
  employeesTable,
  employeeUserLinksTable,
  applicationsTable,
  candidatesTable,
  candidateNotesTable,
  candidateTagsTable,
  vacanciesTable,
  jobRequisitionsTable,
  talentPoolsTable,
  talentPoolMembersTable,
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

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;
const RECRUITER_EMPLOYEE_ID = 2;

const VACANCY_ID = 100;
const REQUISITION_ID = 200;
const CANDIDATE_ID = 400;
const APPLICATION_ID = 500;
const POOL_ID = 600;

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

function mockLinkedEmployee(employeeId: number, applicationUserId = REQUESTER_USER_ID) {
  fixtures.employeeUserLinkRows = [{ employeeId, applicationUserId }];
}

function seedCandidateWithApplication(overrides: Record<string, unknown> = {}) {
  fixtures.candidateRows = [{ id: CANDIDATE_ID, organizationId: ORG_ID, firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: null, source: "careers_portal", isActive: true }];
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, recruiterEmployeeId: null, hiringManagerEmployeeId: null, ...overrides }];
  fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID }];
  fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.applicationRows = [];
  fixtures.candidateRows = [];
  fixtures.candidateNoteRows = [];
  fixtures.candidateTagRows = [];
  fixtures.vacancyRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.talentPoolRows = [];
  fixtures.talentPoolMemberRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
});

describe("GET /api/organizations/:organizationId/candidates — visibility", () => {
  it("returns 403 without candidate.read", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("an org-wide holder (candidate.manage) sees every candidate in the organization", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    seedCandidateWithApplication();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("a caller without org-wide reach sees only candidates reachable via an application to a requisition that assigns them", async () => {
    mockPermissions(["candidate.read"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    seedCandidateWithApplication();

    const notAssigned = await request(app).get(`/api/organizations/${ORG_ID}/candidates`).set("Authorization", "Bearer valid-token");
    expect(notAssigned.body.total).toBe(0);

    fixtures.jobRequisitionRows[0].recruiterEmployeeId = RECRUITER_EMPLOYEE_ID;
    const assigned = await request(app).get(`/api/organizations/${ORG_ID}/candidates`).set("Authorization", "Bearer valid-token");
    expect(assigned.body.total).toBe(1);
  });

  it("does not leak another organization's candidates", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    fixtures.candidateRows = [{ id: 1, organizationId: OTHER_ORG_ID, firstName: "X", lastName: "Y", email: "x@example.com", phone: null, source: "careers_portal", isActive: true }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/organizations/:organizationId/candidates/:id", () => {
  it("returns 404 for a candidate that exists but is not visible to this caller", async () => {
    mockPermissions(["candidate.read"]);
    seedCandidateWithApplication();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns candidate detail for a visible candidate", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    seedCandidateWithApplication();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: "Jane", lastName: "Doe", email: "jane@example.com" });
  });
});

describe("GET/POST /api/organizations/:organizationId/candidates/:id/notes", () => {
  it("returns 403 listing notes without candidate.notes.read", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    seedCandidateWithApplication();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 listing notes for a candidate not visible to this caller, even with candidate.notes.read", async () => {
    mockPermissions(["candidate.read", "candidate.notes.read"]);
    seedCandidateWithApplication();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 403 creating a note without candidate.notes.write (read alone is not enough)", async () => {
    mockPermissions(["candidate.read", "candidate.manage", "candidate.notes.read"]);
    seedCandidateWithApplication();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`).set("Authorization", "Bearer valid-token").send({ note: "Great communicator" });
    expect(res.status).toBe(403);
  });

  it("creates a candidate-level note (no applicationId) and lists it back newest first", async () => {
    mockPermissions(["candidate.read", "candidate.manage", "candidate.notes.read", "candidate.notes.write"]);
    seedCandidateWithApplication();
    const create = await request(app).post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`).set("Authorization", "Bearer valid-token").send({ note: "Great communicator" });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ candidateId: CANDIDATE_ID, applicationId: null, note: "Great communicator" });

    const list = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`).set("Authorization", "Bearer valid-token");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it("creates an application-level note when applicationId belongs to this candidate", async () => {
    mockPermissions(["candidate.read", "candidate.manage", "candidate.notes.write"]);
    seedCandidateWithApplication();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`)
      .set("Authorization", "Bearer valid-token")
      .send({ note: "Strong in the screening call", applicationId: APPLICATION_ID });
    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBe(APPLICATION_ID);
  });

  it("rejects an applicationId that does not belong to this candidate", async () => {
    mockPermissions(["candidate.read", "candidate.manage", "candidate.notes.write"]);
    seedCandidateWithApplication();
    fixtures.applicationRows.push({ id: 999, organizationId: ORG_ID, candidateId: 999999, vacancyId: VACANCY_ID });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/notes`)
      .set("Authorization", "Bearer valid-token")
      .send({ note: "Mismatched application", applicationId: 999 });
    expect(res.status).toBe(400);
  });
});

describe("GET/POST/DELETE /api/organizations/:organizationId/candidates/:id/tags", () => {
  it("returns 403 adding a tag with only candidate.read (tags are gated by candidate.manage)", async () => {
    mockPermissions(["candidate.read"]);
    seedCandidateWithApplication();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags`).set("Authorization", "Bearer valid-token").send({ tag: "senior" });
    expect(res.status).toBe(403);
  });

  it("adds and lists tags, then removes one", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    seedCandidateWithApplication();

    await request(app).post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags`).set("Authorization", "Bearer valid-token").send({ tag: "senior" });
    const addSecond = await request(app).post(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags`).set("Authorization", "Bearer valid-token").send({ tag: "backend" });
    expect(addSecond.status).toBe(201);

    const list = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags`).set("Authorization", "Bearer valid-token");
    expect(list.status).toBe(200);
    expect(list.body.map((t: { tag: string }) => t.tag).sort()).toEqual(["backend", "senior"]);

    const tagId = list.body[0].id;
    const remove = await request(app).delete(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags/${tagId}`).set("Authorization", "Bearer valid-token");
    expect(remove.status).toBe(204);

    const listAfter = await request(app).get(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags`).set("Authorization", "Bearer valid-token");
    expect(listAfter.body).toHaveLength(1);
  });

  it("returns 404 removing a tag that does not exist", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    seedCandidateWithApplication();
    const res = await request(app).delete(`/api/organizations/${ORG_ID}/candidates/${CANDIDATE_ID}/tags/99999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Talent pools — org-wide only, no assigned tier", () => {
  it("returns 403 listing pools without talent_pool.read, even for a candidate.manage (org-wide recruitment) holder", async () => {
    mockPermissions(["candidate.read", "candidate.manage"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/talent-pools`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 for an assigned recruiter without talent_pool.manage (no assigned tier exists for pools)", async () => {
    mockPermissions(["candidate.read"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    seedCandidateWithApplication({ recruiterEmployeeId: RECRUITER_EMPLOYEE_ID });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools`).set("Authorization", "Bearer valid-token").send({ name: "Frontend Engineers" });
    expect(res.status).toBe(403);
  });

  it("creates, lists, updates, archives, and reactivates a talent pool", async () => {
    mockPermissions(["talent_pool.read", "talent_pool.manage"]);

    const create = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools`).set("Authorization", "Bearer valid-token").send({ name: "Frontend Engineers", description: "React specialists" });
    expect(create.status).toBe(201);
    const poolId = create.body.id;

    const list = await request(app).get(`/api/organizations/${ORG_ID}/talent-pools`).set("Authorization", "Bearer valid-token");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const update = await request(app).patch(`/api/organizations/${ORG_ID}/talent-pools/${poolId}`).set("Authorization", "Bearer valid-token").send({ description: "React and Vue specialists" });
    expect(update.status).toBe(200);
    expect(update.body.description).toBe("React and Vue specialists");

    const archive = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools/${poolId}/archive`).set("Authorization", "Bearer valid-token");
    expect(archive.status).toBe(200);
    expect(archive.body.isActive).toBe(false);

    const reactivate = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools/${poolId}/reactivate`).set("Authorization", "Bearer valid-token");
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.isActive).toBe(true);
  });

  it("returns 404 for a talent pool belonging to a different organization", async () => {
    mockPermissions(["talent_pool.read"]);
    fixtures.talentPoolRows = [{ id: POOL_ID, organizationId: OTHER_ORG_ID, name: "Other Org Pool", description: null, isActive: true }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Talent pool members", () => {
  beforeEach(() => {
    mockPermissions(["talent_pool.read", "talent_pool.manage"]);
    seedCandidateWithApplication();
    fixtures.talentPoolRows = [{ id: POOL_ID, organizationId: ORG_ID, name: "Frontend Engineers", description: null, isActive: true }];
  });

  it("adds a candidate to a pool and lists membership", async () => {
    const add = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members`).set("Authorization", "Bearer valid-token").send({ candidateId: CANDIDATE_ID });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ talentPoolId: POOL_ID, candidateId: CANDIDATE_ID });

    const list = await request(app).get(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members`).set("Authorization", "Bearer valid-token");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it("returns 404 adding a candidate that does not exist in this organization", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members`).set("Authorization", "Bearer valid-token").send({ candidateId: 999999 });
    expect(res.status).toBe(404);
  });

  it("removes a candidate from a pool, then 404s removing again", async () => {
    await request(app).post(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members`).set("Authorization", "Bearer valid-token").send({ candidateId: CANDIDATE_ID });

    const remove = await request(app).delete(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members/${CANDIDATE_ID}`).set("Authorization", "Bearer valid-token");
    expect(remove.status).toBe(204);

    const removeAgain = await request(app).delete(`/api/organizations/${ORG_ID}/talent-pools/${POOL_ID}/members/${CANDIDATE_ID}`).set("Authorization", "Bearer valid-token");
    expect(removeAgain.status).toBe(404);
  });
});
