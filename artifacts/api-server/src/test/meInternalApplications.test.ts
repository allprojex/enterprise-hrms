/**
 * Integration tests for Employee Self-Service Internal Applications
 * (Phase 3A, W60): GET /me/internal-vacancies, POST
 * /me/internal-vacancies/:publicId/apply, GET /me/applications. Mirrors
 * meEmployee.test.ts's harness style (real field-based filtering, an
 * unfiltered passthrough for modules/organizationModules per
 * getModuleAccess's own join shape), extended with the vacancy/candidate/
 * application chain and a real `db.transaction` mock (submitInternalApplication
 * writes candidates/applications/applicationAnswers atomically). No real
 * database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  vacanciesTable,
  vacancyQuestionsTable,
  jobRequisitionsTable,
  departmentsTable,
  candidatesTable,
  applicationsTable,
  applicationAnswersTable,
  recruitmentStagesTable,
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
      membershipRows: [] as Record<string, unknown>[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      vacancyQuestionRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      candidateRows: [] as Record<string, unknown>[],
      applicationRows: [] as Record<string, unknown>[],
      applicationAnswerRows: [] as Record<string, unknown>[],
      recruitmentStageRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status", "expiresAt"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "workEmail", "personalEmail", "phoneNumber", "employmentStatus"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId", "publicId", "title", "visibility", "status", "openingsCount", "openDate", "closeDate", "jobDescription", "responsibilities", "requirements", "preferredQualifications"]),
    vacancyQuestionsTable: mockTable("vacancy_questions", ["id", "organizationId", "vacancyId", "questionText", "questionType", "isKnockout", "expectedAnswer", "displayOrder", "isActive"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "departmentId", "employmentType", "workplaceType"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "email", "firstName", "lastName", "phone", "linkedInternalEmployeeId"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId", "currentStageId", "publicId", "source", "submittedAt"]),
    applicationAnswersTable: mockTable("application_answers", ["id", "organizationId", "applicationId", "vacancyQuestionId", "answerText", "knockoutFailed"]),
    recruitmentStagesTable: mockTable("recruitment_stages", ["id", "organizationId", "category"]),
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
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === employeeUserLinksTable) return fixtures.employeeUserLinkRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === vacancyQuestionsTable) return fixtures.vacancyQuestionRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === applicationAnswersTable) return fixtures.applicationAnswerRows;
  if (table === recruitmentStagesTable) return fixtures.recruitmentStageRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === candidatesTable) fixtures.candidateRows = rows;
  else if (table === applicationsTable) fixtures.applicationRows = rows;
  else if (table === applicationAnswersTable) fixtures.applicationAnswerRows = rows;
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

  // modules/organizationModules mirror meEmployee.test.ts's precedent —
  // getModuleAccess joins these two directly, an unfiltered passthrough is
  // correct for single-organization tests.
  const unfiltered = table === modulesTable ? fixtures.moduleRows : table === organizationModulesTable ? fixtures.organizationModuleRows : undefined;
  if (unfiltered !== undefined) {
    const rows = unfiltered as unknown[];
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
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
  // Simulates the real applications_candidate_vacancy_unique constraint —
  // submitInternalApplication relies on a pre-check (mirrors
  // submitPublicApplication's own "select existing, else insert" shape,
  // not a catch-the-race), but this guards against a test accidentally
  // double-inserting.
  if (table === applicationsTable && getRowsFor(table).some((r) => r.candidateId === v.candidateId && r.vacancyId === v.vacancyId)) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  }
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), submittedAt: new Date(), ...v };
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
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  vacanciesTable,
  vacancyQuestionsTable,
  jobRequisitionsTable,
  departmentsTable,
  candidatesTable,
  applicationsTable,
  applicationAnswersTable,
  recruitmentStagesTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      const snapshot = { candidateRows: fixtures.candidateRows, applicationRows: fixtures.applicationRows, applicationAnswerRows: fixtures.applicationAnswerRows };
      try {
        return await cb(makeQueryClient());
      } catch (err) {
        fixtures.candidateRows = snapshot.candidateRows;
        fixtures.applicationRows = snapshot.applicationRows;
        fixtures.applicationAnswerRows = snapshot.applicationAnswerRows;
        throw err;
      }
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const EMPLOYEE_ID = 42;
const REQUISITION_ID = 200;
const VACANCY_ID = 300;

function mockSession(userId = 1, activeOrganizationId: number | null = ORG_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000), activeOrganizationId },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: activeOrganizationId, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId, status: "active", expiresAt: null }];
}

function mockModulesEnabled(ess: boolean, recruitment: boolean) {
  fixtures.moduleRows = [
    { id: 1, key: "employee_self_service", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] },
    { id: 2, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] },
  ];
  fixtures.organizationModuleRows = [
    ...(ess ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : []),
    ...(recruitment ? [{ id: 2, organizationId: ORG_ID, moduleId: 2, enabled: true }] : []),
  ];
}

function mockLinkedEmployee(overrides: Record<string, unknown> = {}) {
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
  fixtures.employeeRows = [
    {
      id: EMPLOYEE_ID,
      organizationId: ORG_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      workEmail: "ada@work.example.com",
      personalEmail: "ada@example.com",
      phoneNumber: "555-1234",
      employmentStatus: "active",
      ...overrides,
    },
  ];
}

function seedInternalVacancy(overrides: Record<string, unknown> = {}) {
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, departmentId: null, employmentType: "full_time", workplaceType: "onsite" }];
  fixtures.vacancyRows = [
    {
      id: VACANCY_ID,
      organizationId: ORG_ID,
      requisitionId: REQUISITION_ID,
      publicId: "vac-pub-1",
      title: "Internal Analyst",
      visibility: "internal",
      status: "published",
      openingsCount: 1,
      openDate: null,
      closeDate: null,
      jobDescription: "Analyze things",
      responsibilities: null,
      requirements: null,
      preferredQualifications: null,
      ...overrides,
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.vacancyRows = [];
  fixtures.vacancyQuestionRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.departmentRows = [];
  fixtures.candidateRows = [];
  fixtures.applicationRows = [];
  fixtures.applicationAnswerRows = [];
  fixtures.recruitmentStageRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockModulesEnabled(true, true);
});

describe("GET /api/me/internal-vacancies", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/me/internal-vacancies");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the recruitment module is disabled", async () => {
    mockModulesEnabled(true, false);
    mockLinkedEmployee();
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 when the employee_self_service module is disabled", async () => {
    mockModulesEnabled(false, true);
    mockLinkedEmployee();
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns linked:false, items:[] for an unlinked user — not an error", async () => {
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, active: false, items: [] });
  });

  it("returns linked:true, active:false, items:[] for a linked but non-active employee", async () => {
    mockLinkedEmployee({ employmentStatus: "terminated" });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, active: false, items: [] });
  });

  it("lists a published, internally-visible vacancy within its open window", async () => {
    mockLinkedEmployee();
    seedInternalVacancy();
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.active).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ publicId: "vac-pub-1", title: "Internal Analyst" });
  });

  it("excludes an external-only vacancy", async () => {
    mockLinkedEmployee();
    seedInternalVacancy({ visibility: "external" });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.body.items).toHaveLength(0);
  });

  it("excludes a draft (unpublished) vacancy", async () => {
    mockLinkedEmployee();
    seedInternalVacancy({ status: "draft" });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.body.items).toHaveLength(0);
  });

  it("excludes a vacancy whose openDate is in the future", async () => {
    mockLinkedEmployee();
    seedInternalVacancy({ openDate: new Date(Date.now() + 86400000) });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.body.items).toHaveLength(0);
  });

  it("excludes a vacancy whose closeDate has passed", async () => {
    mockLinkedEmployee();
    seedInternalVacancy({ closeDate: new Date(Date.now() - 86400000) });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.body.items).toHaveLength(0);
  });

  it("includes a 'both' visibility vacancy (internal and external)", async () => {
    mockLinkedEmployee();
    seedInternalVacancy({ visibility: "both" });
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    expect(res.body.items).toHaveLength(1);
  });

  it("never leaks requisition/recruiter detail in the DTO", async () => {
    mockLinkedEmployee();
    seedInternalVacancy();
    const res = await request(app).get("/api/me/internal-vacancies").set("Authorization", "Bearer valid-token");
    const item = res.body.items[0];
    expect(item).not.toHaveProperty("requisitionId");
    expect(item).not.toHaveProperty("recruiterEmployeeId");
    expect(item).not.toHaveProperty("hiringManagerEmployeeId");
  });
});

describe("POST /api/me/internal-vacancies/:publicId/apply", () => {
  beforeEach(() => {
    mockLinkedEmployee();
    seedInternalVacancy();
  });

  it("returns 403 for an unlinked user", async () => {
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [];
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-active employee", async () => {
    mockLinkedEmployee({ employmentStatus: "suspended" });
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for a vacancy that doesn't exist", async () => {
    const res = await request(app).post(`/api/me/internal-vacancies/does-not-exist/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an external-only vacancy (not internally eligible)", async () => {
    seedInternalVacancy({ visibility: "external" });
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("creates a candidate (resolved by employee email), links it, and files a new application marked source internal_ess", async () => {
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ isNew: true, status: "submitted" });
    expect(fixtures.candidateRows).toHaveLength(1);
    expect(fixtures.candidateRows[0]).toMatchObject({ email: "ada@work.example.com", linkedInternalEmployeeId: EMPLOYEE_ID });
    expect(fixtures.applicationRows[0]).toMatchObject({ candidateId: fixtures.candidateRows[0].id, vacancyId: VACANCY_ID, source: "internal_ess" });
  });

  it("is idempotent — a repeat submission returns the existing application, not a second one", async () => {
    const first = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(first.body.isNew).toBe(true);

    const second = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(201);
    expect(second.body.isNew).toBe(false);
    expect(second.body.id).toBe(first.body.id);
    expect(fixtures.applicationRows).toHaveLength(1);
  });

  it("reuses an existing candidate already linked via linkedInternalEmployeeId (e.g. hired through external recruitment)", async () => {
    fixtures.candidateRows = [{ id: 900, organizationId: ORG_ID, email: "old-external-address@example.com", firstName: "Ada", lastName: "Lovelace", phone: null, linkedInternalEmployeeId: EMPLOYEE_ID }];
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(fixtures.candidateRows).toHaveLength(1);
    expect(fixtures.applicationRows[0].candidateId).toBe(900);
  });

  it("captures optional screening answers, silently ignoring an answer for a question that doesn't belong to this vacancy", async () => {
    fixtures.vacancyQuestionRows = [{ id: 1, organizationId: ORG_ID, vacancyId: VACANCY_ID, questionText: "Years of experience?", questionType: "numeric", isKnockout: false, expectedAnswer: null, displayOrder: 0, isActive: true }];
    const res = await request(app)
      .post(`/api/me/internal-vacancies/vac-pub-1/apply`)
      .set("Authorization", "Bearer valid-token")
      .send({ answers: [{ vacancyQuestionId: 1, answerText: "5" }, { vacancyQuestionId: 999, answerText: "ignored" }] });
    expect(res.status).toBe(201);
    expect(fixtures.applicationAnswerRows).toHaveLength(1);
    expect(fixtures.applicationAnswerRows[0]).toMatchObject({ vacancyQuestionId: 1, answerText: "5" });
  });

  it("does not invoke employee conversion — no candidate_employee_links / employees insert beyond the pre-existing employee row", async () => {
    const res = await request(app).post(`/api/me/internal-vacancies/vac-pub-1/apply`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(fixtures.employeeRows).toHaveLength(1);
    expect(fixtures.employeeRows[0].id).toBe(EMPLOYEE_ID);
  });
});

describe("GET /api/me/applications", () => {
  it("returns linked:false, items:[] for an unlinked user", async () => {
    const res = await request(app).get("/api/me/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, active: false, items: [] });
  });

  it("returns only the caller's own applications, never another employee's", async () => {
    mockLinkedEmployee();
    fixtures.candidateRows = [
      { id: 1, organizationId: ORG_ID, email: "ada@work.example.com", firstName: "Ada", lastName: "Lovelace", phone: null, linkedInternalEmployeeId: EMPLOYEE_ID },
      { id: 2, organizationId: ORG_ID, email: "other@work.example.com", firstName: "Other", lastName: "Person", phone: null, linkedInternalEmployeeId: 999 },
    ];
    fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID, publicId: "vac-pub-1", title: "Internal Analyst", visibility: "internal", status: "published", openingsCount: 1, openDate: null, closeDate: null, jobDescription: null, responsibilities: null, requirements: null, preferredQualifications: null }];
    fixtures.applicationRows = [
      { id: 10, organizationId: ORG_ID, candidateId: 1, vacancyId: VACANCY_ID, currentStageId: null, publicId: "app-1", source: "internal_ess", submittedAt: new Date() },
      { id: 11, organizationId: ORG_ID, candidateId: 2, vacancyId: VACANCY_ID, currentStageId: null, publicId: "app-2", source: "internal_ess", submittedAt: new Date() },
    ];

    const res = await request(app).get("/api/me/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(10);
  });

  it("derives currentStageCategory from the linked stage, defaulting to 'applied' when null", async () => {
    mockLinkedEmployee();
    fixtures.candidateRows = [{ id: 1, organizationId: ORG_ID, email: "ada@work.example.com", firstName: "Ada", lastName: "Lovelace", phone: null, linkedInternalEmployeeId: EMPLOYEE_ID }];
    fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID, publicId: "vac-pub-1", title: "Internal Analyst", visibility: "internal", status: "published", openingsCount: 1, openDate: null, closeDate: null, jobDescription: null, responsibilities: null, requirements: null, preferredQualifications: null }];
    fixtures.applicationRows = [{ id: 10, organizationId: ORG_ID, candidateId: 1, vacancyId: VACANCY_ID, currentStageId: null, publicId: "app-1", source: "internal_ess", submittedAt: new Date() }];

    const res = await request(app).get("/api/me/applications").set("Authorization", "Bearer valid-token");
    expect(res.body.items[0].currentStageCategory).toBe("applied");
  });

  it("never leaks scores, interview, or offer detail in the DTO", async () => {
    mockLinkedEmployee();
    fixtures.candidateRows = [{ id: 1, organizationId: ORG_ID, email: "ada@work.example.com", firstName: "Ada", lastName: "Lovelace", phone: null, linkedInternalEmployeeId: EMPLOYEE_ID }];
    fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID, publicId: "vac-pub-1", title: "Internal Analyst", visibility: "internal", status: "published", openingsCount: 1, openDate: null, closeDate: null, jobDescription: null, responsibilities: null, requirements: null, preferredQualifications: null }];
    fixtures.applicationRows = [{ id: 10, organizationId: ORG_ID, candidateId: 1, vacancyId: VACANCY_ID, currentStageId: null, publicId: "app-1", source: "internal_ess", submittedAt: new Date() }];

    const res = await request(app).get("/api/me/applications").set("Authorization", "Bearer valid-token");
    const item = res.body.items[0];
    expect(item).not.toHaveProperty("score");
    expect(item).not.toHaveProperty("candidateId");
    expect(item).not.toHaveProperty("publicId");
  });
});
