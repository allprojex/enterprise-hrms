/**
 * Integration tests for the Application Pipeline (Phase 3A, W51), exercising
 * the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. Mirrors vacancies.test.ts's
 * harness style (real field-based filtering, simulated status-guard
 * behavior). No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  employeesTable,
  employeeUserLinksTable,
  applicationsTable,
  applicationStageHistoryTable,
  applicationAnswersTable,
  applicationScoresTable,
  candidatesTable,
  candidateDocumentsTable,
  vacanciesTable,
  vacancyQuestionsTable,
  jobRequisitionsTable,
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
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      applicationRows: [] as Record<string, unknown>[],
      applicationStageHistoryRows: [] as Record<string, unknown>[],
      applicationAnswerRows: [] as Record<string, unknown>[],
      applicationScoreRows: [] as Record<string, unknown>[],
      candidateRows: [] as Record<string, unknown>[],
      candidateDocumentRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      vacancyQuestionRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      recruitmentStageRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "branchId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    applicationsTable: mockTable("applications", [
      "id",
      "organizationId",
      "candidateId",
      "vacancyId",
      "currentStageId",
      "publicId",
      "rejectionReasonCode",
      "withdrawalReasonCode",
      "submittedAt",
    ]),
    applicationStageHistoryTable: mockTable("application_stage_history", ["id", "organizationId", "applicationId", "fromStageId", "toStageId", "movedByMembershipId", "reason", "movedAt"]),
    applicationAnswersTable: mockTable("application_answers", ["id", "organizationId", "applicationId", "vacancyQuestionId", "answerText", "knockoutFailed"]),
    applicationScoresTable: mockTable("application_scores", ["id", "organizationId", "applicationId", "scoredByMembershipId", "scoreType", "score", "notes", "createdAt"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "firstName", "lastName", "email", "phone"]),
    candidateDocumentsTable: mockTable("candidate_documents", ["id", "organizationId", "candidateId", "applicationId", "categoryCode", "fileName", "mimeType", "fileSize", "isActive"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId", "workflowId", "title"]),
    vacancyQuestionsTable: mockTable("vacancy_questions", ["id", "organizationId", "vacancyId", "questionText", "questionType", "isKnockout", "expectedAnswer", "displayOrder", "isActive"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "recruiterEmployeeId", "hiringManagerEmployeeId"]),
    recruitmentStagesTable: mockTable("recruitment_stages", ["id", "organizationId", "workflowId", "name", "category", "displayOrder", "isActive"]),
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
  if (table === applicationStageHistoryTable) return fixtures.applicationStageHistoryRows;
  if (table === applicationAnswersTable) return fixtures.applicationAnswerRows;
  if (table === applicationScoresTable) return fixtures.applicationScoreRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === candidateDocumentsTable) return fixtures.candidateDocumentRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === vacancyQuestionsTable) return fixtures.vacancyQuestionRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === recruitmentStagesTable) return fixtures.recruitmentStageRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === applicationsTable) fixtures.applicationRows = rows;
  else if (table === applicationStageHistoryTable) fixtures.applicationStageHistoryRows = rows;
  else if (table === applicationScoresTable) fixtures.applicationScoreRows = rows;
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  applicationsTable,
  applicationStageHistoryTable,
  applicationAnswersTable,
  applicationScoresTable,
  candidatesTable,
  candidateDocumentsTable,
  vacanciesTable,
  vacancyQuestionsTable,
  jobRequisitionsTable,
  recruitmentStagesTable,
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
const HIRING_MANAGER_EMPLOYEE_ID = 3;

const VACANCY_ID = 100;
const REQUISITION_ID = 200;
const WORKFLOW_ID = 300;
const CANDIDATE_ID = 400;
const APPLICATION_ID = 500;

const STAGE_APPLIED = 1;
const STAGE_SCREENING = 2;
const STAGE_INTERVIEW = 3;
const STAGE_REJECTED = 4;
const STAGE_WITHDRAWN = 5;

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

function seedWorkflowStages() {
  fixtures.recruitmentStageRows = [
    { id: STAGE_APPLIED, organizationId: ORG_ID, workflowId: WORKFLOW_ID, name: "Applied", category: "applied", displayOrder: 0, isActive: true },
    { id: STAGE_SCREENING, organizationId: ORG_ID, workflowId: WORKFLOW_ID, name: "Screening", category: "screening", displayOrder: 1, isActive: true },
    { id: STAGE_INTERVIEW, organizationId: ORG_ID, workflowId: WORKFLOW_ID, name: "Interview", category: "interview", displayOrder: 2, isActive: true },
    { id: STAGE_REJECTED, organizationId: ORG_ID, workflowId: WORKFLOW_ID, name: "Rejected", category: "rejected", displayOrder: 3, isActive: true },
    { id: STAGE_WITHDRAWN, organizationId: ORG_ID, workflowId: WORKFLOW_ID, name: "Withdrawn", category: "withdrawn", displayOrder: 4, isActive: true },
  ];
}

function seedVacancyAndRequisition(overrides: Record<string, unknown> = {}) {
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, recruiterEmployeeId: null, hiringManagerEmployeeId: null }];
  fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID, workflowId: WORKFLOW_ID, title: "Software Engineer", ...overrides }];
}

function seedApplication(overrides: Record<string, unknown> = {}) {
  fixtures.candidateRows = [{ id: CANDIDATE_ID, organizationId: ORG_ID, firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: null }];
  fixtures.applicationRows = [
    { id: APPLICATION_ID, organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, currentStageId: null, publicId: "app-pub-1", rejectionReasonCode: null, withdrawalReasonCode: null, submittedAt: new Date(), ...overrides },
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
  fixtures.applicationRows = [];
  fixtures.applicationStageHistoryRows = [];
  fixtures.applicationAnswerRows = [];
  fixtures.applicationScoreRows = [];
  fixtures.candidateRows = [];
  fixtures.candidateDocumentRows = [];
  fixtures.vacancyRows = [];
  fixtures.vacancyQuestionRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.recruitmentStageRows = [];
  fixtures.idCounters = new Map();
});

describe("GET /api/organizations/:organizationId/applications — visibility", () => {
  it("returns 403 when the recruitment module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read"]);
    mockRecruitmentModuleEnabled(false);

    const res = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 without application.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("an org-wide holder (application.pipeline.move) sees every application in the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read", "application.pipeline.move"]);
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedApplication();

    const res = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ candidateName: "Jane Doe", candidateEmail: "jane@example.com", vacancyTitle: "Software Engineer", currentStageCategory: "applied" });
  });

  it("a caller without org-wide reach sees only applications whose requisition assigns them as recruiter or hiring manager", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read"]);
    mockRecruitmentModuleEnabled(true);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    seedVacancyAndRequisition();
    seedApplication();

    const notAssigned = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(notAssigned.body.total).toBe(0);

    fixtures.jobRequisitionRows[0].recruiterEmployeeId = RECRUITER_EMPLOYEE_ID;
    const assigned = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(assigned.body.total).toBe(1);
  });

  it("does not leak another organization's applications", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read", "application.pipeline.move"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.applicationRows = [{ id: 1, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1, currentStageId: null, publicId: "x", submittedAt: new Date() }];

    const res = await request(app).get("/api/organizations/10/applications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/organizations/:organizationId/applications/:id", () => {
  it("returns 404 for an application that exists but is not visible to this caller", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read"]);
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedApplication();

    const res = await request(app).get(`/api/organizations/10/applications/${APPLICATION_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns full detail including documents and history for a visible application", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read", "application.pipeline.move"]);
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedApplication();
    fixtures.candidateDocumentRows = [{ id: 1, organizationId: ORG_ID, candidateId: CANDIDATE_ID, applicationId: APPLICATION_ID, categoryCode: "resume", fileName: "resume.pdf", mimeType: "application/pdf", fileSize: 1234, isActive: true }];

    const res = await request(app).get(`/api/organizations/10/applications/${APPLICATION_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.history).toEqual([]);
    expect(res.body.answers).toEqual([]);
    expect(res.body.scores).toEqual([]);
    expect(res.body.scoreRollup).toBeNull();
  });

  it("includes screening answers (with question text) and never the internal knockout config on GET detail", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read", "application.pipeline.move"]);
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedApplication();
    fixtures.vacancyQuestionRows = [{ id: 1, organizationId: ORG_ID, vacancyId: VACANCY_ID, questionText: "Authorized to work?", questionType: "yes_no", isKnockout: true, expectedAnswer: "yes", displayOrder: 0, isActive: true }];
    fixtures.applicationAnswerRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, vacancyQuestionId: 1, answerText: "no", knockoutFailed: true }];

    const res = await request(app).get(`/api/organizations/10/applications/${APPLICATION_ID}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.answers).toEqual([{ id: 1, vacancyQuestionId: 1, questionText: "Authorized to work?", answerText: "no", knockoutFailed: true, createdAt: undefined }]);
  });

  it("returns 404 for an application belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["application.read", "application.pipeline.move"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.applicationRows = [{ id: 1, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1, currentStageId: null, publicId: "x", submittedAt: new Date() }];

    const res = await request(app).get("/api/organizations/10/applications/1").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/applications/:id/move-stage", () => {
  beforeEach(() => {
    mockSession();
    mockActiveMembership();
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedWorkflowStages();
    seedApplication();
  });

  it("returns 403 without application.pipeline.move", async () => {
    mockPermissions(["application.read"]);
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_SCREENING });
    expect(res.status).toBe(403);
  });

  it("moves a never-triaged application (currentStageId null) into a stage, recording fromStageId null in history", async () => {
    mockPermissions(["application.pipeline.move"]);
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_SCREENING });
    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(STAGE_SCREENING);
    expect(fixtures.applicationStageHistoryRows).toHaveLength(1);
    expect(fixtures.applicationStageHistoryRows[0]).toMatchObject({ fromStageId: null, toStageId: STAGE_SCREENING });
  });

  it("supports regression to an earlier stage", async () => {
    mockPermissions(["application.pipeline.move"]);
    fixtures.applicationRows[0].currentStageId = STAGE_INTERVIEW;
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_SCREENING });
    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(STAGE_SCREENING);
  });

  it("rejects moving into a terminal-category stage directly (must use reject/withdraw)", async () => {
    mockPermissions(["application.pipeline.move"]);
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_REJECTED });
    expect(res.status).toBe(400);
  });

  it("rejects moving an application that is already in a terminal stage", async () => {
    mockPermissions(["application.pipeline.move"]);
    fixtures.applicationRows[0].currentStageId = STAGE_REJECTED;
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_SCREENING });
    expect(res.status).toBe(400);
  });

  it("rejects a target stage that does not belong to the vacancy's workflow", async () => {
    mockPermissions(["application.pipeline.move"]);
    fixtures.recruitmentStageRows.push({ id: 999, organizationId: ORG_ID, workflowId: 999999, name: "Other Workflow Stage", category: "screening", displayOrder: 0, isActive: true });
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/move-stage`).set("Authorization", "Bearer valid-token").send({ toStageId: 999 });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a move-stage action on an application belonging to a different organization", async () => {
    mockPermissions(["application.pipeline.move"]);
    fixtures.applicationRows = [{ id: 1, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1, currentStageId: null, publicId: "x", submittedAt: new Date() }];
    const res = await request(app).post("/api/organizations/10/applications/1/move-stage").set("Authorization", "Bearer valid-token").send({ toStageId: STAGE_SCREENING });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/applications/:id/reject", () => {
  beforeEach(() => {
    mockSession();
    mockActiveMembership();
    mockRecruitmentModuleEnabled(true);
    mockPermissions(["application.pipeline.move"]);
    seedVacancyAndRequisition();
    seedWorkflowStages();
    seedApplication();
  });

  it("rejects the application, resolving the workflow's rejected-category stage and setting rejectionReasonCode", async () => {
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reject`).set("Authorization", "Bearer valid-token").send({ reasonCode: "not_qualified", comment: "Missing required experience" });
    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(STAGE_REJECTED);
    expect(res.body.rejectionReasonCode).toBe("not_qualified");
    expect(fixtures.applicationStageHistoryRows[0]).toMatchObject({ reason: "Missing required experience" });
  });

  it("returns 400 when the workflow has no rejected-category stage configured", async () => {
    fixtures.recruitmentStageRows = fixtures.recruitmentStageRows.filter((s) => s.category !== "rejected");
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reject`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 rejecting an already-terminal application (double reject)", async () => {
    const first = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reject`).set("Authorization", "Bearer valid-token").send({});
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reject`).set("Authorization", "Bearer valid-token").send({});
    expect(second.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/applications/:id/withdraw", () => {
  beforeEach(() => {
    mockSession();
    mockActiveMembership();
    mockRecruitmentModuleEnabled(true);
    mockPermissions(["application.pipeline.move"]);
    seedVacancyAndRequisition();
    seedWorkflowStages();
    seedApplication();
  });

  it("withdraws the application, resolving the workflow's withdrawn-category stage", async () => {
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/withdraw`).set("Authorization", "Bearer valid-token").send({ reasonCode: "accepted_elsewhere" });
    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(STAGE_WITHDRAWN);
    expect(res.body.withdrawalReasonCode).toBe("accepted_elsewhere");
  });
});

describe("POST /api/organizations/:organizationId/applications/:id/reopen", () => {
  beforeEach(() => {
    mockSession();
    mockActiveMembership();
    mockRecruitmentModuleEnabled(true);
    mockPermissions(["application.pipeline.move"]);
    seedVacancyAndRequisition();
    seedWorkflowStages();
    seedApplication({ currentStageId: STAGE_REJECTED, rejectionReasonCode: "not_qualified" });
  });

  it("reopens a rejected application back to the applied-category stage, clearing the rejection reason", async () => {
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reopen`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(200);
    expect(res.body.currentStageId).toBe(STAGE_APPLIED);
    expect(res.body.rejectionReasonCode).toBeNull();
  });

  it("returns 400 reopening an application that is not currently terminal", async () => {
    fixtures.applicationRows[0].currentStageId = STAGE_SCREENING;
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reopen`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when the workflow has no applied-category stage configured", async () => {
    fixtures.recruitmentStageRows = fixtures.recruitmentStageRows.filter((s) => s.category !== "applied");
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/reopen`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/applications/:id/scores", () => {
  beforeEach(() => {
    mockSession();
    mockActiveMembership();
    mockRecruitmentModuleEnabled(true);
    seedVacancyAndRequisition();
    seedApplication();
  });

  it("returns 403 without application.manage", async () => {
    mockPermissions(["application.read", "application.pipeline.move"]);
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "screening", score: 8 });
    expect(res.status).toBe(403);
  });

  it("submits a score entry and returns the refreshed detail with a computed rollup, never writing applications.score", async () => {
    mockPermissions(["application.manage"]);
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "screening", score: 8, notes: "Strong candidate" });
    expect(res.status).toBe(201);
    expect(res.body.scores).toHaveLength(1);
    expect(res.body.scores[0]).toMatchObject({ scoreType: "screening", notes: "Strong candidate" });
    expect(res.body.scoreRollup).toBe(8);
    expect(fixtures.applicationRows[0].score).toBeUndefined(); // applications.score is never written (§12)
  });

  it("an explicit overall score wins the rollup outright over screening/interview averages", async () => {
    mockPermissions(["application.manage"]);
    await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "screening", score: 6 });
    await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "interview", score: 8 });
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "overall", score: 9 });
    expect(res.status).toBe(201);
    expect(res.body.scoreRollup).toBe(9);
  });

  it("averages the latest screening and interview scores when no overall entry exists", async () => {
    mockPermissions(["application.manage"]);
    await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "screening", score: 6 });
    const res = await request(app).post(`/api/organizations/10/applications/${APPLICATION_ID}/scores`).set("Authorization", "Bearer valid-token").send({ scoreType: "interview", score: 10 });
    expect(res.status).toBe(201);
    expect(res.body.scoreRollup).toBe(8);
  });

  it("returns 404 for a score submission on an application belonging to a different organization", async () => {
    mockPermissions(["application.manage"]);
    fixtures.applicationRows = [{ id: 1, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1, currentStageId: null, publicId: "x", submittedAt: new Date() }];
    const res = await request(app).post("/api/organizations/10/applications/1/scores").set("Authorization", "Bearer valid-token").send({ scoreType: "screening", score: 5 });
    expect(res.status).toBe(404);
  });
});
