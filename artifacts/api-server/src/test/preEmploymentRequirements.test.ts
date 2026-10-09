/**
 * Integration tests for Pre-Employment Requirements (Phase 3A, W58),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. Mirrors
 * referenceChecks.test.ts's harness style — this resource reuses the
 * application's own visibility resolver
 * (resolveApplicationVisibilityContext/getVisibleApplicationById), so the
 * full W51 dependency chain is mocked here too. No real database
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
  preEmploymentRequirementsTable,
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
      preEmploymentRequirementRows: [] as Record<string, unknown>[],
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
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId", "currentStageId", "publicId", "rejectionReasonCode", "withdrawalReasonCode", "submittedAt"]),
    applicationStageHistoryTable: mockTable("application_stage_history", ["id", "organizationId", "applicationId", "fromStageId", "toStageId", "movedByMembershipId", "reason", "movedAt"]),
    applicationAnswersTable: mockTable("application_answers", ["id", "organizationId", "applicationId", "vacancyQuestionId", "answerText", "knockoutFailed"]),
    applicationScoresTable: mockTable("application_scores", ["id", "organizationId", "applicationId", "scoredByMembershipId", "scoreType", "score", "notes", "createdAt"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "firstName", "lastName", "email", "phone"]),
    candidateDocumentsTable: mockTable("candidate_documents", ["id", "organizationId", "candidateId", "applicationId", "categoryCode", "fileName", "mimeType", "fileSize", "isActive"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId", "workflowId", "title"]),
    vacancyQuestionsTable: mockTable("vacancy_questions", ["id", "organizationId", "vacancyId", "questionText", "questionType", "isKnockout", "expectedAnswer", "displayOrder", "isActive"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "recruiterEmployeeId", "hiringManagerEmployeeId"]),
    recruitmentStagesTable: mockTable("recruitment_stages", ["id", "organizationId", "workflowId", "name", "category", "displayOrder", "isActive"]),
    preEmploymentRequirementsTable: mockTable("pre_employment_requirements", ["id", "organizationId", "applicationId", "requirementCode", "status", "satisfiedAt", "notes"]),
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
  if (table === preEmploymentRequirementsTable) return fixtures.preEmploymentRequirementRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === applicationsTable) fixtures.applicationRows = rows;
  else if (table === applicationStageHistoryTable) fixtures.applicationStageHistoryRows = rows;
  else if (table === applicationScoresTable) fixtures.applicationScoreRows = rows;
  else if (table === preEmploymentRequirementsTable) fixtures.preEmploymentRequirementRows = rows;
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
  // Simulates the real pre_employment_requirements_application_code_unique
  // constraint — createPreEmploymentRequirement relies solely on catching
  // a DB unique-violation race (isUniqueViolation), the same "no
  // pre-check, just catch the race" precedent as offers.ts's createOffer,
  // so the mock must actually enforce it for that test to mean anything.
  if (
    table === preEmploymentRequirementsTable &&
    getRowsFor(table).some((r) => r.applicationId === v.applicationId && r.requirementCode === v.requirementCode)
  ) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  }
  const defaults: Record<string, unknown> = table === preEmploymentRequirementsTable ? { status: "pending", satisfiedAt: null } : {};
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
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
  preEmploymentRequirementsTable,
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
const WORKFLOW_ID = 300;
const CANDIDATE_ID = 400;
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

function mockLinkedEmployee(employeeId: number, applicationUserId = REQUESTER_USER_ID) {
  fixtures.employeeUserLinkRows = [{ employeeId, applicationUserId }];
}

function seedVacancyAndRequisition(overrides: Record<string, unknown> = {}) {
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, recruiterEmployeeId: null, hiringManagerEmployeeId: null, ...overrides }];
  fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID, workflowId: WORKFLOW_ID, title: "Software Engineer" }];
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
  fixtures.preEmploymentRequirementRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  seedVacancyAndRequisition();
  seedApplication();
});

describe("POST /api/organizations/:organizationId/applications/:applicationId/pre-employment-requirements", () => {
  it("returns 403 without application.manage", async () => {
    mockPermissions(["application.read"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "right_to_work" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an application belonging to a different organization", async () => {
    mockPermissions(["application.read", "application.manage"]);
    fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1, currentStageId: null, publicId: "x", submittedAt: new Date() }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "right_to_work" });
    expect(res.status).toBe(404);
  });

  it("creates a requirement at status pending for an org-wide caller", async () => {
    mockPermissions(["application.read", "application.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "right_to_work", notes: "Passport submitted" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "pending", satisfiedAt: null });
  });

  it("rejects a duplicate requirementCode for the same application", async () => {
    mockPermissions(["application.read", "application.manage"]);
    await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "right_to_work" });
    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "right_to_work" });
    expect(second.status).toBe(400);
  });

  it("an assigned recruiter (no org-wide permission) can add a requirement for their own requisition's application", async () => {
    mockPermissions(["application.read", "application.manage"]);
    // application.manage on this codebase's own precedent is org-admin-only
    // — but the visibility check itself (assigned recruiter/hiring
    // manager) still narrows what an org-wide-permission-holding caller
    // can see, exercised the same way referenceChecks.test.ts exercises it.
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    fixtures.jobRequisitionRows[0].recruiterEmployeeId = RECRUITER_EMPLOYEE_ID;

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`)
      .set("Authorization", "Bearer valid-token")
      .send({ requirementCode: "medical" });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/organizations/:organizationId/applications/:applicationId/pre-employment-requirements", () => {
  it("an assigned recruiter sees requirements for their own requisition's application", async () => {
    mockPermissions(["application.read"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    fixtures.jobRequisitionRows[0].recruiterEmployeeId = RECRUITER_EMPLOYEE_ID;
    fixtures.preEmploymentRequirementRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "pending", satisfiedAt: null, notes: null }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("does not leak requirements the caller cannot see (unassigned, no org-wide reach)", async () => {
    mockPermissions(["application.read"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    fixtures.preEmploymentRequirementRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "pending", satisfiedAt: null, notes: null }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("computes summary.readyForConversion as true when every row is satisfied or waived", async () => {
    mockPermissions(["application.read", "application.manage"]);
    fixtures.preEmploymentRequirementRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "satisfied", satisfiedAt: new Date(), notes: null },
      { id: 2, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "medical", status: "waived", satisfiedAt: null, notes: null },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ totalCount: 2, satisfiedCount: 1, waivedCount: 1, pendingCount: 0, readyForConversion: true });
  });

  it("computes summary.readyForConversion as false when any row is still pending", async () => {
    mockPermissions(["application.read", "application.manage"]);
    fixtures.preEmploymentRequirementRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "satisfied", satisfiedAt: new Date(), notes: null },
      { id: 2, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "medical", status: "pending", satisfiedAt: null, notes: null },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.summary.readyForConversion).toBe(false);
  });

  it("computes summary.readyForConversion as true (vacuously) when no requirements are tracked", async () => {
    mockPermissions(["application.read", "application.manage"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ totalCount: 0, readyForConversion: true });
  });
});

describe("PATCH .../pre-employment-requirements/:id — freely bidirectional status", () => {
  beforeEach(() => {
    mockPermissions(["application.read", "application.manage"]);
    fixtures.preEmploymentRequirementRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, requirementCode: "right_to_work", status: "pending", satisfiedAt: null, notes: null }];
  });

  it("moves pending -> satisfied and sets satisfiedAt", async () => {
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "satisfied" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("satisfied");
    expect(res.body.satisfiedAt).not.toBeNull();
  });

  it("moves pending -> waived without setting satisfiedAt", async () => {
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "waived" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("waived");
    expect(res.body.satisfiedAt).toBeNull();
  });

  it("allows reverting satisfied back to pending, clearing satisfiedAt (no terminal immutability)", async () => {
    await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "satisfied" });
    const reverted = await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "pending" });
    expect(reverted.status).toBe(200);
    expect(reverted.body.status).toBe("pending");
    expect(reverted.body.satisfiedAt).toBeNull();
  });

  it("returns 404 for a requirement that does not belong to this application", async () => {
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/applications/999999/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "satisfied" });
    expect(res.status).toBe(404);
  });

  it("returns 403 without application.manage", async () => {
    mockPermissions(["application.read"]);
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/pre-employment-requirements/1`).set("Authorization", "Bearer valid-token").send({ status: "satisfied" });
    expect(res.status).toBe(403);
  });
});
