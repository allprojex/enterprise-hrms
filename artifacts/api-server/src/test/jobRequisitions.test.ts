/**
 * Integration tests for Job Requisitions (Phase 3A, W45), exercising the
 * real requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. Mirrors leaveApprovals.test.ts/
 * recruitmentConfiguration.test.ts's harness style (real field-based
 * filtering, simulated unique-index/status-guard behavior). No real
 * database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

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
  jobRequisitionsTable,
  requisitionApprovalsTable,
  positionsTable,
  departmentsTable,
  branchesTable,
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
      requisitionApprovalRows: [] as Record<string, unknown>[],
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
    jobRequisitionsTable: mockTable("job_requisitions", [
      "id",
      "organizationId",
      "title",
      "requisitionType",
      "positionId",
      "departmentId",
      "branchId",
      "hiringManagerEmployeeId",
      "recruiterEmployeeId",
      "requestedHeadcount",
      "filledCount",
      "status",
      "salaryRangeMin",
      "salaryRangeMax",
      "salaryCurrency",
      "replacementEmployeeId",
      "createdBy",
    ]),
    requisitionApprovalsTable: mockTable("requisition_approvals", [
      "id",
      "organizationId",
      "requisitionId",
      "sequence",
      "approverMembershipId",
      "decision",
      "decidedAt",
      "comment",
    ]),
    positionsTable: mockTable("positions", ["id", "organizationId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    branchesTable: mockTable("branches", ["id", "organizationId"]),
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
  if (table === requisitionApprovalsTable) return fixtures.requisitionApprovalRows;
  // positions/departments/branches are never populated in these tests — no
  // test here provides a positionId/departmentId/branchId that needs
  // cross-org validation against a real row, so an always-empty result is
  // correct (assertBelongsToOrganization only queries when the ID isn't null).
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === jobRequisitionsTable) fixtures.jobRequisitionRows = rows;
  else if (table === requisitionApprovalsTable) fixtures.requisitionApprovalRows = rows;
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

function insertRow(table: { __name: string }, v: Record<string, unknown>) {
  const defaults: Record<string, unknown> =
    table === jobRequisitionsTable
      ? { filledCount: 0, status: "draft" }
      : table === requisitionApprovalsTable
        ? { sequence: 1, decision: "pending" }
        : {};
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
  if (table === jobRequisitionsTable) fixtures.jobRequisitionRows = [...fixtures.jobRequisitionRows, row];
  if (table === requisitionApprovalsTable) fixtures.requisitionApprovalRows = [...fixtures.requisitionApprovalRows, row];
  return { returning: () => Promise.resolve([row]) };
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
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown>) => insertRow(table, v) }),
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
  jobRequisitionsTable,
  requisitionApprovalsTable,
  positionsTable,
  departmentsTable,
  branchesTable,
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
const HR_EMPLOYEE_ID = 1;
const RECRUITER_EMPLOYEE_ID = 2;
const HIRING_MANAGER_EMPLOYEE_ID = 3;
const OUTSIDER_EMPLOYEE_ID = 4;

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
  fixtures.requisitionApprovalRows = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/job-requisitions", () => {
  it("returns 403 when the recruitment module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(false);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1 });
    expect(res.status).toBe(403);
  });

  it("returns 403 without requisition.create", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1 });
    expect(res.status).toBe(403);
  });

  it("creates a draft requisition with filledCount always 0", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 2 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.filledCount).toBe(0);
    expect(res.body.createdBy).toBe(REQUESTER_USER_ID);
  });

  it("rejects a non-positive requestedHeadcount", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects a salary range where min exceeds max", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1, salaryRangeMin: "5000", salaryRangeMax: "3000", salaryCurrency: "GHS" });
    expect(res.status).toBe(400);
  });

  it("rejects a salary range missing a currency", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1, salaryRangeMin: "3000", salaryRangeMax: "5000" });
    expect(res.status).toBe(400);
  });

  it("requires replacementEmployeeId for a replacement requisition", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "replacement", requestedHeadcount: 1 });
    expect(res.status).toBe(400);
  });

  it("rejects replacementEmployeeId on a non-replacement requisition", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.employeeRows = [{ id: OUTSIDER_EMPLOYEE_ID, organizationId: ORG_ID }];

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1, replacementEmployeeId: OUTSIDER_EMPLOYEE_ID });
    expect(res.status).toBe(400);
  });

  it("rejects a hiring manager reference belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.create"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.employeeRows = [{ id: HIRING_MANAGER_EMPLOYEE_ID, organizationId: OTHER_ORG_ID }];

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Software Engineer", requisitionType: "new_role", requestedHeadcount: 1, hiringManagerEmployeeId: HIRING_MANAGER_EMPLOYEE_ID });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/organizations/:organizationId/job-requisitions — visibility", () => {
  function seedRequisitions() {
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Requested by me", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 999, recruiterEmployeeId: null, hiringManagerEmployeeId: null, departmentId: null, branchId: null },
      { id: 2, organizationId: ORG_ID, title: "I am recruiter", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 999, recruiterEmployeeId: RECRUITER_EMPLOYEE_ID, hiringManagerEmployeeId: null, departmentId: null, branchId: null },
      { id: 3, organizationId: ORG_ID, title: "Not mine at all", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 999, recruiterEmployeeId: null, hiringManagerEmployeeId: null, departmentId: 77, branchId: 88 },
    ];
  }

  it("an org-wide holder (requisition.update) sees every requisition in the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.read", "requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    seedRequisitions();

    const res = await request(app).get("/api/organizations/10/job-requisitions").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it("a caller without org-wide reach sees only requisitions they requested or are assigned to as recruiter", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.read"]);
    mockRecruitmentModuleEnabled(true);
    mockLinkedEmployee(RECRUITER_EMPLOYEE_ID);
    fixtures.employeeRows = [{ id: RECRUITER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: null, branchId: null }];
    seedRequisitions();
    // Row 1 was "requested by" the same application user (createdBy) as the caller.
    fixtures.jobRequisitionRows[0].createdBy = REQUESTER_USER_ID;

    const res = await request(app).get("/api/organizations/10/job-requisitions").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    const titles = res.body.items.map((r: { title: string }) => r.title).sort();
    expect(titles).toEqual(["I am recruiter", "Requested by me"]);
  });

  it("does not leak another organization's requisitions", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.read", "requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: OTHER_ORG_ID, title: "Theirs", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];

    const res = await request(app).get("/api/organizations/10/job-requisitions").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe("GET /api/organizations/:organizationId/job-requisitions/:id", () => {
  it("returns 404 for a requisition that exists but is not visible to this caller", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.read"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Not mine", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 999, recruiterEmployeeId: null, hiringManagerEmployeeId: null, departmentId: null, branchId: null },
    ];

    const res = await request(app).get("/api/organizations/10/job-requisitions/1").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a requisition belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.read", "requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: OTHER_ORG_ID, title: "Theirs", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];

    const res = await request(app).get("/api/organizations/10/job-requisitions/1").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/organizations/:organizationId/job-requisitions/:id", () => {
  it("allows editing a draft requisition", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Old Title", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/job-requisitions/1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "New Title" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("New Title");
  });

  it("rejects editing a requisition that is no longer a draft", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Submitted", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/job-requisitions/1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "New Title" });
    expect(res.status).toBe(400);
  });
});

describe("Job requisition lifecycle actions", () => {
  it("submit transitions draft -> pending_approval", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Draft", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/submit").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_approval");
    // W46 — a single pending approval step (sequence 1) is created atomically with the transition.
    expect(fixtures.requisitionApprovalRows).toHaveLength(1);
    expect(fixtures.requisitionApprovalRows[0]).toMatchObject({ requisitionId: 1, sequence: 1, decision: "pending" });
  });

  it("submit fails idempotently against an already-submitted requisition (concurrent double submit)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Already submitted", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/submit").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("cancel transitions pending_approval -> cancelled with a reason", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.cancel"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Pending", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
    ];

    const res = await request(app)
      .post("/api/organizations/10/job-requisitions/1/cancel")
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "Budget frozen" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.cancellationReason).toBe("Budget frozen");
  });

  it("rejects cancelling an already-closed requisition", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.cancel"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Closed", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "closed", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/cancel").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("archive transitions a cancelled requisition to closed", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Cancelled", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "cancelled", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/archive").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });

  it("rejects archiving a pending requisition (must cancel first)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Pending", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/archive").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a lifecycle action on a requisition belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["requisition.update"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: OTHER_ORG_ID, title: "Theirs", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];

    const res = await request(app).post("/api/organizations/10/job-requisitions/1/submit").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
