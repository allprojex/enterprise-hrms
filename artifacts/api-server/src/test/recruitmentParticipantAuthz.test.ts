/**
 * Record-level authorization for recruitment reads that were gated on
 * broadly-seeded keys alone (offer.read / application.read / candidate.read,
 * all held by the canonical `employee` role):
 *
 *   GET .../offer-versions/:versionId/state
 *   GET .../offer-versions/:versionId/particulars
 *   GET .../applications/:applicationId/hire-authorization
 *   GET .../custom-field-values/{candidate|application}/:entityId (+ reveal)
 *
 * Exercises the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain and the real lib-layer visibility through supertest,
 * with offers.test.ts's in-memory @workspace/db harness. Every request is made
 * directly against the API — no UI is involved. No real database connection is
 * made.
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
  candidatesTable,
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  offerResponsesTable,
  employmentParticularsTable,
  hireAuthorizationsTable,
  hireAuthorizationDecisionsTable,
  recruitmentApprovalStagesTable,
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
      candidateRows: [] as Record<string, unknown>[],
      applicationRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      offerRows: [] as Record<string, unknown>[],
      offerVersionRows: [] as Record<string, unknown>[],
      offerResponseRows: [] as Record<string, unknown>[],
      employmentParticularsRows: [] as Record<string, unknown>[],
      hireAuthorizationRows: [] as Record<string, unknown>[],
      hireAuthorizationDecisionRows: [] as Record<string, unknown>[],
      approvalStageRows: [] as Record<string, unknown>[],
      /** departmentId -> current head's membershipId */
      departmentHeads: new Map<number, number>(),
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
    candidatesTable: mockTable("candidates", ["id", "organizationId"]),
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "recruiterEmployeeId", "hiringManagerEmployeeId", "departmentId"]),
    offersTable: mockTable("offers", ["id", "organizationId", "applicationId", "currentVersionId"]),
    offerVersionsTable: mockTable("offer_versions", ["id", "organizationId", "offerId", "status", "generatedDocumentStorageKey"]),
    offerResponsesTable: mockTable("offer_responses", ["id", "offerVersionId"]),
    employmentParticularsTable: mockTable("employment_particulars", ["id", "organizationId", "offerVersionId"]),
    hireAuthorizationsTable: mockTable("hire_authorizations", ["id", "organizationId", "applicationId"]),
    hireAuthorizationDecisionsTable: mockTable("hire_authorization_decisions", ["id", "organizationId", "hireAuthorizationId", "stageOrder"]),
    recruitmentApprovalStagesTable: mockTable("recruitment_approval_stages", ["id", "organizationId", "purpose", "stageOrder"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

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
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === offersTable) return fixtures.offerRows;
  if (table === offerVersionsTable) return fixtures.offerVersionRows;
  if (table === offerResponsesTable) return fixtures.offerResponseRows;
  if (table === employmentParticularsTable) return fixtures.employmentParticularsRows;
  if (table === hireAuthorizationsTable) return fixtures.hireAuthorizationRows;
  if (table === hireAuthorizationDecisionsTable) return fixtures.hireAuthorizationDecisionRows;
  if (table === recruitmentApprovalStagesTable) return fixtures.approvalStageRows;
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
    leftJoin: () => builder,
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
    select: () => ({ from: (table: { __name: string }) => selectBuilder(table) }),
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: 1, ...v }]), then: (r: (v: unknown) => void) => Promise.resolve([]).then(r) }) }),
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
  candidatesTable,
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  offerResponsesTable,
  employmentParticularsTable,
  hireAuthorizationsTable,
  hireAuthorizationDecisionsTable,
  recruitmentApprovalStagesTable,
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
  asc: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

// The temporal department-head relationship has its own tested module; here
// only "who heads department N right now" matters.
vi.mock("../lib/departmentHeads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/departmentHeads")>()),
  resolveDepartmentHeadAsOf: async (_organizationId: number, departmentId: number) => {
    const headMembershipId = fixtures.departmentHeads.get(departmentId);
    return headMembershipId == null ? null : ({ headMembershipId } as never);
  },
}));

// Value storage/rendering is WS-8's own concern (customFieldsLive.test.ts);
// these tests prove only who reaches it.
vi.mock("../lib/customFields/values", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/customFields/values")>()),
  getValuesForEntity: async () => [],
  getSingleValue: async (_organizationId: number, definitionId: number, scope: string) =>
    ({ field: { definition: { id: definitionId, scope, fieldKey: "expected_salary" }, version: { label: "Expected salary" } }, stored: { value: "90000" } }) as never,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const USER_ID = 1;
const MEMBERSHIP_ID = 5;

const RECRUITER_EMPLOYEE_ID = 2;
const HIRING_MANAGER_EMPLOYEE_ID = 3;
const OTHER_HIRING_MANAGER_EMPLOYEE_ID = 4;
const UNRELATED_EMPLOYEE_ID = 9;
const DEPARTMENT_ID = 70;
const OTHER_DEPARTMENT_ID = 71;

// Requisition A (recruiter 2, hiring manager 3, department 70) -> vacancy 100 -> application 500 (candidate 400) -> offer 1 / version 1.
// Requisition B (hiring manager 4, department 71) -> vacancy 101 -> application 501 (candidate 401) -> offer 2 / version 2.
// Another organization: application 900 (candidate 900) -> offer 9 / version 9.
const CANDIDATE_A = 400;
const CANDIDATE_B = 401;
const CANDIDATE_OTHER_ORG = 900;
const APPLICATION_A = 500;
const APPLICATION_B = 501;
const APPLICATION_OTHER_ORG = 900;
const VERSION_A = 1;
const VERSION_B = 2;
const VERSION_OTHER_ORG = 9;
const STORAGE_KEY = "orgs/10/generated/offer-letter-secret.pdf";

/** Exactly the recruitment keys the canonical `employee` role holds. */
const EMPLOYEE_KEYS = [
  "application.read",
  "candidate.read",
  "candidate.notes.read",
  "interview.read",
  "offer.read",
  "offer.manage",
  "requisition.read",
  "vacancy.read",
  "scorecard.submit",
  "recruitment.reports.read",
];
/** HR / recruitment staff: the employee keys plus the stronger org-wide keys. */
const HR_KEYS = [
  ...EMPLOYEE_KEYS,
  "application.manage",
  "application.pipeline.move",
  "candidate.manage",
  "candidate.notes.write",
  "offer.approve",
  "offer.issue",
  "offer.withdraw",
];

function mockPermissions(keys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

/** The caller's linked employee record (null = no employee link). */
function actAsEmployee(employeeId: number | null) {
  fixtures.employeeUserLinkRows = employeeId == null ? [] : [{ employeeId, applicationUserId: USER_ID }];
  fixtures.employeeRows = employeeId == null ? [] : [{ id: employeeId, organizationId: ORG_ID, departmentId: DEPARTMENT_ID, branchId: null }];
}

function mockRecruitmentModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function offerVersion(id: number, organizationId: number, offerId: number) {
  return {
    id,
    organizationId,
    offerId,
    versionNumber: 1,
    status: "issued",
    expiryDate: null,
    compensationSummary: { baseSalary: 90000, currency: "GHS" },
    letterTemplateId: null,
    generatedDocumentStorageKey: STORAGE_KEY,
  };
}

function seedRecruitment() {
  fixtures.jobRequisitionRows = [
    { id: 200, organizationId: ORG_ID, recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: HIRING_MANAGER_EMPLOYEE_ID, departmentId: DEPARTMENT_ID },
    { id: 201, organizationId: ORG_ID, recruiterEmployeeId: null, hiringManagerEmployeeId: OTHER_HIRING_MANAGER_EMPLOYEE_ID, departmentId: OTHER_DEPARTMENT_ID },
    { id: 900, organizationId: OTHER_ORG_ID, recruiterEmployeeId: null, hiringManagerEmployeeId: null, departmentId: null },
  ];
  fixtures.vacancyRows = [
    { id: 100, organizationId: ORG_ID, requisitionId: 200 },
    { id: 101, organizationId: ORG_ID, requisitionId: 201 },
    { id: 900, organizationId: OTHER_ORG_ID, requisitionId: 900 },
  ];
  fixtures.candidateRows = [
    { id: CANDIDATE_A, organizationId: ORG_ID },
    { id: CANDIDATE_B, organizationId: ORG_ID },
    { id: CANDIDATE_OTHER_ORG, organizationId: OTHER_ORG_ID },
  ];
  // departmentId stands in for the application -> vacancy -> requisition join the harness flattens.
  fixtures.applicationRows = [
    { id: APPLICATION_A, organizationId: ORG_ID, candidateId: CANDIDATE_A, vacancyId: 100, departmentId: DEPARTMENT_ID },
    { id: APPLICATION_B, organizationId: ORG_ID, candidateId: CANDIDATE_B, vacancyId: 101, departmentId: OTHER_DEPARTMENT_ID },
    { id: APPLICATION_OTHER_ORG, organizationId: OTHER_ORG_ID, candidateId: CANDIDATE_OTHER_ORG, vacancyId: 900, departmentId: null },
  ];
  fixtures.offerRows = [
    { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_A, currentVersionId: VERSION_A },
    { id: 2, organizationId: ORG_ID, applicationId: APPLICATION_B, currentVersionId: VERSION_B },
    { id: 9, organizationId: OTHER_ORG_ID, applicationId: APPLICATION_OTHER_ORG, currentVersionId: VERSION_OTHER_ORG },
  ];
  fixtures.offerVersionRows = [offerVersion(VERSION_A, ORG_ID, 1), offerVersion(VERSION_B, ORG_ID, 2), offerVersion(VERSION_OTHER_ORG, OTHER_ORG_ID, 9)];
  // Issued particulars, so the route returns the frozen record without computing suggestions.
  fixtures.employmentParticularsRows = [
    { id: 1, organizationId: ORG_ID, offerVersionId: VERSION_A, payRate: "GHS 90,000", issuedAt: new Date() },
    { id: 2, organizationId: ORG_ID, offerVersionId: VERSION_B, payRate: "GHS 70,000", issuedAt: new Date() },
    { id: 9, organizationId: OTHER_ORG_ID, offerVersionId: VERSION_OTHER_ORG, payRate: "GHS 1", issuedAt: new Date() },
  ];
  fixtures.hireAuthorizationRows = [
    { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_A, status: "pending", totalStages: 1, currentStageOrder: 1 },
    { id: 2, organizationId: ORG_ID, applicationId: APPLICATION_B, status: "pending", totalStages: 1, currentStageOrder: 1 },
    { id: 9, organizationId: OTHER_ORG_ID, applicationId: APPLICATION_OTHER_ORG, status: "pending", totalStages: 1, currentStageOrder: 1 },
  ];
}

function configureHireStage(resolverType: "department_head" | "permission_holder" | "specific_membership", resolverConfig: unknown = null) {
  fixtures.approvalStageRows = [{ id: 1, organizationId: ORG_ID, purpose: "hire", stageOrder: 1, name: "Final approval", resolverType, resolverConfig }];
}

function get(path: string) {
  return request(app).get(`/api/organizations/${ORG_ID}${path}`).set("Authorization", "Bearer valid-token");
}

beforeEach(() => {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: USER_ID, expiresAt: new Date(Date.now() + 100000) },
      user: { id: USER_ID, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
  fixtures.membershipRows = [{ id: MEMBERSHIP_ID, applicationUserId: USER_ID, organizationId: ORG_ID, status: "active" }];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.offerResponseRows = [];
  fixtures.hireAuthorizationDecisionRows = [];
  fixtures.approvalStageRows = [];
  fixtures.departmentHeads = new Map();
  mockRecruitmentModuleEnabled(true);
  seedRecruitment();
});

describe("GET /offer-versions/:versionId/state — participant-scoped", () => {
  const path = (versionId: number) => `/offer-versions/${versionId}/state`;

  it("denies (404) an ordinary employee holding only the employee-role keys", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    const res = await get(path(VERSION_A));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("90000");
  });

  it("denies (404) a department head of the requisition's department who is not a participant", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    fixtures.departmentHeads.set(DEPARTMENT_ID, MEMBERSHIP_ID);
    expect((await get(path(VERSION_A))).status).toBe(404);
  });

  it("lets the requisition's hiring manager read that requisition's offer version only", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(HIRING_MANAGER_EMPLOYEE_ID);
    const own = await get(path(VERSION_A));
    expect(own.status).toBe(200);
    expect(own.body.version.id).toBe(VERSION_A);
    expect((await get(path(VERSION_B))).status).toBe(404);
  });

  it("lets the requisition's assigned recruiter read it", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(RECRUITER_EMPLOYEE_ID);
    expect((await get(path(VERSION_A))).status).toBe(200);
  });

  it("denies (404) the hiring manager of a different requisition", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(OTHER_HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(path(VERSION_A))).status).toBe(404);
  });

  it("keeps org-wide access for HR/recruitment key holders", async () => {
    mockPermissions(HR_KEYS);
    actAsEmployee(null);
    expect((await get(path(VERSION_A))).status).toBe(200);
    expect((await get(path(VERSION_B))).status).toBe(200);
  });

  it("never returns generatedDocumentStorageKey in the payload", async () => {
    mockPermissions(HR_KEYS);
    const res = await get(path(VERSION_A));
    expect(res.status).toBe(200);
    expect(res.body.version).not.toHaveProperty("generatedDocumentStorageKey");
    expect(JSON.stringify(res.body)).not.toContain(STORAGE_KEY);
  });

  it("denies (404) another organization's offer version even to an org-wide caller", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(path(VERSION_OTHER_ORG))).status).toBe(404);
  });

  it("is refused (403) when the recruitment module is disabled", async () => {
    mockPermissions(HR_KEYS);
    mockRecruitmentModuleEnabled(false);
    expect((await get(path(VERSION_A))).status).toBe(403);
  });
});

describe("GET /offer-versions/:versionId/particulars — participant-scoped", () => {
  const path = (versionId: number) => `/offer-versions/${versionId}/particulars`;

  it("denies (404) an ordinary employee holding only the employee-role keys", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    const res = await get(path(VERSION_A));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("GHS 90,000");
  });

  it("denies (404) a non-participant department head", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    fixtures.departmentHeads.set(DEPARTMENT_ID, MEMBERSHIP_ID);
    expect((await get(path(VERSION_A))).status).toBe(404);
  });

  it("lets the requisition's hiring manager read that requisition's particulars only", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(HIRING_MANAGER_EMPLOYEE_ID);
    const own = await get(path(VERSION_A));
    expect(own.status).toBe(200);
    expect(own.body.particulars.payRate).toBe("GHS 90,000");
    expect((await get(path(VERSION_B))).status).toBe(404);
  });

  it("denies (404) the hiring manager of a different requisition", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(OTHER_HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(path(VERSION_A))).status).toBe(404);
  });

  it("keeps org-wide access for HR/recruitment key holders", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(path(VERSION_B))).status).toBe(200);
  });

  it("denies (404) another organization's particulars", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(path(VERSION_OTHER_ORG))).status).toBe(404);
  });

  it("is refused (403) when the recruitment module is disabled", async () => {
    mockPermissions(HR_KEYS);
    mockRecruitmentModuleEnabled(false);
    expect((await get(path(VERSION_A))).status).toBe(403);
  });
});

describe("GET /applications/:applicationId/hire-authorization — participant or configured approver", () => {
  const path = (applicationId: number) => `/applications/${applicationId}/hire-authorization`;

  it("denies (404) an ordinary employee holding only the employee-role keys", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    configureHireStage("permission_holder", { permissionKey: "offer.approve" });
    expect((await get(path(APPLICATION_A))).status).toBe(404);
  });

  it("denies (404) a department head when no department-head stage is configured", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    fixtures.departmentHeads.set(DEPARTMENT_ID, MEMBERSHIP_ID);
    configureHireStage("specific_membership", { membershipId: 77 });
    expect((await get(path(APPLICATION_A))).status).toBe(404);
  });

  it("lets a configured department-head approver read the authorization for their department only", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    fixtures.departmentHeads.set(DEPARTMENT_ID, MEMBERSHIP_ID);
    configureHireStage("department_head");
    const own = await get(path(APPLICATION_A));
    expect(own.status).toBe(200);
    expect(own.body.authorization.applicationId).toBe(APPLICATION_A);
    // Application B's requisition belongs to a department this caller does not head.
    expect((await get(path(APPLICATION_B))).status).toBe(404);
  });

  it("lets a named (specific_membership) approver read it", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    configureHireStage("specific_membership", { membershipId: MEMBERSHIP_ID });
    expect((await get(path(APPLICATION_A))).status).toBe(200);
  });

  it("gives a configured approver nothing before an authorization has been raised", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    configureHireStage("specific_membership", { membershipId: MEMBERSHIP_ID });
    fixtures.hireAuthorizationRows = fixtures.hireAuthorizationRows.filter((r) => r.applicationId !== APPLICATION_A);
    expect((await get(path(APPLICATION_A))).status).toBe(404);
  });

  it("lets the requisition's hiring manager read that application's authorization only", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(path(APPLICATION_A))).status).toBe(200);
    expect((await get(path(APPLICATION_B))).status).toBe(404);
  });

  it("denies (404) the hiring manager of a different requisition", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(OTHER_HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(path(APPLICATION_A))).status).toBe(404);
  });

  it("keeps org-wide access for HR/recruitment key holders", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(path(APPLICATION_A))).status).toBe(200);
    expect((await get(path(APPLICATION_B))).status).toBe(200);
  });

  it("denies (404) another organization's application, even to a named approver", async () => {
    mockPermissions(HR_KEYS);
    configureHireStage("specific_membership", { membershipId: MEMBERSHIP_ID });
    expect((await get(path(APPLICATION_OTHER_ORG))).status).toBe(404);
  });

  it("is refused (403) when the recruitment module is disabled", async () => {
    mockPermissions(HR_KEYS);
    mockRecruitmentModuleEnabled(false);
    expect((await get(path(APPLICATION_A))).status).toBe(403);
  });
});

describe("GET /custom-field-values/{candidate|application}/:entityId — participant-scoped", () => {
  it("denies (404) an ordinary employee on both recruitment scopes", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_A}`)).status).toBe(404);
    expect((await get(`/custom-field-values/application/${APPLICATION_A}`)).status).toBe(404);
  });

  it("denies (404) a non-participant department head", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    fixtures.departmentHeads.set(DEPARTMENT_ID, MEMBERSHIP_ID);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_A}`)).status).toBe(404);
    expect((await get(`/custom-field-values/application/${APPLICATION_A}`)).status).toBe(404);
  });

  it("lets the requisition's hiring manager read that requisition's candidate/application values only", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_A}`)).status).toBe(200);
    expect((await get(`/custom-field-values/application/${APPLICATION_A}`)).status).toBe(200);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_B}`)).status).toBe(404);
    expect((await get(`/custom-field-values/application/${APPLICATION_B}`)).status).toBe(404);
  });

  it("denies (404) the hiring manager of a different requisition", async () => {
    mockPermissions(EMPLOYEE_KEYS);
    actAsEmployee(OTHER_HIRING_MANAGER_EMPLOYEE_ID);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_A}`)).status).toBe(404);
    expect((await get(`/custom-field-values/application/${APPLICATION_A}`)).status).toBe(404);
  });

  it("keeps org-wide access for HR/recruitment key holders", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_B}`)).status).toBe(200);
    expect((await get(`/custom-field-values/application/${APPLICATION_B}`)).status).toBe(200);
  });

  it("denies (404) another organization's records", async () => {
    mockPermissions(HR_KEYS);
    expect((await get(`/custom-field-values/candidate/${CANDIDATE_OTHER_ORG}`)).status).toBe(404);
    expect((await get(`/custom-field-values/application/${APPLICATION_OTHER_ORG}`)).status).toBe(404);
  });

  it("applies the same visibility to the sensitive reveal route", async () => {
    mockPermissions([...EMPLOYEE_KEYS, "custom_fields.sensitive.read"]);
    actAsEmployee(UNRELATED_EMPLOYEE_ID);
    const denied = await get(`/custom-field-values/candidate/${CANDIDATE_A}/1/reveal`);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain("90000");

    actAsEmployee(HIRING_MANAGER_EMPLOYEE_ID);
    const allowed = await get(`/custom-field-values/candidate/${CANDIDATE_A}/1/reveal`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.value).toBe("90000");
  });
});
