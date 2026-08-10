/**
 * Integration tests for Recruitment Dashboard & Reporting (Phase 3A, W61),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest, mirroring
 * preEmploymentRequirements.test.ts's harness style. Read-only feature — no
 * insert/update mocking is needed, only select/where/limit. No real
 * database connection is made.
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
  applicationsTable,
  applicationStageHistoryTable,
  recruitmentStagesTable,
  requisitionApprovalsTable,
  interviewsTable,
  offersTable,
  offerVersionsTable,
  reportsTable,
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
      applicationRows: [] as Record<string, unknown>[],
      applicationStageHistoryRows: [] as Record<string, unknown>[],
      recruitmentStageRows: [] as Record<string, unknown>[],
      requisitionApprovalRows: [] as Record<string, unknown>[],
      interviewRows: [] as Record<string, unknown>[],
      offerRows: [] as Record<string, unknown>[],
      offerVersionRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "title", "status", "recruiterEmployeeId", "hiringManagerEmployeeId", "updatedAt"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId", "title", "status"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "vacancyId", "currentStageId", "source", "rejectionReasonCode", "submittedAt"]),
    applicationStageHistoryTable: mockTable("application_stage_history", ["id", "applicationId", "fromStageId", "toStageId", "movedAt"]),
    recruitmentStagesTable: mockTable("recruitment_stages", ["id", "organizationId", "name", "category"]),
    requisitionApprovalsTable: mockTable("requisition_approvals", ["id", "requisitionId", "decision", "decidedAt"]),
    interviewsTable: mockTable("interviews", ["id", "applicationId"]),
    offersTable: mockTable("offers", ["id", "applicationId"]),
    offerVersionsTable: mockTable("offer_versions", ["id", "offerId", "status"]),
    reportsTable: mockTable("reports", ["id", "key", "label", "description", "category", "requiredPermissionKey"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === employeeUserLinksTable) return fixtures.employeeUserLinkRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === applicationStageHistoryTable) return fixtures.applicationStageHistoryRows;
  if (table === recruitmentStagesTable) return fixtures.recruitmentStageRows;
  if (table === requisitionApprovalsTable) return fixtures.requisitionApprovalRows;
  if (table === interviewsTable) return fixtures.interviewRows;
  if (table === offersTable) return fixtures.offerRows;
  if (table === offerVersionsTable) return fixtures.offerVersionRows;
  if (table === reportsTable) return fixtures.reportRows;
  return [];
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

function makeQueryClient() {
  return {
    select: (_sel?: unknown) => ({ from: (table: { __name: string }) => selectBuilder(table) }),
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
  applicationsTable,
  applicationStageHistoryTable,
  recruitmentStagesTable,
  requisitionApprovalsTable,
  interviewsTable,
  offersTable,
  offerVersionsTable,
  reportsTable,
  auditEventsTable,
  db: makeQueryClient(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
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
const OTHER_RECRUITER_EMPLOYEE_ID = 3;

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

function seedRecruitmentReports() {
  fixtures.reportRows = [
    { id: 1, key: "recruitment_rejection_reasons", label: "Rejection Reason Breakdown", description: "desc", category: "recruitment", requiredPermissionKey: "recruitment.reports.read" },
    { id: 2, key: "recruitment_interview_to_offer_ratio", label: "Interview-to-Offer Ratio", description: "desc", category: "recruitment", requiredPermissionKey: "recruitment.reports.read" },
    { id: 3, key: "recruitment_time_to_fill", label: "Time to Fill", description: "desc", category: "recruitment", requiredPermissionKey: "recruitment.reports.read" },
    { id: 4, key: "headcount", label: "Headcount", description: "desc", category: "workforce", requiredPermissionKey: "employee.read" },
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
  fixtures.applicationRows = [];
  fixtures.applicationStageHistoryRows = [];
  fixtures.recruitmentStageRows = [];
  fixtures.requisitionApprovalRows = [];
  fixtures.interviewRows = [];
  fixtures.offerRows = [];
  fixtures.offerVersionRows = [];
  fixtures.reportRows = [];

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  mockPermissions(["recruitment.reports.read"]);
  seedRecruitmentReports();
});

describe("GET /api/organizations/:organizationId/recruitment/dashboard", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`);
    expect(res.status).toBe(401);
  });

  it("returns 403 without recruitment.reports.read", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 when the recruitment module is disabled", async () => {
    mockRecruitmentModuleEnabled(false);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns real zeros (not an error) for an org with recruitment enabled but no data yet", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      openRequisitionsCount: 0,
      openVacanciesCount: 0,
      totalApplicantsCount: 0,
      candidatesByStage: [],
      recruiterWorkload: [],
      hiringManagerWorkload: [],
    });
  });

  it("org-wide caller (requisition.update) sees every requisition/vacancy/applicant across the organization", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    fixtures.jobRequisitionRows = [
      { id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
      { id: 101, organizationId: ORG_ID, title: "Nurse", status: "approved", recruiterEmployeeId: OTHER_RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
      { id: 102, organizationId: OTHER_ORG_ID, title: "Cross-org", status: "approved", recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
    ];
    fixtures.vacancyRows = [
      { id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Engineer Vacancy", status: "published" },
      { id: 201, organizationId: ORG_ID, requisitionId: 101, title: "Nurse Vacancy", status: "draft" },
    ];
    fixtures.applicationRows = [{ id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() }];
    fixtures.employeeRows = [
      { id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Recruiter" },
      { id: OTHER_RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Kofi", lastName: "Recruiter" },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.openRequisitionsCount).toBe(2);
    expect(res.body.openVacanciesCount).toBe(1);
    expect(res.body.totalApplicantsCount).toBe(1);
    expect(res.body.recruiterWorkload).toHaveLength(2);
  });

  it("an assigned recruiter with no org-wide permission sees only their own workload/pipeline scope, never another org member's", async () => {
    // recruitment.reports.read is broadly seeded (like every other
    // Recruitment read permission) — holding it alone must never yield
    // organization-wide analytics for a caller without requisition.update.
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Recruiter" }];
    fixtures.jobRequisitionRows = [
      { id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
      { id: 101, organizationId: ORG_ID, title: "Nurse", status: "approved", recruiterEmployeeId: OTHER_RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
    ];
    fixtures.vacancyRows = [
      { id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Engineer Vacancy", status: "published" },
      { id: 201, organizationId: ORG_ID, requisitionId: 101, title: "Nurse Vacancy", status: "published" },
    ];
    fixtures.applicationRows = [
      { id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() },
      { id: 301, organizationId: ORG_ID, vacancyId: 201, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.openRequisitionsCount).toBe(1);
    expect(res.body.openVacanciesCount).toBe(1);
    expect(res.body.totalApplicantsCount).toBe(1);
    expect(res.body.recruiterWorkload).toEqual([{ employeeId: RECRUITER_EMPLOYEE_ID, employeeName: "Ama Recruiter", openRequisitionsCount: 1 }]);
  });

  it("a caller with recruitment.reports.read but no linked employee and no org-wide reach sees an empty (not error) scope", async () => {
    fixtures.jobRequisitionRows = [{ id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: OTHER_RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.openRequisitionsCount).toBe(0);
  });

  it("candidatesByStage buckets a never-triaged application as 'applied' (unstaged), never as an error", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    fixtures.jobRequisitionRows = [{ id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null, updatedAt: new Date() }];
    fixtures.vacancyRows = [{ id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Engineer Vacancy", status: "published" }];
    fixtures.applicationRows = [{ id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/dashboard`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.candidatesByStage).toEqual([{ stageId: null, stageName: "Applied (unstaged)", category: "applied", count: 1 }]);
  });
});

describe("GET /api/organizations/:organizationId/recruitment/reports/:reportKey", () => {
  it("returns 403 without recruitment.reports.read", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_rejection_reasons`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown report key", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/does_not_exist`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-recruitment report reached through this route (e.g. headcount) — cross-registry isolation", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/headcount`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("rejection reason breakdown groups applications by rejectionReasonCode, excluding null", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    fixtures.jobRequisitionRows = [{ id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null, updatedAt: new Date() }];
    fixtures.vacancyRows = [{ id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Engineer Vacancy", status: "published" }];
    fixtures.applicationRows = [
      { id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: "overqualified", submittedAt: new Date() },
      { id: 301, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: "overqualified", submittedAt: new Date() },
      { id: 302, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_rejection_reasons`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ reasonCode: "overqualified", count: 2 }]);
  });

  it("interview-to-offer ratio is null (not zero) when there is nothing to divide by yet", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_interview_to_offer_ratio`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ applicationsInterviewedCount: 0, applicationsWithOfferCount: 0, ratioPercent: null }]);
  });

  it("interview-to-offer ratio computes a real percentage once there is data", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    fixtures.jobRequisitionRows = [{ id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null, updatedAt: new Date() }];
    fixtures.vacancyRows = [{ id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Engineer Vacancy", status: "published" }];
    fixtures.applicationRows = [
      { id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() },
      { id: 301, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: null, submittedAt: new Date() },
    ];
    fixtures.interviewRows = [{ id: 1, applicationId: 300 }, { id: 2, applicationId: 301 }];
    fixtures.offerRows = [{ id: 1, applicationId: 300 }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_interview_to_offer_ratio`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ applicationsInterviewedCount: 2, applicationsWithOfferCount: 1, ratioPercent: 50 }]);
  });

  it("time-to-fill is honestly empty since no requisition in this codebase's current pipeline ever reaches status 'filled'", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    fixtures.jobRequisitionRows = [{ id: 100, organizationId: ORG_ID, title: "Engineer", status: "approved", recruiterEmployeeId: null, hiringManagerEmployeeId: null, updatedAt: new Date() }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_time_to_fill`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it("supports CSV export with the same authorization as JSON", async () => {
    mockPermissions(["recruitment.reports.read", "requisition.update"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_rejection_reasons?format=csv`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });

  it("an assigned recruiter's rejection-reason breakdown excludes another recruiter's applications", async () => {
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Recruiter" }];
    fixtures.jobRequisitionRows = [
      { id: 100, organizationId: ORG_ID, title: "Mine", status: "approved", recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
      { id: 101, organizationId: ORG_ID, title: "Not mine", status: "approved", recruiterEmployeeId: OTHER_RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, updatedAt: new Date() },
    ];
    fixtures.vacancyRows = [
      { id: 200, organizationId: ORG_ID, requisitionId: 100, title: "Mine Vacancy", status: "published" },
      { id: 201, organizationId: ORG_ID, requisitionId: 101, title: "Not Mine Vacancy", status: "published" },
    ];
    fixtures.applicationRows = [
      { id: 300, organizationId: ORG_ID, vacancyId: 200, currentStageId: null, source: "careers_portal", rejectionReasonCode: "salary", submittedAt: new Date() },
      { id: 301, organizationId: ORG_ID, vacancyId: 201, currentStageId: null, source: "careers_portal", rejectionReasonCode: "salary", submittedAt: new Date() },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/recruitment/reports/recruitment_rejection_reasons`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ reasonCode: "salary", count: 1 }]);
  });
});
