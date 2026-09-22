/**
 * Integration tests for Leave Requests (Phase 2B, W33), exercising the real
 * requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. @workspace/db is mocked with real field-based
 * filtering (mirrors organizationStructure.test.ts's Cond-matcher pattern)
 * since a single request can look up two different employees (caller vs
 * target) against the same table — a fixture-array-only mock can't
 * distinguish them. No real database connection is made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  employeeDocumentsTable,
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
      leavePolicyRows: [] as Record<string, unknown>[],
      leaveRequestRows: [] as Record<string, unknown>[],
      employeeDocumentRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["key"]),
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
    leaveTypesTable: mockTable("leave_types", ["id", "organizationId", "status"]),
    leavePoliciesTable: mockTable("leave_policies", ["id", "organizationId", "leaveTypeId", "status"]),
    leaveRequestsTable: mockTable("leave_requests", ["id", "organizationId", "employeeId", "startDate", "endDate", "status"]),
    employeeDocumentsTable: mockTable("employee_documents", ["id", "organizationId", "employeeId"]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status", "recurring", "date", "observedDate"]),
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
  employeeDocumentsTable,
  publicHolidaysTable,
  auditEventsTable,
  db: {
    select: () => ({
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

        // These fixtures represent an already-joined/selected final shape
        // (e.g. permissionRows is `{key}`, not a raw role_permissions row),
        // same shortcut employees.test.ts/leaveTypes.test.ts use — real
        // field filtering would break them, so they pass through unfiltered.
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

        // Everything below has fixtures shaped as real rows with real
        // column names, so `.where()` genuinely filters — required here
        // because a single request can look up two different employees
        // (caller vs target) against the same `employees` fixture array.
        let rows: Record<string, unknown>[] = [];
        if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === leaveTypesTable) rows = fixtures.leaveTypeRows;
        else if (table === leavePoliciesTable) rows = fixtures.leavePolicyRows;
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === employeeDocumentsTable) rows = fixtures.employeeDocumentRows;
        else if (table === publicHolidaysTable) rows = fixtures.publicHolidayRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          orderBy: () => Promise.resolve(filtered),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "pending", ...v };
        if (table === leaveRequestsTable) fixtures.leaveRequestRows = [...fixtures.leaveRequestRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          const base = table === leaveRequestsTable ? fixtures.leaveRequestRows[0] : undefined;
          return { returning: () => Promise.resolve(base ? [{ ...base, ...v }] : []) };
        },
      }),
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
      countWeekends: false,
      countPublicHolidays: false,
      attachmentRequired: false,
      minRequestDurationDays: null,
      maxRequestDurationDays: null,
      noticePeriodDays: null,
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
  fixtures.employeeDocumentRows = [];
  fixtures.publicHolidayRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/leave-requests", () => {
  it("returns 403 when the leave module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when submitting for another employee", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(403);
  });

  it("creates a leave request with server-computed days and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    // Mon 2030-06-10 through Wed 2030-06-12 = 3 weekdays, no weekend in range.
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(201);
    expect(res.body.daysRequested).toBe("3");
    expect(res.body.leavePolicyId).toBe(LEAVE_POLICY_ID);
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_request.submitted");
  });

  it("excludes weekends from the day count when the policy doesn't count them", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    // Fri 2030-06-14 through Mon 2030-06-17 = Fri, Mon = 2 weekdays (Sat/Sun excluded).
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-14", endDate: "2030-06-17" });

    expect(res.status).toBe(201);
    expect(res.body.daysRequested).toBe("2");
  });

  it("excludes an active public holiday from the day count when the policy doesn't count them (W37)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();
    // Wed 2030-06-12 is a public holiday within Mon 2030-06-10 – Wed 2030-06-12.
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, status: "active", recurring: false, date: "2030-06-12", observedDate: null },
    ];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(201);
    expect(res.body.daysRequested).toBe("2");
  });

  it("does not double-subtract a day that is both a weekend and a public holiday", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();
    // Fri 2030-06-14 through Mon 2030-06-17: Sat 06-15 is both a weekend and
    // a holiday. If it were double-subtracted the count would go to 1 or
    // negative instead of the correct 2 (Fri, Mon).
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, status: "active", recurring: false, date: "2030-06-15", observedDate: null },
    ];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-14", endDate: "2030-06-17" });

    expect(res.status).toBe(201);
    expect(res.body.daysRequested).toBe("2");
  });

  it("returns 400 when no policy under the leave type is eligible for the employee", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveTypeRows = [{ id: LEAVE_TYPE_ID, organizationId: ORG_ID, name: "Annual", code: "ANNUAL", status: "active" }];
    fixtures.leavePolicyRows = [
      {
        id: LEAVE_POLICY_ID,
        organizationId: ORG_ID,
        leaveTypeId: LEAVE_TYPE_ID,
        name: "Part-time only",
        status: "active",
        employmentType: "part_time",
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

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when an overlapping pending/approved request already exists", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, startDate: "2030-06-11", endDate: "2030-06-13", status: "pending" },
    ];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-10", endDate: "2030-06-12" });

    expect(res.status).toBe(400);
  });

  it("returns 400 when start date is after end date", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockOrgWidePolicy();

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-12", endDate: "2030-06-10" });

    expect(res.status).toBe(400);
  });
});

describe("POST .../leave-requests — notice period (Phase 3H, W117, frozen plan Decision 11)", () => {
  // "Today" is pinned to Mon 2030-06-10 (the same reference Monday already
  // used throughout this file's other date-math tests) so working-day/
  // holiday boundaries are deterministic instead of depending on the real
  // clock at test-run time.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-06-10T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockPolicyWithNotice(overrides: Record<string, unknown> = {}) {
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
        countWeekends: false,
        countPublicHolidays: false,
        attachmentRequired: false,
        minRequestDurationDays: null,
        maxRequestDurationDays: null,
        noticePeriodDays: 5,
        effectiveFrom: new Date("2020-01-01"),
        effectiveTo: null,
        ...overrides,
      },
    ];
  }

  it("preserves calendar-day notice-period behavior when noticePeriodCountsWorkingDaysOnly is unset (existing policy default)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockPolicyWithNotice(); // noticePeriodCountsWorkingDaysOnly not present, mirrors a pre-W117 DB row (null)

    // Earliest allowed = 2030-06-10 + 5 calendar days = 2030-06-15.
    const tooSoon = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-14", endDate: "2030-06-16" });
    expect(tooSoon.status).toBe(400);

    const exact = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-15", endDate: "2030-06-17" });
    expect(exact.status).toBe(201);
  });

  it("counts only working days when noticePeriodCountsWorkingDaysOnly is true", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockPolicyWithNotice({ noticePeriodCountsWorkingDaysOnly: true });

    // Earliest allowed = 2030-06-10 + 5 working days (weekends skipped) = 2030-06-17.
    const belowThreshold = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-16", endDate: "2030-06-18" });
    expect(belowThreshold.status).toBe(400);

    const exactBoundary = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-17", endDate: "2030-06-19" });
    expect(exactBoundary.status).toBe(201);
  });

  it("also skips public holidays in working-day mode, reusing resolveHolidayDatesInRange", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    mockPolicyWithNotice({ noticePeriodCountsWorkingDaysOnly: true });
    // Wed 2030-06-12 is a holiday, pushing the working-day boundary out by one: 2030-06-18.
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, status: "active", recurring: false, date: "2030-06-12", observedDate: null },
    ];

    const tooSoon = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-17", endDate: "2030-06-19" });
    expect(tooSoon.status).toBe(400);

    const onBoundary = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token")
      .send({ leaveTypeId: LEAVE_TYPE_ID, startDate: "2030-06-18", endDate: "2030-06-20" });
    expect(onBoundary.status).toBe(201);
  });
});

describe("GET /api/organizations/:organizationId/employees/:employeeId/leave-requests", () => {
  it("allows viewing your own leave requests", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "pending" }];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 403 when viewing another employee's requests without manager or org-wide authority", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Bob", lastName: "Smith", reportingManagerId: null },
    ];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows a manager to view a direct report's requests", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    fixtures.employeeRows = [
      { id: EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Bob", lastName: "Smith", reportingManagerId: EMPLOYEE_ID },
    ];
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, status: "pending" }];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("allows HR with leave_request.manage to view any employee's requests", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.read.own", "leave_request.manage"]);
    mockLeaveModuleEnabled();
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [
      { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Bob", lastName: "Smith", reportingManagerId: null },
    ];
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: OTHER_EMPLOYEE_ID, status: "pending" }];

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/employees/${OTHER_EMPLOYEE_ID}/leave-requests`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/leave-requests/:id/cancel", () => {
  it("withdraws a pending request", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "pending" }];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/1/cancel`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_request.cancelled");
  });

  it("returns 400 when the request is not pending", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveRequestRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "approved" }];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/1/cancel`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
  });

  it("returns 404 when the request does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_request.write.own"]);
    mockLeaveModuleEnabled();
    mockOwnEmployeeLinked();
    mockEligibleEmployee();
    fixtures.leaveRequestRows = [];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${EMPLOYEE_ID}/leave-requests/99/cancel`)
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});
