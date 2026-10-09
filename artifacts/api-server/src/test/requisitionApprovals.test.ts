/**
 * Tests for the Requisition Approval Workflow (Phase 3A — the frozen plan's
 * own W47; this session's W46). Mirrors jobRequisitions.test.ts/
 * leaveApprovals.test.ts's harness style (real field-based filtering,
 * simulated status-guard behavior via a real `db.transaction` mock that
 * snapshots the mutable fixture arrays and restores them on a thrown
 * error — the only way to genuinely exercise "a conflicting decision rolls
 * back the requisition status update too"). No real database connection is
 * made.
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
      "requestedHeadcount",
      "filledCount",
      "status",
      "createdBy",
      "recruiterEmployeeId",
      "hiringManagerEmployeeId",
      "departmentId",
      "branchId",
      "updatedBy",
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
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === jobRequisitionsTable) fixtures.jobRequisitionRows = rows;
  else if (table === requisitionApprovalsTable) fixtures.requisitionApprovalRows = rows;
  else if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === employeeUserLinksTable) fixtures.employeeUserLinkRows = rows;
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
        where: (cond: Cond) => {
          const resultPromise = Promise.resolve(updateRow(table, cond, v));
          return { returning: () => resultPromise, then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resultPromise.then(resolve, reject) };
        },
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
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      // Snapshot the mutable fixture arrays touched inside a transaction so a
      // thrown "not pending" error rolls back the requisition status update
      // too — genuine atomicity, not just "the callback ran."
      const snapshot = {
        jobRequisitionRows: fixtures.jobRequisitionRows,
        requisitionApprovalRows: fixtures.requisitionApprovalRows,
      };
      try {
        return await cb(makeQueryClient());
      } catch (err) {
        fixtures.jobRequisitionRows = snapshot.jobRequisitionRows;
        fixtures.requisitionApprovalRows = snapshot.requisitionApprovalRows;
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
const REQUISITION_ID = 100;

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

/** Seeds a pending_approval requisition with its single pending approval step — the state submitJobRequisition leaves behind. */
function seedPendingRequisition(organizationId = ORG_ID, overrides: Record<string, unknown> = {}) {
  fixtures.jobRequisitionRows = [
    {
      id: REQUISITION_ID,
      organizationId,
      title: "Software Engineer",
      requisitionType: "new_role",
      requestedHeadcount: 1,
      filledCount: 0,
      status: "pending_approval",
      createdBy: 999,
      recruiterEmployeeId: null,
      hiringManagerEmployeeId: null,
      departmentId: null,
      branchId: null,
      ...overrides,
    },
  ];
  fixtures.requisitionApprovalRows = [
    { id: 1, organizationId, requisitionId: REQUISITION_ID, sequence: 1, decision: "pending", approverMembershipId: null, decidedAt: null, comment: null },
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
  fixtures.requisitionApprovalRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
});

describe("GET /api/organizations/:organizationId/job-requisitions/pending-approvals", () => {
  it("returns 403 without requisition.approve", async () => {
    mockPermissions(["requisition.read"]);
    seedPendingRequisition();

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/pending-approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 when the recruitment module is disabled", async () => {
    mockPermissions(["requisition.approve"]);
    mockRecruitmentModuleEnabled(false);
    seedPendingRequisition();

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/pending-approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("lists pending_approval requisitions org-wide, excluding other statuses and other organizations", async () => {
    mockPermissions(["requisition.approve"]);
    fixtures.jobRequisitionRows = [
      { id: 1, organizationId: ORG_ID, title: "Pending here", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
      { id: 2, organizationId: ORG_ID, title: "Still draft", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
      { id: 3, organizationId: OTHER_ORG_ID, title: "Pending elsewhere", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "pending_approval", createdBy: 1 },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/pending-approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Pending here");
  });
});

describe("GET /api/organizations/:organizationId/job-requisitions/:id/approvals", () => {
  it("returns 404 for a requisition that doesn't exist", async () => {
    mockPermissions(["requisition.read", "requisition.update"]);

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/999/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a requisition that exists but is not visible to this caller", async () => {
    mockPermissions(["requisition.read"]);
    seedPendingRequisition();

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a requisition belonging to a different organization", async () => {
    mockPermissions(["requisition.read", "requisition.update"]);
    seedPendingRequisition(OTHER_ORG_ID);

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns the decision history for a visible requisition", async () => {
    mockPermissions(["requisition.read", "requisition.update"]);
    seedPendingRequisition();

    const res = await request(app).get(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approvals`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ requisitionId: REQUISITION_ID, sequence: 1, decision: "pending" });
  });
});

describe("POST /api/organizations/:organizationId/job-requisitions/:id/approve", () => {
  it("returns 403 without requisition.approve", async () => {
    mockPermissions(["requisition.read", "requisition.update"]);
    seedPendingRequisition();

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for a requisition that doesn't exist", async () => {
    mockPermissions(["requisition.approve"]);

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/999/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 404 for a requisition belonging to a different organization", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition(OTHER_ORG_ID);

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("approves a pending requisition, finalizing status and recording the decision", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`)
      .set("Authorization", "Bearer valid-token")
      .send({ comment: "Headcount justified" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(fixtures.requisitionApprovalRows[0]).toMatchObject({
      decision: "approved",
      comment: "Headcount justified",
      approverMembershipId: 5,
    });
    expect(fixtures.requisitionApprovalRows[0].decidedAt).toBeTruthy();
  });

  it("returns 409 when the requisition is not currently pending approval (e.g. still draft)", async () => {
    mockPermissions(["requisition.approve"]);
    fixtures.jobRequisitionRows = [
      { id: REQUISITION_ID, organizationId: ORG_ID, title: "Draft", requisitionType: "new_role", requestedHeadcount: 1, filledCount: 0, status: "draft", createdBy: 1 },
    ];
    // No approval row exists yet — submit was never called.

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 409 on a second decision after the first already decided it (duplicate/concurrent decision)", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const first = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
    // The first decision is untouched by the failed second attempt (immutability).
    expect(fixtures.requisitionApprovalRows[0].decision).toBe("approved");
  });

  it("returns 409 when a reject already decided the requisition (approve/reject race)", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const rejected = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`).set("Authorization", "Bearer valid-token");
    expect(rejected.status).toBe(200);

    const approved = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/approve`).set("Authorization", "Bearer valid-token");
    expect(approved.status).toBe(409);
    expect(fixtures.requisitionApprovalRows[0].decision).toBe("rejected");
    expect(fixtures.jobRequisitionRows[0].status).toBe("rejected");
  });
});

describe("POST /api/organizations/:organizationId/job-requisitions/:id/reject", () => {
  it("returns 403 without requisition.approve", async () => {
    mockPermissions(["requisition.read", "requisition.update"]);
    seedPendingRequisition();

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("rejects a pending requisition with an optional comment, finalizing status", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`)
      .set("Authorization", "Bearer valid-token")
      .send({ comment: "Budget not approved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(fixtures.requisitionApprovalRows[0]).toMatchObject({ decision: "rejected", comment: "Budget not approved" });
  });

  it("rejects without a comment (optional, mirrors W35's rejectionReason precedent)", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const res = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
  });

  it("returns 409 rejecting an already-decided requisition", async () => {
    mockPermissions(["requisition.approve"]);
    seedPendingRequisition();

    const first = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/organizations/${ORG_ID}/job-requisitions/${REQUISITION_ID}/reject`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(409);
  });
});
