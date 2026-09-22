/**
 * Integration tests for Employee Conversion (Phase 3A, W59), exercising
 * the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. Mirrors offers.test.ts's
 * transaction-snapshot-and-rollback `db.transaction` mock (convert uses a
 * real transaction wrapping createEmployee + the candidate_employee_links
 * insert), extended with employees/departments/branches/positions tables
 * since this workstream reuses lib/employees.ts's createEmployee, plus a
 * count()-aware select builder for generateEmployeeNumber's aggregate
 * query (same trick employees.test.ts's own harness uses). No real
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  applicationsTable,
  recruitmentStagesTable,
  candidatesTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  preEmploymentRequirementsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  candidateEmployeeLinksTable,
  auditEventsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  recruitmentApprovalStagesTable,
  hireAuthorizationsTable,
  offerResponsesTable,
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
      recruitmentStageRows: [] as Record<string, unknown>[],
      candidateRows: [] as Record<string, unknown>[],
      vacancyRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      offerRows: [] as Record<string, unknown>[],
      offerVersionRows: [] as Record<string, unknown>[],
      preEmploymentRequirementRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      candidateEmployeeLinkRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
      // Phase 3H, W114 — always empty for this file's tests: getNamespaceConfig's
      // "no saved row" default path reproduces the pre-existing hardcoded
      // EMP-0001 format exactly, so no existing assertion needs to change.
      organizationSettingsRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
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
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId", "currentStageId"]),
    recruitmentStagesTable: mockTable("recruitment_stages", ["id", "organizationId", "category"]),
    candidatesTable: mockTable("candidates", ["id", "organizationId", "firstName", "lastName", "email", "phone", "nationality", "address", "linkedInternalEmployeeId"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "departmentId", "branchId", "positionId"]),
    offersTable: mockTable("offers", ["id", "organizationId", "applicationId", "currentVersionId"]),
    offerVersionsTable: mockTable("offer_versions", ["id", "organizationId", "employmentType", "proposedStartDate", "location"]),
    preEmploymentRequirementsTable: mockTable("pre_employment_requirements", ["id", "organizationId", "applicationId", "status"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "employeeNumber", "firstName", "lastName"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    branchesTable: mockTable("branches", ["id", "organizationId"]),
    positionsTable: mockTable("positions", ["id", "organizationId"]),
    candidateEmployeeLinksTable: mockTable("candidate_employee_links", ["id", "organizationId", "candidateId", "applicationId", "employeeId", "convertedAt", "convertedByMembershipId"]),
    auditEventsTable: mockTable("audit_events", []),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    numberingSequencesTable: mockTable("numbering_sequences", ["id", "organizationId", "sequenceKey", "periodKey", "currentValue"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", [
      "id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo",
      "allocatedByMembershipId", "releasedByMembershipId",
    ]),
    // WS-9: the conversion gate additionally reads recruitment approval
    // configuration, hire authorization and offer responses. Empty by default,
    // which is exactly the pre-WS-9 situation these tests assert: an
    // organization with no configured hire stages and no offer responses
    // converts exactly as it always did.
    recruitmentApprovalStagesTable: mockTable("recruitment_approval_stages", ["id", "organizationId", "purpose", "stageOrder", "name", "resolverType", "resolverConfig"]),
    hireAuthorizationsTable: mockTable("hire_authorizations", ["id", "organizationId", "applicationId", "status", "totalStages", "currentStageOrder"]),
    offerResponsesTable: mockTable("offer_responses", ["id", "organizationId", "offerId", "offerVersionId", "responseType", "channel", "respondedAt"]),
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
  if (table === recruitmentStagesTable) return fixtures.recruitmentStageRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === offersTable) return fixtures.offerRows;
  if (table === offerVersionsTable) return fixtures.offerVersionRows;
  if (table === preEmploymentRequirementsTable) return fixtures.preEmploymentRequirementRows;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === branchesTable) return fixtures.branchRows;
  if (table === positionsTable) return fixtures.positionRows;
  if (table === candidateEmployeeLinksTable) return fixtures.candidateEmployeeLinkRows;
  if (table === candidatesTable) return fixtures.candidateRows;
  if (table === organizationSettingsTable) return fixtures.organizationSettingsRows;
  if (table === numberingSequencesTable) return fixtures.numberingSequenceRows;
  if (table === employeeNumberAllocationsTable) return fixtures.employeeNumberAllocationRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === candidateEmployeeLinksTable) fixtures.candidateEmployeeLinkRows = rows;
  else if (table === candidatesTable) fixtures.candidateRows = rows;
  else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = rows;
  else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = rows;
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

function selectBuilder(table: { __name: string }, projection?: Record<string, unknown>) {
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
  const isCount = projection && projection.value === "count";
  const builder = {
    innerJoin: () => builder,
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve((isCount ? [{ value: filtered.length }] : filtered).slice(0, n)),
    orderBy: () => Promise.resolve(isCount ? [{ value: filtered.length }] : filtered),
    // Phase 3H, W114: `.for("update")` as a chainable no-op passthrough —
    // real row-locking behavior is exercised only in live QA, matching
    // learningEnrollments.test.ts's own established precedent for this.
    for: () => builder,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(isCount ? [{ value: filtered.length }] : filtered).then(resolve, reject),
  };
  return builder;
}

function insertSingleRow(table: { __name: string }, v: Record<string, unknown>): Record<string, unknown> {
  // Simulates the real candidate_employee_links unique constraints
  // (applicationId AND employeeId) — convertApplicationToEmployee relies
  // solely on catching a DB unique-violation race (isUniqueViolation), the
  // same "no pre-check, just catch the race" precedent as offers.ts/W58's
  // createPreEmploymentRequirement, so the mock must actually enforce it.
  if (
    table === candidateEmployeeLinksTable &&
    getRowsFor(table).some((r) => r.applicationId === v.applicationId || r.employeeId === v.employeeId)
  ) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  }
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v };
  const current = getRowsFor(table);
  setRowsFor(table, [...current, row]);
  return row;
}

function insertRow(table: { __name: string }, v: Record<string, unknown> | Record<string, unknown>[]) {
  const rows = Array.isArray(v) ? v.map((item) => insertSingleRow(table, item)) : [insertSingleRow(table, v)];
  const result = { returning: () => Promise.resolve(rows) };
  // The numbering helper's first-allocation insert chains
  // .onConflictDoNothing() — a plain passthrough here, as in
  // employeeNumbering.test.ts (real conflict behavior is proved live in
  // numberingSequencesLive.test.ts).
  return { ...result, onConflictDoNothing: () => result };
}

function thenableResult(resultPromise: Promise<unknown>) {
  return {
    returning: () => resultPromise,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resultPromise.then(resolve, reject),
  };
}

interface MockQueryClient {
  select: (projection?: Record<string, unknown>) => { from: (table: { __name: string }) => unknown };
  insert: (table: { __name: string }) => { values: (v: Record<string, unknown> | Record<string, unknown>[]) => unknown };
  update: (table: { __name: string }) => { set: (v: Record<string, unknown>) => { where: (cond: Cond) => unknown } };
  transaction: (cb: (tx: MockQueryClient) => Promise<unknown>) => Promise<unknown>;
}

function makeQueryClient(): MockQueryClient {
  const client: MockQueryClient = {
    select: (projection?: Record<string, unknown>) => ({ from: (table: { __name: string }) => selectBuilder(table, projection) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown> | Record<string, unknown>[]) => insertRow(table, v) }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => thenableResult(Promise.resolve(updateRow(table, cond, v))),
      }),
    }),
    // Phase 3H, W114: createEmployee/lib/numbering.ts call `client.transaction(...)`
    // (a savepoint in real Postgres) even when `client` is already the `tx`
    // this file's own outer db.transaction mock hands to convertApplicationToEmployee
    // — this file's rollback-on-error semantics already live one level up (the
    // outer db.transaction below), so nesting just needs to run the callback
    // against the same client, matching learningEnrollments.test.ts's precedent.
    transaction: async (cb: (tx: MockQueryClient) => Promise<unknown>) => cb(client),
  };
  return client;
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
  applicationsTable,
  recruitmentStagesTable,
  candidatesTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  preEmploymentRequirementsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  candidateEmployeeLinksTable,
  auditEventsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  recruitmentApprovalStagesTable,
  hireAuthorizationsTable,
  offerResponsesTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      const snapshot = {
        employeeRows: fixtures.employeeRows,
        candidateEmployeeLinkRows: fixtures.candidateEmployeeLinkRows,
        candidateRows: fixtures.candidateRows,
        numberingSequenceRows: fixtures.numberingSequenceRows,
        employeeNumberAllocationRows: fixtures.employeeNumberAllocationRows,
      };
      try {
        return await cb(makeQueryClient());
      } catch (err) {
        fixtures.employeeRows = snapshot.employeeRows;
        fixtures.candidateEmployeeLinkRows = snapshot.candidateEmployeeLinkRows;
        fixtures.candidateRows = snapshot.candidateRows;
        fixtures.numberingSequenceRows = snapshot.numberingSequenceRows;
        fixtures.employeeNumberAllocationRows = snapshot.employeeNumberAllocationRows;
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
  ilike: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  count: () => "count",
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;

const VACANCY_ID = 100;
const REQUISITION_ID = 200;
const CANDIDATE_ID = 400;
const APPLICATION_ID = 500;
const HIRED_STAGE_ID = 600;
const SCREENING_STAGE_ID = 601;

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

function seedHiredApplication(overrides: Record<string, unknown> = {}) {
  fixtures.recruitmentStageRows = [
    { id: HIRED_STAGE_ID, organizationId: ORG_ID, category: "hired" },
    { id: SCREENING_STAGE_ID, organizationId: ORG_ID, category: "screening" },
  ];
  fixtures.jobRequisitionRows = [{ id: REQUISITION_ID, organizationId: ORG_ID, departmentId: null, branchId: null, positionId: null }];
  fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID }];
  fixtures.candidateRows = [{ id: CANDIDATE_ID, organizationId: ORG_ID, firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "555-1234", nationality: "Ghanaian", address: null, linkedInternalEmployeeId: null }];
  fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, currentStageId: HIRED_STAGE_ID, ...overrides }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.applicationRows = [];
  fixtures.recruitmentStageRows = [];
  fixtures.candidateRows = [];
  fixtures.vacancyRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.offerRows = [];
  fixtures.offerVersionRows = [];
  fixtures.preEmploymentRequirementRows = [];
  fixtures.employeeRows = [];
  fixtures.departmentRows = [];
  fixtures.branchRows = [];
  fixtures.positionRows = [];
  fixtures.candidateEmployeeLinkRows = [];
  fixtures.organizationSettingsRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.employeeNumberAllocationRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  seedHiredApplication();
});

const CONVERT_PATH = `/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/convert-to-employee`;

describe("POST /api/organizations/:organizationId/applications/:applicationId/convert-to-employee", () => {
  it("returns 403 without candidate.convert_to_employee", async () => {
    mockPermissions(["employee.write"]);
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 without employee.write (candidate.convert_to_employee alone is not enough)", async () => {
    mockPermissions(["candidate.convert_to_employee"]);
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for an application belonging to a different organization", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: OTHER_ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, currentStageId: HIRED_STAGE_ID }];
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 when the application is not in a hired-category stage", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.applicationRows[0].currentStageId = SCREENING_STAGE_ID;
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 when a non-waived pre-employment requirement is still pending", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.preEmploymentRequirementRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, status: "pending" }];
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("converts when every pre-employment requirement is satisfied or waived", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.preEmploymentRequirementRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, status: "satisfied" },
      { id: 2, organizationId: ORG_ID, applicationId: APPLICATION_ID, status: "waived" },
    ];
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(res.body.reusedExistingEmployee).toBe(false);
    expect(res.body.employeeId).toBeTruthy();
  });

  it("converts with no pre-employment requirements tracked at all (vacuously eligible)", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
  });

  it("maps candidate name/contact onto the created employee", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    const employee = fixtures.employeeRows.find((e) => e.id === res.body.employeeId);
    expect(employee).toMatchObject({ firstName: "Jane", lastName: "Doe", personalEmail: "jane@example.com", phoneNumber: "555-1234", nationality: "Ghanaian" });
  });

  it("maps requisition placement and offer employment fields onto the created employee", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.departmentRows = [{ id: 71, organizationId: ORG_ID }];
    fixtures.branchRows = [{ id: 72, organizationId: ORG_ID }];
    fixtures.positionRows = [{ id: 73, organizationId: ORG_ID }];
    fixtures.jobRequisitionRows[0] = { ...fixtures.jobRequisitionRows[0], departmentId: 71, branchId: 72, positionId: 73 };
    fixtures.offerRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, currentVersionId: 1 }];
    // WS-9 (MASTER_OWNER_REVIEW §25.4): once an offer exists for the
    // application, the Recruitment path requires it to be ACCEPTED before
    // conversion. This fixture now reflects that deliberate behaviour change —
    // it is not a workaround: a separate live suite asserts that an offer left
    // un-accepted, declined, withdrawn, superseded or expired correctly blocks
    // conversion.
    fixtures.offerVersionRows = [{ id: 1, organizationId: ORG_ID, employmentType: "full_time", proposedStartDate: "2026-09-01", location: "Accra", status: "accepted" }];

    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    const employee = fixtures.employeeRows.find((e) => e.id === res.body.employeeId);
    expect(employee).toMatchObject({ departmentId: 71, branchId: 72, positionId: 73, employmentType: "full_time", workLocation: "Accra" });
  });

  it("links the candidate to the newly created employee (so a future first-time-link check recognizes them as internal)", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(fixtures.candidateRows[0].linkedInternalEmployeeId).toBe(res.body.employeeId);
  });

  it("returns 409 for a second application from a candidate already linked by a prior conversion — candidate_employee_links.employeeId is unique, so only a candidate linked by some other means (never yet converted here) can ever hit the reuse branch successfully", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    const first = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(201);

    const SECOND_APPLICATION_ID = 501;
    fixtures.applicationRows.push({ id: SECOND_APPLICATION_ID, organizationId: ORG_ID, candidateId: CANDIDATE_ID, vacancyId: VACANCY_ID, currentStageId: HIRED_STAGE_ID });

    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${SECOND_APPLICATION_ID}/convert-to-employee`)
      .set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
    expect(fixtures.employeeRows).toHaveLength(1);
  });

  it("reuses the existing employee for an internal candidate instead of creating a second one", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.employeeRows = [{ id: 999, organizationId: ORG_ID, employeeNumber: "EMP-0001", firstName: "Existing", lastName: "Employee" }];
    fixtures.candidateRows[0].linkedInternalEmployeeId = 999;

    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(999);
    expect(res.body.reusedExistingEmployee).toBe(true);
    expect(fixtures.employeeRows).toHaveLength(1);
  });

  it("returns 409 on a second conversion attempt for the same application (idempotent under retry)", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    const first = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(201);

    const second = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
    // No second employee was created by the failed retry.
    expect(fixtures.employeeRows).toHaveLength(1);
  });

  it("returns 409 converting a different application for an already-converted internal candidate's employee", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.employeeRows = [{ id: 999, organizationId: ORG_ID, employeeNumber: "EMP-0001", firstName: "Existing", lastName: "Employee" }];
    fixtures.candidateRows[0].linkedInternalEmployeeId = 999;
    fixtures.candidateEmployeeLinkRows = [{ id: 1, organizationId: ORG_ID, candidateId: CANDIDATE_ID, applicationId: 999999, employeeId: 999, convertedAt: new Date(), convertedByMembershipId: 5 }];

    const res = await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("preserves recruitment history — the application, candidate, and requirement rows are never deleted", async () => {
    mockPermissions(["candidate.convert_to_employee", "employee.write"]);
    fixtures.preEmploymentRequirementRows = [{ id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, status: "satisfied" }];
    await request(app).post(CONVERT_PATH).set("Authorization", "Bearer valid-token");
    expect(fixtures.applicationRows).toHaveLength(1);
    expect(fixtures.candidateRows).toHaveLength(1);
    expect(fixtures.preEmploymentRequirementRows).toHaveLength(1);
  });
});
