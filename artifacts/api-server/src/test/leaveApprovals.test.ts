/**
 * Tests for the Leave Approval Workflow (Phase 2B, W35). @workspace/db is
 * mocked with real field-based filtering (mirrors leaveRequests.test.ts /
 * leaveBalances.test.ts's mockTable/Cond/matches pattern), extended with a
 * `db.transaction` mock that snapshots the mutable fixture arrays and
 * restores them on a thrown error — the only way to genuinely exercise
 * "an insufficient-balance throw rolls back the status update too" without
 * a real Postgres transaction. The `(relatedLeaveRequestId, entryType)`
 * unique index is also simulated in the insert mock, so a second usage
 * post for the same request is rejected exactly like Postgres would. No
 * real database connection is made.
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
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
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "reportingManagerId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
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

  // Simulates the real (relatedLeaveRequestId, entryType) partial unique
  // index — a second usage/reversal post for the same request fails here
  // exactly like it would against Postgres.
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
  leaveTypesTable,
  leavePoliciesTable,
  leaveRequestsTable,
  leaveBalanceEntriesTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => {
      // Snapshot every mutable fixture array touched inside a transaction so
      // a thrown error (e.g. insufficient balance) can be rolled back —
      // real atomicity, not just "the callback ran."
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
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const EMPLOYEE_ID = 42;
const MANAGER_EMPLOYEE_ID = 7;
const OTHER_MANAGER_EMPLOYEE_ID = 8;
const LEAVE_TYPE_ID = 1;
const LEAVE_POLICY_ID = 1;
const LEAVE_REQUEST_ID = 100;

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
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
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

function mockManagerLinked(managerEmployeeId = MANAGER_EMPLOYEE_ID) {
  fixtures.employeeUserLinkRows = [{ employeeId: managerEmployeeId, applicationUserId: 1 }];
}

function mockEmployees(reportingManagerId: number | null = MANAGER_EMPLOYEE_ID) {
  fixtures.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId },
    { id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
    { id: OTHER_MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
  ];
}

function mockPolicy(allowNegativeBalance = false) {
  fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual", status: "active" }];
  fixtures.leavePolicyRows = [{ id: LEAVE_POLICY_ID, organizationId: ORG_ID, leaveTypeId: LEAVE_TYPE_ID, status: "active", allowNegativeBalance }];
}

function mockPendingRequest(overrides: Record<string, unknown> = {}) {
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
  fixtures.leaveTypeRows = [];
  fixtures.leavePolicyRows = [];
  fixtures.leaveRequestRows = [];
  fixtures.leaveBalanceEntryRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockLeaveModuleEnabled();
  mockPermissions(["leave_request.approve"]);
  mockManagerLinked();
  mockEmployees();
  mockPolicy();
});

const approveUrl = () => `/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/${LEAVE_REQUEST_ID}/approve`;
const rejectUrl = () => `/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/${LEAVE_REQUEST_ID}/reject`;

describe("POST .../leave-requests/:id/approve", () => {
  it("approves a pending request and atomically posts the usage ledger entry", async () => {
    mockPendingRequest();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "10.00", effectiveDate: "2030-01-01" },
    ];

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedBy).toBeTruthy();

    const usageEntries = fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage");
    expect(usageEntries).toHaveLength(1);
    expect(usageEntries[0]).toMatchObject({ relatedLeaveRequestId: LEAVE_REQUEST_ID, amount: "-3" });

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_request.approved");
  });

  it("returns 403 for self-approval", async () => {
    mockManagerLinked(EMPLOYEE_ID); // the caller's own linked employee IS the request's employee
    mockPendingRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller is neither the employee's manager nor org-wide authorized", async () => {
    mockManagerLinked(OTHER_MANAGER_EMPLOYEE_ID); // not this employee's reportingManagerId
    mockPendingRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows an org-wide HR holder (leave_request.manage) to approve regardless of reporting line", async () => {
    mockManagerLinked(OTHER_MANAGER_EMPLOYEE_ID);
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    mockPolicy(true); // isolates this authorization test from the balance-sufficiency check
    mockPendingRequest();

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("returns 409 when the request is already approved", async () => {
    mockPendingRequest({ status: "approved" });

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("returns 409 on a second concurrent approval and never double-deducts the ledger", async () => {
    mockPolicy(true); // allowNegativeBalance — isolates this test from the balance check
    mockPendingRequest();

    const first = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");
    const second = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage")).toHaveLength(1);
  });

  it("returns 400 and rolls back the status change when approving would take the balance negative", async () => {
    mockPolicy(false);
    mockPendingRequest();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "1.00", effectiveDate: "2030-01-01" },
    ];

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
    expect(fixtures.leaveRequestRows[0].status).toBe("pending");
    expect(fixtures.leaveBalanceEntryRows.filter((e) => e.entryType === "usage")).toHaveLength(0);
  });

  it("returns 404 when the leave request does not exist", async () => {
    fixtures.leaveRequestRows = [];

    const res = await request(app).post(approveUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});

describe("POST .../leave-requests/:id/reject", () => {
  it("rejects a pending request, records the reason, and posts no ledger entry", async () => {
    mockPendingRequest();

    const res = await request(app)
      .post(rejectUrl())
      .set("Authorization", "Bearer valid-token")
      .send({ reason: "Insufficient staffing coverage" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.rejectionReason).toBe("Insufficient staffing coverage");
    expect(fixtures.leaveBalanceEntryRows).toHaveLength(0);

    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_request.rejected");
  });

  it("returns 403 for self-rejection", async () => {
    mockManagerLinked(EMPLOYEE_ID);
    mockPendingRequest();

    const res = await request(app).post(rejectUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 409 when the request has already been decided", async () => {
    mockPendingRequest({ status: "rejected" });

    const res = await request(app).post(rejectUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(409);
  });

  it("returns 404 when the leave request does not exist", async () => {
    fixtures.leaveRequestRows = [];

    const res = await request(app).post(rejectUrl()).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});

describe("GET .../leave-requests/pending-approvals", () => {
  it("scopes to direct reports only for a manager without org-wide authority", async () => {
    mockPendingRequest();

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/leave-requests/pending-approvals`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("returns an empty list for a caller with no direct reports and no org-wide authority", async () => {
    mockManagerLinked(OTHER_MANAGER_EMPLOYEE_ID);
    mockPendingRequest();

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/leave-requests/pending-approvals`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("returns every pending request org-wide for leave_request.manage holders", async () => {
    mockPermissions(["leave_request.approve", "leave_request.manage"]);
    fixtures.employeeUserLinkRows = [];
    mockPendingRequest();

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/leave-requests/pending-approvals`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
