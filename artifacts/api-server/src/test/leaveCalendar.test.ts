/**
 * Tests for the Leave Calendar (Phase 2B, W36) — a read model over
 * leave_requests. @workspace/db is mocked with real field-based filtering
 * (mirrors leaveRequests.test.ts/leaveApprovals.test.ts's mockTable/Cond/
 * matches pattern). No real database connection is made.
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
  leaveRequestsTable,
  publicHolidaysTable,
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
      leaveRequestRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "departmentId", "branchId", "reportingManagerId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    leaveTypesTable: mockTable("leave_types", ["id", "organizationId", "name"]),
    leaveRequestsTable: mockTable("leave_requests", [
      "id",
      "organizationId",
      "employeeId",
      "leaveTypeId",
      "startDate",
      "endDate",
      "daysRequested",
      "status",
      "reason",
    ]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status", "recurring", "date", "observedDate", "name"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  leaveTypesTable,
  leaveRequestsTable,
  publicHolidaysTable,
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
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === publicHolidaysTable) rows = fixtures.publicHolidayRows;

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
const OTHER_EMPLOYEE_ID = 43;
const LEAVE_TYPE_ID = 1;
const DEPT_ID = 200;

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

function mockEmployees() {
  fixtures.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ada", lastName: "Lovelace", departmentId: DEPT_ID, branchId: null, reportingManagerId: MANAGER_EMPLOYEE_ID },
    { id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Mia", lastName: "Manager", departmentId: null, branchId: null, reportingManagerId: null },
    { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Bob", lastName: "Smith", departmentId: null, branchId: null, reportingManagerId: null },
  ];
  fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual" }];
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
  fixtures.leaveRequestRows = [];
  fixtures.publicHolidayRows = [];

  mockSession();
  mockActiveMembership();
  mockLeaveModuleEnabled();
  mockPermissions(["leave_request.read.own"]);
  mockManagerLinked();
  mockEmployees();
});

const calendarUrl = (qs: string) => `/api/organizations/${ORG_ID}/leave-calendar${qs}`;

describe("GET /api/organizations/:organizationId/leave-calendar", () => {
  it("returns 400 when from/to are missing or malformed", async () => {
    const res = await request(app).get(calendarUrl("")).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);

    const res2 = await request(app).get(calendarUrl("?from=2030-06-01&to=not-a-date")).set("Authorization", "Bearer valid-token");
    expect(res2.status).toBe(400);
  });

  it("returns 400 when the range exceeds 100 days", async () => {
    const res = await request(app)
      .get(calendarUrl("?from=2030-01-01&to=2030-12-31"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
  });

  it("returns only approved requests overlapping the range, excluding pending/rejected/cancelled", async () => {
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: "Confidential family matter" },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-14", endDate: "2030-06-15", daysRequested: "2", status: "pending", reason: null },
      { id: 3, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-16", endDate: "2030-06-17", daysRequested: "2", status: "rejected", reason: null },
      { id: 4, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-18", endDate: "2030-06-19", daysRequested: "2", status: "cancelled", reason: null },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(1);
    expect(res.body.leaveEntries[0].id).toBe(1);
  });

  it("never exposes the confidential request reason", async () => {
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: "Confidential family matter" },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries[0]).not.toHaveProperty("reason");
    expect(res.body.leaveEntries[0]).toMatchObject({ employeeName: "Ada Lovelace", leaveTypeName: "Annual" });
  });

  it("scopes a manager (without org-wide authority) to their own leave plus direct reports only", async () => {
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: null },
      { id: 2, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-11", endDate: "2030-06-13", daysRequested: "3", status: "approved", reason: null },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(1);
    expect(res.body.leaveEntries[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("returns an empty list for a caller with no direct reports and no org-wide authority", async () => {
    mockManagerLinked(OTHER_EMPLOYEE_ID); // no reports of their own
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: null },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(0);
  });

  it("returns every approved request org-wide for leave_request.manage holders", async () => {
    mockPermissions(["leave_request.read.own", "leave_request.manage"]);
    fixtures.employeeUserLinkRows = [];
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: null },
      { id: 2, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-11", endDate: "2030-06-13", daysRequested: "3", status: "approved", reason: null },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(2);
  });

  it("filters by departmentId", async () => {
    mockPermissions(["leave_request.read.own", "leave_request.manage"]);
    fixtures.employeeUserLinkRows = [];
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: null }, // EMPLOYEE_ID is in DEPT_ID
      { id: 2, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-11", endDate: "2030-06-13", daysRequested: "3", status: "approved", reason: null }, // no department
    ];

    const res = await request(app)
      .get(calendarUrl(`?from=2030-06-01&to=2030-06-30&departmentId=${DEPT_ID}`))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(1);
    expect(res.body.leaveEntries[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("overlays holidays as a separate, distinct list from leave entries", async () => {
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12", daysRequested: "3", status: "approved", reason: null },
    ];
    fixtures.publicHolidayRows = [
      { id: 9, organizationId: ORG_ID, status: "active", recurring: false, date: "2030-06-15", observedDate: null, name: "Founders Day" },
      { id: 10, organizationId: ORG_ID, status: "inactive", recurring: false, date: "2030-06-20", observedDate: null, name: "Retired Holiday" },
    ];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveEntries).toHaveLength(1);
    expect(res.body.holidays).toEqual([{ id: 9, name: "Founders Day", date: "2030-06-15" }]);
  });

  it("returns 403 when the leave module is not enabled", async () => {
    fixtures.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];

    const res = await request(app)
      .get(calendarUrl("?from=2030-06-01&to=2030-06-30"))
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});
