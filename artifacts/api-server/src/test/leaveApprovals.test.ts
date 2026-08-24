/**
 * Tests for the Leave Approval Workflow — reworked by the Leave Approval
 * Workflow Reconciliation to a mandatory two-stage flow: Employee submits →
 * Department Head approves/rejects ("pending" → "pending_hr") → HR gives
 * final approval/rejection ("pending_hr" → "approved"/"rejected"). Mirrors
 * leaveRequests.test.ts / leaveBalances.test.ts's mockTable/Cond/matches
 * pattern, extended with a `department_heads` table (real isNull filtering,
 * borrowed from departmentHeads.test.ts's own precedent) and a
 * `db.transaction` mock that snapshots the mutable fixture arrays and
 * restores them on a thrown error. No real database connection is made.
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
  departmentHeadsTable,
  leaveTypesTable,
  leavePoliciesTable,
  leaveRequestsTable,
  leaveBalanceEntriesTable,
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
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      departmentHeadRows: [] as Record<string, unknown>[],
      leaveTypeRows: [] as Record<string, unknown>[],
      leavePolicyRows: [] as Record<string, unknown>[],
      leaveRequestRows: [] as Record<string, unknown>[],
      leaveBalanceEntryRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "reportingManagerId", "departmentId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "headMembershipId", "validFrom", "validTo"]),
    leaveTypesTable: mockTable("leave_types", ["id", "organizationId", "name", "status"]),
    leavePoliciesTable: mockTable("leave_policies", ["id", "organizationId", "leaveTypeId", "status", "allowNegativeBalance"]),
    leaveRequestsTable: mockTable("leave_requests", [
      "id",
      "organizationId",
      "employeeId",
      "leaveTypeId",
      "leavePolicyId",
      "startDate",
      "endDate",
      "daysRequested",
      "status",
      "reason",
    ]),
    leaveBalanceEntriesTable: mockTable("leave_balance_entries", [
      "id",
      "organizationId",
      "employeeId",
      "leaveTypeId",
      "leavePolicyId",
      "entryType",
      "amount",
      "effectiveDate",
      "relatedLeaveRequestId",
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
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === employeeUserLinksTable) return fixtures.employeeUserLinkRows;
  if (table === departmentHeadsTable) return fixtures.departmentHeadRows;
  if (table === leaveTypesTable) return fixtures.leaveTypeRows;
  if (table === leavePoliciesTable) return fixtures.leavePolicyRows;
  if (table === leaveRequestsTable) return fixtures.leaveRequestRows;
  if (table === leaveBalanceEntriesTable) return fixtures.leaveBalanceEntryRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === organizationModulesTable) fixtures.organizationModuleRows = rows;
  else if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === employeeUserLinksTable) fixtures.employeeUserLinkRows = rows;
  else if (table === departmentHeadsTable) fixtures.departmentHeadRows = rows;
  else if (table === leaveTypesTable) fixtures.leaveTypeRows = rows;
  else if (table === leavePoliciesTable) fixtures.leavePolicyRows = rows;
  else if (table === leaveRequestsTable) fixtures.leaveRequestRows = rows;
  else if (table === leaveBalanceEntriesTable) fixtures.leaveBalanceEntryRows = rows;
}

function selectBuilder(table: { __name: string }, proj?: Record<string, unknown>) {
  if (table === sessionsTable) {
    const rows = fixtures.sessionRows;
    const sessionBuilder = {
      innerJoin: () => sessionBuilder,
      where: () => sessionBuilder,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return sessionBuilder;
  }

  const unfiltered =
    table === membershipRolesTable
      ? fixtures.membershipRoleRows
      : table === rolePermissionsTable
        ? fixtures.permissionRows
        : table === modulesTable
          ? fixtures.moduleRows
          : undefined;
  if (unfiltered !== undefined) {
    const rows = unfiltered as unknown[];
    const passthroughBuilder = {
      innerJoin: () => passthroughBuilder,
      where: () => passthroughBuilder,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return passthroughBuilder;
  }

  const rows = getRowsFor(table);
  const project = (r: Record<string, unknown>) => (proj ? Object.fromEntries(Object.keys(proj).map((k) => [k, r[k]])) : r);
  let filtered = rows;
  const builder = {
    innerJoin: () => builder,
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve(filtered.slice(0, n).map(project)),
    orderBy: () => Promise.resolve(filtered.map(project)),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(filtered.map(project)).then(resolve, reject),
  };
  return builder;
}

function insertRow(table: { __name: string }, v: Record<string, unknown>) {
  fixtures.inserted.push({ table: table.__name, values: v });

  if (table === leaveBalanceEntriesTable && v.relatedLeaveRequestId != null) {
    const duplicate = fixtures.leaveBalanceEntryRows.some(
      (r) => r.relatedLeaveRequestId === v.relatedLeaveRequestId && r.entryType === v.entryType,
    );
    if (duplicate) return { returning: () => Promise.reject({ code: "23505" }) };
  }

  const row = { id: nextId(table), createdAt: new Date(), ...v };
  if (table === leaveBalanceEntriesTable) fixtures.leaveBalanceEntryRows = [...fixtures.leaveBalanceEntryRows, row];
  return { returning: () => Promise.resolve([row]) };
}

function makeQueryClient() {
  return {
    select: (proj?: Record<string, unknown>) => ({ from: (table: { __name: string }) => selectBuilder(table, proj) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown>) => insertRow(table, v) }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              const rows = getRowsFor(table);
              const idx = rows.findIndex((r) => matches(r, cond));
              if (idx === -1) return Promise.resolve([]);
              const updated = { ...rows[idx], ...v };
              setRowsFor(
                table,
                rows.map((r, i) => (i === idx ? updated : r)),
              );
              return Promise.resolve([updated]);
            },
          };
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentHeadsTable,
  leaveTypesTable,
  leavePoliciesTable,
  leaveRequestsTable,
  leaveBalanceEntriesTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      const snapshot = {
        leaveRequestRows: fixtures.leaveRequestRows,
        leaveBalanceEntryRows: fixtures.leaveBalanceEntryRows,
        inserted: fixtures.inserted,
      };
      try {
        return await cb(makeQueryClient());
      } catch (err) {
        fixtures.leaveRequestRows = snapshot.leaveRequestRows;
        fixtures.leaveBalanceEntryRows = snapshot.leaveBalanceEntryRows;
        fixtures.inserted = snapshot.inserted;
        throw err;
      }
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 99;
const DEPARTMENT_ID = 100;
const OTHER_DEPARTMENT_ID = 200;
const EMPLOYEE_ID = 42;
const LEAVE_TYPE_ID = 1;
const LEAVE_POLICY_ID = 1;
const LEAVE_REQUEST_ID = 100;

// Membership ids: 5 = whoever is "the caller" for a given test (via mockSession/mockActiveMembership).
const DEPT_HEAD_MEMBERSHIP_ID = 6;
const UNRELATED_HEAD_MEMBERSHIP_ID = 7;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: ORG_ID,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  const applicationUserId = fixtures.sessionRows[0]
    ? (fixtures.sessionRows[0] as { session: { userId: number } }).session.userId
    : 1;
  // Replace any OTHER membership row for this same (user, org) — a stale
  // duplicate (e.g. left over from beforeEach's default membership 5) would
  // otherwise also match getActiveMembership's own (userId, orgId, active)
  // lookup and could win the `.limit(1)` race non-deterministically.
  const existing = fixtures.membershipRows.filter(
    (m) => m.id !== membershipId && !(m.applicationUserId === applicationUserId && m.organizationId === organizationId),
  );
  fixtures.membershipRows = [
    ...existing,
    { id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

/** Registers a membership (any applicationUserId) so it can be resolved as a Department Head by id, independent of who the current HTTP caller is. */
function registerMembership(membershipId: number, applicationUserId: number, organizationId = ORG_ID) {
  fixtures.membershipRows = [
    ...fixtures.membershipRows.filter((m) => m.id !== membershipId),
    { id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockLeaveModuleEnabled() {
  fixtures.moduleRows = [{ id: 1, key: "leave", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }];
}

/** Links the CALLER's own applicationUserId to an employee record — used for the self-approval-block tests. */
function mockCallerLinkedToEmployee(employeeId: number, applicationUserId = 1) {
  fixtures.employeeUserLinkRows = [
    ...fixtures.employeeUserLinkRows.filter((r) => r.applicationUserId !== applicationUserId),
    { employeeId, applicationUserId },
  ];
}

function mockEmployee(departmentId: number | null = DEPARTMENT_ID) {
  fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null, departmentId }];
}

function mockDepartmentHead(departmentId: number, headMembershipId: number, opts: { validTo?: Date | null; organizationId?: number } = {}) {
  fixtures.departmentHeadRows = [
    ...fixtures.departmentHeadRows,
    {
      id: nextId(departmentHeadsTable),
      organizationId: opts.organizationId ?? ORG_ID,
      departmentId,
      headMembershipId,
      validFrom: new Date(Date.now() - 86400000),
      validTo: opts.validTo ?? null,
    },
  ];
}

function mockPolicy(allowNegativeBalance = false) {
  fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual", status: "active" }];
  fixtures.leavePolicyRows = [{ id: LEAVE_POLICY_ID, organizationId: ORG_ID, leaveTypeId: LEAVE_TYPE_ID, status: "active", allowNegativeBalance }];
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  fixtures.leaveRequestRows = [
    {
      id: LEAVE_REQUEST_ID,
      organizationId: ORG_ID,
      employeeId: EMPLOYEE_ID,
      leaveTypeId: LEAVE_TYPE_ID,
      leavePolicyId: LEAVE_POLICY_ID,
      startDate: "2030-06-10",
      endDate: "2030-06-12",
      daysRequested: "3",
      status: "pending",
      reason: null,
      departmentHeadApprovedBy: null,
      departmentHeadApprovedAt: null,
      departmentHeadRejectedBy: null,
      departmentHeadRejectedAt: null,
      departmentHeadRejectionReason: null,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      ...overrides,
    },
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
  fixtures.departmentHeadRows = [];
  fixtures.leaveTypeRows = [];
  fixtures.leavePolicyRows = [];
  fixtures.leaveRequestRows = [];
  fixtures.leaveBalanceEntryRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();

  // Default: caller (userId 1, membership 5) is a plain employee with the
  // (universally-held) leave_request.approve permission but no actual
  // Department Head authority anywhere — the baseline every test overrides
  // from as needed.
  mockSession(1);
  mockActiveMembership(5);
  mockLeaveModuleEnabled();
  mockPermissions(["leave_request.approve"]);
  mockEmployee();
  mockPolicy();
});

const approveUrl = () => `/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/${LEAVE_REQUEST_ID}/approve`;
const rejectUrl = () => `/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/${LEAVE_REQUEST_ID}/reject`;
const pendingApprovalsUrl = () => `/api/organizations/${ORG_ID}/leave-requests/pending-approvals`;

describe("Stage 1 — Department Head approve/reject", () => {
  it("returns 403 when the caller merely holds leave_request.approve but is not the employee's Department Head (no HOD system bypass via permission alone)", async () => {
    mockRequest();
    // No department_heads row at all for DEPARTMENT_ID — caller has the
    // permission every employee holds, but no relationship-derived authority.
    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 for an unrelated Department Head (heads a different department)", async () => {
    registerMembership(UNRELATED_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(UNRELATED_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(OTHER_DEPARTMENT_ID, UNRELATED_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("the employee's actual current Department Head can approve, moving status to pending_hr", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_hr");
    expect(res.body.workflowStage).toBe("awaiting_hr");
    expect(res.body.departmentHeadApprovedBy).toBeTruthy();
    expect(fixtures.leaveBalanceEntryRows).toHaveLength(0); // no ledger posting yet — only final HR approval deducts
  });

  it("returns 403 for self-approval even when the requester happens to also be the resolved Department Head", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockCallerLinkedToEmployee(EMPLOYEE_ID, 1);
    mockRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("Department Head rejection without a reason fails with 400", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app).post(rejectUrl()).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
    expect(fixtures.leaveRequestRows[0].status).toBe("pending");
  });

  it("Department Head rejection with a reason succeeds — status rejected, reason on departmentHeadRejectionReason, never touching the HR-stage rejectionReason column", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app)
      .post(rejectUrl())
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "Team is understaffed this period" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.workflowStage).toBe("rejected_by_department_head");
    expect(res.body.departmentHeadRejectionReason).toBe("Team is understaffed this period");
    expect(res.body.rejectionReason).toBeFalsy();
    expect(res.body.departmentHeadRejectedBy).toBeTruthy();
  });

  it("HR (leave_request.manage) cannot act on a request still at the Department Head stage — final approval before Department Head approval is refused", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockRequest(); // status: pending — still awaiting Department Head

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(fixtures.leaveRequestRows[0].status).toBe("pending");
  });
});

describe("Stage 2 — HR final approve/reject", () => {
  function mockAtHrStage(overrides: Record<string, unknown> = {}) {
    mockRequest({
      status: "pending_hr",
      departmentHeadApprovedBy: 2,
      departmentHeadApprovedAt: new Date("2030-01-01T00:00:00Z"),
      ...overrides,
    });
  }

  it("returns 403 when the caller lacks leave_request.manage, even if they hold leave_request.approve", async () => {
    mockAtHrStage();
    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("HR approves and atomically posts the usage ledger entry only now, not at Department Head approval", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockAtHrStage();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "10.00", effectiveDate: "2030-01-01" },
    ];

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.workflowStage).toBe("approved");
    expect(res.body.approvedBy).toBeTruthy();
    // The Department Head's earlier decision is preserved, not overwritten.
    expect(res.body.departmentHeadApprovedBy).toBe(2);

    const usageEntries = fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage");
    expect(usageEntries).toHaveLength(1);
    expect(usageEntries[0]).toMatchObject({ relatedLeaveRequestId: LEAVE_REQUEST_ID, amount: "-3" });

    const auditInsert = fixtures.inserted.find((i) => (i.values as Record<string, unknown>).eventType === "leave_request.approved");
    expect(auditInsert).toBeTruthy();
  });

  it("returns 400 and rolls back when final approval would take the balance negative", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockPolicy(false);
    mockAtHrStage();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "1.00", effectiveDate: "2030-01-01" },
    ];

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(fixtures.leaveRequestRows[0].status).toBe("pending_hr");
    expect(fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage")).toHaveLength(0);
  });

  it("returns 409 on a second concurrent final approval and never double-deducts", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockPolicy(true);
    mockAtHrStage();

    const first = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    const second = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage")).toHaveLength(1);
  });

  it("HR rejection without a reason fails with 400", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockAtHrStage();
    const res = await request(app).post(rejectUrl()).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });

  it("HR rejection with a reason succeeds — status rejected, reason on rejectionReason, Department Head's earlier approval preserved", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockAtHrStage();

    const res = await request(app)
      .post(rejectUrl())
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "Budget freeze this quarter" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.workflowStage).toBe("rejected_by_hr");
    expect(res.body.rejectionReason).toBe("Budget freeze this quarter");
    expect(res.body.rejectedBy).toBeTruthy();
    expect(res.body.departmentHeadApprovedBy).toBe(2); // never overwritten
    expect(fixtures.leaveBalanceEntryRows).toHaveLength(0);
  });

  it("returns 409 when the request has already reached a terminal state", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockRequest({ status: "approved" });
    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(409);
  });

  it("returns 404 when the leave request does not exist", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    fixtures.leaveRequestRows = [];
    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("Department Head replacement", () => {
  it("the former Head can no longer approve once replaced; the new Head can", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    registerMembership(UNRELATED_HEAD_MEMBERSHIP_ID, 2);
    // Former head: closed row (validTo set). New head: open row.
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID, { validTo: new Date("2029-01-01T00:00:00Z") });
    mockDepartmentHead(DEPARTMENT_ID, UNRELATED_HEAD_MEMBERSHIP_ID);
    mockRequest();

    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    const formerHeadAttempt = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(formerHeadAttempt.status).toBe(403);
    expect(fixtures.leaveRequestRows[0].status).toBe("pending");

    mockSession(2);
    mockActiveMembership(UNRELATED_HEAD_MEMBERSHIP_ID);
    const newHeadAttempt = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(newHeadAttempt.status).toBe(200);
    expect(newHeadAttempt.body.status).toBe("pending_hr");
  });

  it("a request already approved by a since-replaced Head keeps showing that former Head as the approver", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const approveRes = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.departmentHeadApprovedBy).toBe(1);

    // Replace the Head now — close the old row, open a new one for someone else.
    fixtures.departmentHeadRows = fixtures.departmentHeadRows.map((r) =>
      r.headMembershipId === DEPT_HEAD_MEMBERSHIP_ID ? { ...r, validTo: new Date() } : r,
    );
    registerMembership(UNRELATED_HEAD_MEMBERSHIP_ID, 2);
    mockDepartmentHead(DEPARTMENT_ID, UNRELATED_HEAD_MEMBERSHIP_ID);

    // HR reads/finalizes afterward — the row still shows userId 1 as the Department Head approver.
    mockPolicy(true); // isolates this test from the balance-sufficiency check
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockSession(3);
    mockActiveMembership(9);
    const approveHr = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    expect(approveHr.status).toBe(200);
    expect(approveHr.body.departmentHeadApprovedBy).toBe(1);
  });
});

describe("GET .../leave-requests/pending-approvals", () => {
  it("HR (leave_request.manage) sees the request from the moment it is submitted, including while still awaiting the Department Head", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockRequest(); // status: pending — not yet acted on by the Department Head

    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("pending");
    expect(res.body[0].workflowStage).toBe("awaiting_department_head");
  });

  it("HR also sees requests already at the awaiting-HR stage", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockRequest({ status: "pending_hr", departmentHeadApprovedBy: 2, departmentHeadApprovedAt: new Date() });

    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].workflowStage).toBe("awaiting_hr");
  });

  it("a Department Head (no leave_request.manage) sees only pending requests from the department(s) they actually head", async () => {
    registerMembership(DEPT_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(DEPT_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(DEPARTMENT_ID, DEPT_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("returns an empty list for a caller with leave_request.approve but no Department Head authority anywhere", async () => {
    mockRequest();
    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("an unrelated Department Head (heads a different department) never sees this request", async () => {
    registerMembership(UNRELATED_HEAD_MEMBERSHIP_ID, 1);
    mockActiveMembership(UNRELATED_HEAD_MEMBERSHIP_ID);
    mockDepartmentHead(OTHER_DEPARTMENT_ID, UNRELATED_HEAD_MEMBERSHIP_ID);
    mockRequest();

    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("never leaks a request belonging to a different organization", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockRequest({ organizationId: OTHER_ORG_ID });

    const res = await request(app).get(pendingApprovalsUrl()).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
