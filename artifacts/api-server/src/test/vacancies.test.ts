/**
 * Integration tests for Vacancies (Phase 3A — the frozen plan's own W48;
 * this session's W47), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain through supertest. Mirrors
 * jobRequisitions.test.ts's harness style (real field-based filtering,
 * simulated unique-index/status-guard behavior). No real database
 * connection is made.
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
  jobRequisitionsTable,
  vacanciesTable,
  vacancyLocationsTable,
  vacancyQuestionsTable,
  branchesTable,
  recruitmentWorkflowsTable,
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
      jobRequisitionRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      vacancyLocationRows: [] as Record<string, unknown>[],
      vacancyQuestionRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      recruitmentWorkflowRows: [] as Record<string, unknown>[],
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
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "status", "recruiterEmployeeId", "hiringManagerEmployeeId"]),
    vacanciesTable: mockTable("vacancies", [
      "id",
      "organizationId",
      "requisitionId",
      "workflowId",
      "publicId",
      "title",
      "visibility",
      "status",
      "openingsCount",
      "filledCount",
      "openDate",
      "closeDate",
      "featured",
      "createdBy",
    ]),
    vacancyLocationsTable: mockTable("vacancy_locations", ["id", "organizationId", "vacancyId", "branchId", "label"]),
    vacancyQuestionsTable: mockTable("vacancy_questions", ["id", "organizationId", "vacancyId", "questionText", "questionType", "isKnockout", "expectedAnswer", "displayOrder"]),
    branchesTable: mockTable("branches", ["id", "organizationId"]),
    recruitmentWorkflowsTable: mockTable("recruitment_workflows", ["id", "organizationId"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

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
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === vacancyLocationsTable) return fixtures.vacancyLocationRows;
  if (table === vacancyQuestionsTable) return fixtures.vacancyQuestionRows;
  if (table === branchesTable) return fixtures.branchRows;
  if (table === recruitmentWorkflowsTable) return fixtures.recruitmentWorkflowRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === jobRequisitionsTable) fixtures.jobRequisitionRows = rows;
  else if (table === vacanciesTable) fixtures.vacancyRows = rows;
  else if (table === vacancyLocationsTable) fixtures.vacancyLocationRows = rows;
  else if (table === vacancyQuestionsTable) fixtures.vacancyQuestionRows = rows;
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

function defaultsFor(table: { __name: string }): Record<string, unknown> {
  if (table === vacanciesTable) return { status: "draft", filledCount: 0, visibility: "internal", openingsCount: 1, featured: false };
  if (table === vacancyQuestionsTable) return { questionType: "text", isKnockout: false, displayOrder: 0 };
  return {};
}

function insertSingleRow(table: { __name: string }, v: Record<string, unknown>): Record<string, unknown> {
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaultsFor(table), ...v };
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

function deleteRows(table: { __name: string }, cond: Cond) {
  const rows = getRowsFor(table);
  setRowsFor(
    table,
    rows.filter((r) => !matches(r, cond)),
  );
  return Promise.resolve([]);
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
      where: (cond: Cond) => thenableResult(Promise.resolve(deleteRows(table, cond))),
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
  jobRequisitionsTable,
  vacanciesTable,
  vacancyLocationsTable,
  vacancyQuestionsTable,
  branchesTable,
  recruitmentWorkflowsTable,
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
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;
const RECRUITER_EMPLOYEE_ID = 2;
const HIRING_MANAGER_EMPLOYEE_ID = 3;
const OUTSIDER_EMPLOYEE_ID = 4;
const APPROVED_REQUISITION_ID = 100;

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

function seedApprovedRequisition(overrides: Record<string, unknown> = {}) {
  fixtures.jobRequisitionRows = [
    { id: APPROVED_REQUISITION_ID, organizationId: ORG_ID, status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null, ...overrides },
  ];
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
  fixtures.jobRequisitionRows = [];
  fixtures.vacancyRows = [];
  fixtures.vacancyLocationRows = [];
  fixtures.vacancyQuestionRows = [];
  fixtures.branchRows = [];
  fixtures.recruitmentWorkflowRows = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/vacancies", () => {
  it("returns 403 when the recruitment module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(false);
    seedApprovedRequisition();

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID });
    expect(res.status).toBe(403);
  });

  it("returns 403 without vacancy.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID });
    expect(res.status).toBe(403);
  });

  it("creates a draft vacancy from an approved requisition, with filledCount always 0", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID, openingsCount: 3 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.filledCount).toBe(0);
    expect(res.body.openingsCount).toBe(3);
    expect(res.body.createdBy).toBe(REQUESTER_USER_ID);
    expect(res.body.publicId).toBeTruthy();
  });

  it.each(["draft", "pending_approval", "rejected", "cancelled", "closed"])(
    "rejects creating a vacancy from a requisition in status %s",
    async (status) => {
      mockSession();
      mockActiveMembership();
      mockPermissions(["vacancy.manage"]);
      mockRecruitmentModuleEnabled(true);
      seedApprovedRequisition({ status });

      const res = await request(app)
        .post("/api/organizations/10/vacancies")
        .set("Authorization", "Bearer valid-token")
        .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID });
      expect(res.status).toBe(400);
    },
  );

  it("rejects a requisitionId belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [{ id: APPROVED_REQUISITION_ID, organizationId: OTHER_ORG_ID, status: "approved" }];

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID });
    expect(res.status).toBe(400);
  });

  it("rejects a non-positive openingsCount", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID, openingsCount: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects a workflowId belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();
    fixtures.recruitmentWorkflowRows = [{ id: 50, organizationId: OTHER_ORG_ID }];

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID, workflowId: 50 });
    expect(res.status).toBe(400);
  });

  it("rejects a location branchId belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();
    fixtures.branchRows = [{ id: 60, organizationId: OTHER_ORG_ID }];

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionId: APPROVED_REQUISITION_ID, locations: [{ branchId: 60 }] });
    expect(res.status).toBe(400);
  });

  it("creates nested locations and questions atomically with the vacancy", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedApprovedRequisition();

    const res = await request(app)
      .post("/api/organizations/10/vacancies")
      .set("Authorization", "Bearer valid-token")
      .send({
        title: "Software Engineer",
        requisitionId: APPROVED_REQUISITION_ID,
        locations: [{ label: "Remote" }],
        questions: [{ questionText: "Do you have 5 years of experience?", questionType: "yes_no", isKnockout: true }],
      });

    expect(res.status).toBe(201);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0].label).toBe("Remote");
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].isKnockout).toBe(true);
  });
});

describe("GET /api/organizations/:organizationId/vacancies — visibility", () => {
  function seedVacancies() {
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, status: "approved", recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null },
      { id: 2, organizationId: ORG_ID, status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: HIRING_MANAGER_EMPLOYEE_ID },
      { id: 3, organizationId: ORG_ID, status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null },
    ];
    fixtures.vacancyRows = [
      { id: 1, organizationId: ORG_ID, requisitionId: 1, title: "I am recruiter", status: "draft", openingsCount: 1, filledCount: 0, createdBy: 999 },
      { id: 2, organizationId: ORG_ID, requisitionId: 2, title: "I am hiring manager", status: "draft", openingsCount: 1, filledCount: 0, createdBy: 999 },
      { id: 3, organizationId: ORG_ID, requisitionId: 3, title: "Not assigned to me", status: "draft", openingsCount: 1, filledCount: 0, createdBy: 999 },
    ];
  }

  it("an org-wide holder (vacancy.manage) sees every vacancy in the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read", "vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    seedVacancies();

    const res = await request(app).get("/api/organizations/10/vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it("a caller without org-wide reach sees only vacancies whose requisition assigns them as recruiter or hiring manager", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read"]);
    mockRecruitmentModuleEnabled(true);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    seedVacancies();

    const res = await request(app).get("/api/organizations/10/vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    const titles = res.body.items.map((v: { title: string }) => v.title);
    expect(titles).toEqual(["I am recruiter"]);
  });

  it("does not leak another organization's vacancies", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read", "vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: OTHER_ORG_ID, requisitionId: 1, title: "Theirs", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).get("/api/organizations/10/vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/organizations/:organizationId/vacancies/:id", () => {
  it("returns 404 for a vacancy that exists but is not visible to this caller", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [{ id: 1, organizationId: ORG_ID, status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null }];
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: 1, title: "Not mine", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).get("/api/organizations/10/vacancies/1").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a vacancy belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read", "vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: OTHER_ORG_ID, requisitionId: 1, title: "Theirs", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).get("/api/organizations/10/vacancies/1").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/organizations/:organizationId/vacancies/:id", () => {
  it("allows editing a draft vacancy", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Old Title", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app)
      .patch("/api/organizations/10/vacancies/1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "New Title" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
  });

  it("rejects editing a vacancy that is no longer a draft", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Published", status: "published", openingsCount: 1, filledCount: 0 }];

    const res = await request(app)
      .patch("/api/organizations/10/vacancies/1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "New Title" });
    expect(res.status).toBe(400);
  });
});

describe("Vacancy lifecycle actions", () => {
  it("publish transitions draft -> published when openDate is unset", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Draft", status: "draft", openingsCount: 1, filledCount: 0, openDate: null }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  it("publish transitions draft -> scheduled when openDate is in the future", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    const future = new Date(Date.now() + 86400000);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Draft", status: "draft", openingsCount: 1, filledCount: 0, openDate: future }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scheduled");
  });

  it("a second publish call flips a scheduled vacancy live (manual operator flip, no background scheduler)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    const future = new Date(Date.now() + 86400000);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Scheduled", status: "scheduled", openingsCount: 1, filledCount: 0, openDate: future }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  it("publish resumes a paused vacancy back to published", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Paused", status: "paused", openingsCount: 1, filledCount: 0, openDate: null }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
  });

  it("rejects publishing an already-published vacancy (concurrent double publish)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Published", status: "published", openingsCount: 1, filledCount: 0, openDate: null }];

    const first = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(400);
  });

  it("pause transitions published -> paused", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Published", status: "published", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/pause").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paused");
  });

  it("rejects pausing a draft vacancy", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Draft", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/pause").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it.each(["draft", "scheduled", "published", "paused"])("close transitions %s -> closed", async (status) => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.close"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "V", status, openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/close").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });

  it("rejects closing an already-closed vacancy (concurrent double close)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.close"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Closed", status: "closed", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/close").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("archive transitions closed -> archived", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.close"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Closed", status: "closed", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/archive").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });

  it("rejects archiving a vacancy that is not closed", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.close"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Published", status: "published", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/archive").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a lifecycle action on a vacancy belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: OTHER_ORG_ID, requisitionId: 1, title: "Theirs", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 403 publishing without vacancy.publish", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.read"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Draft", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/publish").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 closing without vacancy.close", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["vacancy.publish"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.vacancyRows = [{ id: 1, organizationId: ORG_ID, requisitionId: APPROVED_REQUISITION_ID, title: "Draft", status: "draft", openingsCount: 1, filledCount: 0 }];

    const res = await request(app).post("/api/organizations/10/vacancies/1/close").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});
