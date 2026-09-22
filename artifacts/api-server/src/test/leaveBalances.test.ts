/**
 * Tests for the Leave Balance Engine (Phase 2B, W34). Route-level
 * authorization tiers (own/manager/org-wide) are exercised through
 * supertest, mirroring leaveRequests.test.ts's mock harness (real
 * field-based filtering via mockTable/Cond/matches, since a single request
 * can look up two different employees against the same `employees`
 * fixture). Ledger integrity — sign-direction validation and duplicate-post
 * translation to DuplicateLedgerEntryError — is exercised by calling
 * `postLedgerEntry` directly, since simulating a real Postgres unique-
 * constraint violation only matters at the service layer, not through HTTP.
 * No real database connection is made.
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
      forceDuplicateOnce: false,
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
    employeesTable: mockTable("employees", [
      "id",
      "organizationId",
      "employmentType",
      "branchId",
      "departmentId",
      "positionId",
      "gender",
      "hireDate",
      "employmentStatus",
      "reportingManagerId",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    leaveTypesTable: mockTable("leave_types", ["id", "organizationId", "name", "status"]),
    leavePoliciesTable: mockTable("leave_policies", ["id", "organizationId", "leaveTypeId", "status"]),
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "leaveTypeId", "leavePolicyId"]),
    leaveBalanceEntriesTable: mockTable("leave_balance_entries", [
      "id",
      "organizationId",
      "employeeId",
      "leaveTypeId",
      "leavePolicyId",
      "entryType",
      "amount",
      "effectiveDate",
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
  leaveTypesTable,
  leavePoliciesTable,
  leaveRequestsTable,
  leaveBalanceEntriesTable,
  auditEventsTable,
  db: {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
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

        let rows: Record<string, unknown>[] = [];
        if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === leaveTypesTable) rows = fixtures.leaveTypeRows;
        else if (table === leavePoliciesTable) rows = fixtures.leavePolicyRows;
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === leaveBalanceEntriesTable) rows = fixtures.leaveBalanceEntryRows;

        // A projected select() (e.g. `{leaveTypeId, amount}`) only needs
        // those fields on each returned row — narrowing here mirrors what a
        // real SQL projection would return, and getEmployeeBalances relies
        // on it not carrying every other column along.
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
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        if (table === leaveBalanceEntriesTable && fixtures.forceDuplicateOnce) {
          fixtures.forceDuplicateOnce = false;
          return { returning: () => Promise.reject({ code: "23505" }) };
        }
        const row = { id: nextId(table), createdAt: new Date(), ...v };
        if (table === leaveBalanceEntriesTable) fixtures.leaveBalanceEntryRows = [...fixtures.leaveBalanceEntryRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
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
const { postLedgerEntry, LeaveBalanceValidationError, DuplicateLedgerEntryError } = await import("../lib/leaveBalances");

const ORG_ID = 10;
const EMPLOYEE_ID = 42;
const OTHER_EMPLOYEE_ID = 43;
const LEAVE_TYPE_ID = 1;
const LEAVE_POLICY_ID = 1;

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

function mockOwnEmployeeLinked() {
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
}

function mockEligibleEmployee() {
  fixtures.employeeRows = [
    {
      id: EMPLOYEE_ID,
      organizationId: ORG_ID,
      firstName: "Ada",
      lastName: "Lovelace",
      employmentStatus: "active",
      employmentType: "full_time",
      branchId: null,
      departmentId: null,
      positionId: null,
      gender: "female",
      hireDate: new Date("2020-01-01"),
      reportingManagerId: null,
    },
  ];
}

function mockOrgWidePolicy() {
  fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual", code: "ANNUAL", status: "active" }];
  fixtures.leavePolicyRows = [
    {
      id: LEAVE_POLICY_ID,
      organizationId: ORG_ID,
      leaveTypeId: LEAVE_TYPE_ID,
      name: "Org-wide",
      status: "active",
      employmentType: null,
      branchId: null,
      departmentId: null,
      positionId: null,
      gender: null,
      minimumServiceMonths: null,
      probationRestricted: false,
      effectiveFrom: new Date("2020-01-01"),
      effectiveTo: null,
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
  fixtures.forceDuplicateOnce = false;
});

describe("GET /api/organizations/:organizationId/employees/:employeeId/leave-balances", () => {
  it("returns 403 when the leave module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("computes the available balance per leave type by summing the ledger", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "10.00", effectiveDate: "2026-01-01" },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "usage", amount: "-3.00", effectiveDate: "2026-02-01" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ leaveTypeId: LEAVE_TYPE_ID, leaveTypeName: "Annual", available: "7.00" }]);
  });

  it("returns 403 when viewing another employee's balances without manager or org-wide authority", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-balances`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows a manager to view a direct report's balances", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: EMPLOYEE_ID },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-balances`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("allows HR with leave_request.manage to view any employee's balances", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own", "leave_request.manage"]);
    mockLeaveModuleEnabled();
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [{ id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-balances`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });
});

describe("GET /api/organizations/:organizationId/employees/:employeeId/leave-balances/ledger", () => {
  it("returns your own ledger entries", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "10.00", effectiveDate: "2026-01-01" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/ledger`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("filters ledger entries by leaveTypeId when provided", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "10.00", effectiveDate: "2026-01-01" },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: 2, leavePolicyId: LEAVE_POLICY_ID, entryType: "opening_balance", amount: "5.00", effectiveDate: "2026-01-01" },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/ledger?leaveTypeId=${LEAVE_TYPE_ID}`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].leaveTypeId).toBe(LEAVE_TYPE_ID);
  });

  it("returns 403 without manager or org-wide authority", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-balances/ledger`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/leave-balances/adjust", () => {
  it("returns 403 when the caller only has leave_request.write.own", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own", "leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2, effectiveDate: "2026-03-01", reason: "Correction" });

    expect(res.status).toBe(403);
  });

  it("returns 400 when reason is empty", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.manage"]);
    mockLeaveModuleEnabled();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2, effectiveDate: "2026-03-01", reason: "" });

    expect(res.status).toBe(400);
  });

  it("posts a manual adjustment as a new signed ledger entry and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.manage"]);
    mockLeaveModuleEnabled();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2.5, effectiveDate: "2026-03-01", reason: "Goodwill correction" });

    expect(res.status).toBe(201);
    expect(res.body.entryType).toBe("manual_adjustment");
    expect(res.body.amount).toBe("2.5");
    expect(res.body.leavePolicyId).toBe(LEAVE_POLICY_ID);
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_balance.manual_adjustment");
  });

  it("returns 400 when the employee is not eligible for any policy under the leave type", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.manage"]);
    mockLeaveModuleEnabled();
    mockEligibleEmployee();
    fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual", status: "active" }];
    fixtures.leavePolicyRows = [];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2, effectiveDate: "2026-03-01", reason: "Correction" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when the employee does not exist in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.manage"]);
    mockLeaveModuleEnabled();
    fixtures.employeeRows = [];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2, effectiveDate: "2026-03-01", reason: "Correction" });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the ledger insert hits a duplicate-key conflict", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.manage"]);
    mockLeaveModuleEnabled();
    mockEligibleEmployee();
    mockOrgWidePolicy();
    fixtures.forceDuplicateOnce = true;

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-balances/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, amount: 2, effectiveDate: "2026-03-01", reason: "Correction" });

    expect(res.status).toBe(409);
  });
});

describe("postLedgerEntry (ledger integrity, direct)", () => {
  beforeEach(() => {
    mockEligibleEmployee();
    mockOrgWidePolicy();
  });

  it("rejects a zero amount", async () => {
    await expect(
      postLedgerEntry({ organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, entryType: "accrual", amount: 0, effectiveDate: "2026-01-01" }),
    ).rejects.toBeInstanceOf(LeaveBalanceValidationError);
  });

  it("rejects a non-positive amount for a credit entry type (accrual)", async () => {
    await expect(
      postLedgerEntry({ organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, entryType: "accrual", amount: -1, effectiveDate: "2026-01-01" }),
    ).rejects.toBeInstanceOf(LeaveBalanceValidationError);
  });

  it("rejects a non-negative amount for a debit entry type (usage)", async () => {
    await expect(
      postLedgerEntry({ organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, entryType: "usage", amount: 1, effectiveDate: "2026-01-01" }),
    ).rejects.toBeInstanceOf(LeaveBalanceValidationError);
  });

  it("posts a valid accrual entry with the server-resolved policy", async () => {
    const entry = await postLedgerEntry({
      organizationId: ORG_ID,
      employeeId: EMPLOYEE_ID,
      leaveTypeId: LEAVE_TYPE_ID,
      entryType: "accrual",
      amount: 1.5,
      effectiveDate: "2026-01-01",
      sourceReference: "accrual:2026-01",
    });
    expect(entry.leavePolicyId).toBe(LEAVE_POLICY_ID);
    expect(entry.amount).toBe("1.5");
  });

  it("translates a unique-constraint violation into DuplicateLedgerEntryError instead of double-posting", async () => {
    fixtures.forceDuplicateOnce = true;
    await expect(
      postLedgerEntry({
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        leaveTypeId: LEAVE_TYPE_ID,
        entryType: "accrual",
        amount: 1,
        effectiveDate: "2026-01-01",
        sourceReference: "accrual:2026-01",
      }),
    ).rejects.toBeInstanceOf(DuplicateLedgerEntryError);
  });

  it("rejects a cross-tenant employee reference", async () => {
    fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: 999, reportingManagerId: null }];
    await expect(
      postLedgerEntry({ organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, entryType: "accrual", amount: 1, effectiveDate: "2026-01-01" }),
    ).rejects.toBeInstanceOf(LeaveBalanceValidationError);
  });
});
