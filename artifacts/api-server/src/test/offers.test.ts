/**
 * Integration tests for Offers (Phase 3A, W57), exercising the real
 * requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. Mirrors referenceChecks.test.ts's harness style
 * for the application -> vacancy -> requisition visibility chain, combined
 * with requisitionApprovals.test.ts's transaction-snapshot-and-rollback
 * `db.transaction` mock (offers.ts and offerApprovals.ts both use real
 * transactions for status-guarded writes). No real database connection is
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
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  offerApprovalsTable,
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
      vacancyRows: [] as Record<string, unknown>[],
      jobRequisitionRows: [] as Record<string, unknown>[],
      offerRows: [] as Record<string, unknown>[],
      offerVersionRows: [] as Record<string, unknown>[],
      offerApprovalRows: [] as Record<string, unknown>[],
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
    applicationsTable: mockTable("applications", ["id", "organizationId", "vacancyId"]),
    vacanciesTable: mockTable("vacancies", ["id", "organizationId", "requisitionId"]),
    jobRequisitionsTable: mockTable("job_requisitions", ["id", "organizationId", "recruiterEmployeeId", "hiringManagerEmployeeId"]),
    offersTable: mockTable("offers", ["id", "organizationId", "applicationId", "currentVersionId"]),
    offerVersionsTable: mockTable("offer_versions", [
      "id",
      "organizationId",
      "offerId",
      "versionNumber",
      "proposedStartDate",
      "employmentType",
      "workplaceType",
      "location",
      "compensationSummary",
      "conditions",
      "expiryDate",
      "letterTemplateId",
      "generatedDocumentStorageKey",
      "status",
    ]),
    offerApprovalsTable: mockTable("offer_approvals", ["id", "organizationId", "offerVersionId", "sequence", "approverMembershipId", "decision", "decidedAt", "comment"]),
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
  if (table === vacanciesTable) return fixtures.vacancyRows;
  if (table === jobRequisitionsTable) return fixtures.jobRequisitionRows;
  if (table === offersTable) return fixtures.offerRows;
  if (table === offerVersionsTable) return fixtures.offerVersionRows;
  if (table === offerApprovalsTable) return fixtures.offerApprovalRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === offersTable) fixtures.offerRows = rows;
  else if (table === offerVersionsTable) fixtures.offerVersionRows = rows;
  else if (table === offerApprovalsTable) fixtures.offerApprovalRows = rows;
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
  // Simulates the real offers_application_unique constraint — offers.ts's
  // createOffer relies solely on catching a DB unique-violation race
  // (isUniqueViolation), the same "no pre-check, just catch the race"
  // precedent as candidateTags.ts's addCandidateTag, so the mock must
  // actually enforce it for that test to mean anything.
  if (table === offersTable && getRowsFor(table).some((r) => r.applicationId === v.applicationId)) {
    throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  }
  const defaults: Record<string, unknown> = table === offerVersionsTable ? { status: "draft" } : table === offerApprovalsTable ? { sequence: 1, decision: "pending" } : {};
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
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  offerApprovalsTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      // Snapshot the mutable fixture arrays touched inside a transaction so a
      // thrown "not pending"/"not draft" error rolls back any partial write
      // too — genuine atomicity, mirroring requisitionApprovals.test.ts.
      const snapshot = {
        offerRows: fixtures.offerRows,
        offerVersionRows: fixtures.offerVersionRows,
        offerApprovalRows: fixtures.offerApprovalRows,
      };
      try {
        return await cb(makeQueryClient());
      } catch (err) {
        fixtures.offerRows = snapshot.offerRows;
        fixtures.offerVersionRows = snapshot.offerVersionRows;
        fixtures.offerApprovalRows = snapshot.offerApprovalRows;
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
  asc: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;
const RECRUITER_EMPLOYEE_ID = 2;

const VACANCY_ID = 100;
const REQUISITION_ID = 200;
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
  fixtures.vacancyRows = [{ id: VACANCY_ID, organizationId: ORG_ID, requisitionId: REQUISITION_ID }];
}

function seedApplication(overrides: Record<string, unknown> = {}) {
  fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: ORG_ID, vacancyId: VACANCY_ID, ...overrides }];
}

/** Seeds an offer with a single current version at the given status. */
function seedOffer(status: string, overrides: Record<string, unknown> = {}) {
  const offerId = 1;
  const versionId = 1;
  fixtures.offerRows = [{ id: offerId, organizationId: ORG_ID, applicationId: APPLICATION_ID, currentVersionId: versionId }];
  fixtures.offerVersionRows = [
    {
      id: versionId,
      organizationId: ORG_ID,
      offerId,
      versionNumber: 1,
      proposedStartDate: null,
      employmentType: null,
      workplaceType: null,
      location: null,
      compensationSummary: null,
      conditions: null,
      expiryDate: null,
      letterTemplateId: null,
      generatedDocumentStorageKey: "internal/secret/path.pdf",
      status,
      ...overrides,
    },
  ];
  // The mock's id auto-counter starts fresh each test and doesn't know
  // these hardcoded ids are taken — prime it so the next real insert (e.g.
  // creating a second version) doesn't collide with id 1 (same fix
  // precedent as W54's interviews.test.ts).
  fixtures.idCounters.set(offersTable.__name, offerId);
  fixtures.idCounters.set(offerVersionsTable.__name, versionId);
  return { offerId, versionId };
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
  fixtures.vacancyRows = [];
  fixtures.jobRequisitionRows = [];
  fixtures.offerRows = [];
  fixtures.offerVersionRows = [];
  fixtures.offerApprovalRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  seedVacancyAndRequisition();
  seedApplication();
});

describe("POST /api/organizations/:organizationId/applications/:applicationId/offers", () => {
  it("returns 403 without offer.manage", async () => {
    mockPermissions(["offer.read"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(403);
  });

  it("returns 404 for an application belonging to a different organization", async () => {
    mockPermissions(["offer.manage"]);
    fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: OTHER_ORG_ID, vacancyId: VACANCY_ID }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(404);
  });

  it("creates a draft offer (envelope + version 1) for an org-wide caller", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`)
      .set("Authorization", "Bearer valid-token")
      .send({ location: "Accra", employmentType: "full_time" });
    expect(res.status).toBe(201);
    expect(res.body.offer.applicationId).toBe(APPLICATION_ID);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0]).toMatchObject({ versionNumber: 1, status: "draft", location: "Accra", employmentType: "full_time" });
    expect(res.body.offer.currentVersionId).toBe(res.body.versions[0].id);
  });

  it("an assigned recruiter (holding only offer.manage, no admin keys) can create an offer for their own requisition's application — the first assigned-tier real-write exception this phase", async () => {
    mockPermissions(["offer.manage"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    fixtures.jobRequisitionRows[0].recruiterEmployeeId = RECRUITER_EMPLOYEE_ID;

    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(201);
  });

  it("returns 404 for an unassigned, non-org-wide caller (offer.manage alone is not enough)", async () => {
    mockPermissions(["offer.manage"]);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    // recruiterEmployeeId/hiringManagerEmployeeId both remain null — not assigned.

    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(404);
  });

  it("returns 409 creating a second offer for an application that already has one", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/offers`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(409);
  });
});

describe("GET /api/organizations/:organizationId/offers/:id", () => {
  it("returns 404 for an offer that doesn't exist", async () => {
    mockPermissions(["offer.read", "offer.approve"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/999`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an offer that exists but is not visible to this caller", async () => {
    mockPermissions(["offer.read"]);
    const { offerId } = seedOffer("draft");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns the offer with its versions for an org-wide caller", async () => {
    mockPermissions(["offer.read", "offer.issue"]);
    const { offerId } = seedOffer("approved");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
  });

  it("never leaks generatedDocumentStorageKey in the response (DTO-shaping discipline)", async () => {
    mockPermissions(["offer.read", "offer.issue"]);
    const { offerId } = seedOffer("approved");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.versions[0]).not.toHaveProperty("generatedDocumentStorageKey");
    expect(JSON.stringify(res.body)).not.toContain("internal/secret/path.pdf");
  });
});

describe("PATCH /api/organizations/:organizationId/offers/:id — draft edit in place", () => {
  it("updates a draft version in place, keeping the same version number", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { offerId } = seedOffer("draft");
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token").send({ location: "Kumasi" });
    expect(res.status).toBe(200);
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0]).toMatchObject({ versionNumber: 1, location: "Kumasi" });
  });

  it("returns 400 when the current version is not a draft (e.g. pending_approval)", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { offerId } = seedOffer("pending_approval");
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token").send({ location: "Kumasi" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an offer not visible to this caller", async () => {
    mockPermissions(["offer.manage"]);
    const { offerId } = seedOffer("draft");
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/offers/${offerId}`).set("Authorization", "Bearer valid-token").send({ location: "Kumasi" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/offers/:id/versions — new version from approved/issued", () => {
  it("creates a new draft version and marks the prior one superseded", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { offerId, versionId } = seedOffer("approved");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/${offerId}/versions`).set("Authorization", "Bearer valid-token").send({ location: "Tema" });
    expect(res.status).toBe(201);
    expect(res.body.versions).toHaveLength(2);
    const prior = res.body.versions.find((v: { id: number }) => v.id === versionId);
    const created = res.body.versions.find((v: { id: number }) => v.id !== versionId);
    expect(prior.status).toBe("superseded");
    expect(created).toMatchObject({ versionNumber: 2, status: "draft", location: "Tema" });
    expect(res.body.offer.currentVersionId).toBe(created.id);
  });

  it("returns 400 when the current version is still draft (must use PATCH instead)", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { offerId } = seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/${offerId}/versions`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/offers/versions/:id/submit-for-approval", () => {
  it("moves draft -> pending_approval and creates the single pending approval step", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { versionId } = seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/submit-for-approval`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_approval");
    expect(fixtures.offerApprovalRows).toHaveLength(1);
    expect(fixtures.offerApprovalRows[0]).toMatchObject({ offerVersionId: versionId, sequence: 1, decision: "pending" });
  });

  it("returns 400 when the version is not a draft", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { versionId } = seedOffer("approved");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/submit-for-approval`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/offers/versions/:id/approve", () => {
  it("returns 403 without offer.approve", async () => {
    mockPermissions(["offer.manage"]);
    const { versionId } = seedOffer("pending_approval");
    fixtures.offerApprovalRows = [{ id: 1, organizationId: ORG_ID, offerVersionId: versionId, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("approves a pending version, finalizing status and recording the decision", async () => {
    mockPermissions(["offer.approve"]);
    const { versionId } = seedOffer("pending_approval");
    fixtures.offerApprovalRows = [{ id: 1, organizationId: ORG_ID, offerVersionId: versionId, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null }];

    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token").send({ comment: "Looks good" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(fixtures.offerApprovalRows[0]).toMatchObject({ decision: "approved", comment: "Looks good", approverMembershipId: 5 });
  });

  it("never leaks generatedDocumentStorageKey in the approve response", async () => {
    mockPermissions(["offer.approve"]);
    const { versionId } = seedOffer("pending_approval");
    fixtures.offerApprovalRows = [{ id: 1, organizationId: ORG_ID, offerVersionId: versionId, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null }];

    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("generatedDocumentStorageKey");
  });

  it("returns 404 for an offer version that doesn't exist", async () => {
    mockPermissions(["offer.approve"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/999/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 409 approving a version that is not currently pending", async () => {
    mockPermissions(["offer.approve"]);
    const { versionId } = seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 409 on a second decision after the first already decided it", async () => {
    mockPermissions(["offer.approve"]);
    const { versionId } = seedOffer("pending_approval");
    fixtures.offerApprovalRows = [{ id: 1, organizationId: ORG_ID, offerVersionId: versionId, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null }];

    const first = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approve`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
    expect(fixtures.offerApprovalRows[0].decision).toBe("approved");
  });
});

describe("POST /api/organizations/:organizationId/offers/versions/:id/issue", () => {
  it("returns 403 without offer.issue", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { versionId } = seedOffer("approved");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/issue`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("moves approved -> issued", async () => {
    mockPermissions(["offer.issue"]);
    const { versionId } = seedOffer("approved");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/issue`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("issued");
  });

  it("returns 400 when the version is not approved", async () => {
    mockPermissions(["offer.issue"]);
    const { versionId } = seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/issue`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/offers/versions/:id/withdraw", () => {
  it("returns 403 without offer.withdraw", async () => {
    mockPermissions(["offer.manage", "offer.approve"]);
    const { versionId } = seedOffer("issued");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/withdraw`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it.each(["pending_approval", "approved", "issued"])("withdraws a %s version", async (status) => {
    mockPermissions(["offer.withdraw"]);
    const { versionId } = seedOffer(status);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/withdraw`).set("Authorization", "Bearer valid-token").send({ reason: "Candidate declined" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("withdrawn");
  });

  it("returns 400 withdrawing a draft version (no active process to abort)", async () => {
    mockPermissions(["offer.withdraw"]);
    const { versionId } = seedOffer("draft");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/withdraw`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 withdrawing an already-terminal version", async () => {
    mockPermissions(["offer.withdraw"]);
    const { versionId } = seedOffer("withdrawn");
    const res = await request(app).post(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/withdraw`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/organizations/:organizationId/offers/versions/:id/approvals", () => {
  it("returns 404 for a version not visible to this caller", async () => {
    mockPermissions(["offer.read"]);
    const { versionId } = seedOffer("pending_approval");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns the decision history for a visible version", async () => {
    mockPermissions(["offer.read", "offer.approve"]);
    const { versionId } = seedOffer("pending_approval");
    fixtures.offerApprovalRows = [{ id: 1, organizationId: ORG_ID, offerVersionId: versionId, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/offers/versions/${versionId}/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ offerVersionId: versionId, sequence: 1, decision: "pending" });
  });
});
