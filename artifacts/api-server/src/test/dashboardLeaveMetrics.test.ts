/**
 * Integration tests for GET /dashboard/summary's leaveMetrics (Phase 2B,
 * W40 — HR Operations Dashboard), exercising the real requireAuth chain
 * through supertest, mirroring leaveRequests.test.ts's harness style.
 * @workspace/db is mocked with real field-based filtering — no real
 * database connection is made. The dashboard route itself has no
 * membership/module/permission middleware (frozen plan: "reuses the
 * existing dashboard-summary gating") — scoping happens inside the handler,
 * so these tests exercise that internal logic end-to-end via HTTP.
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
  leaveRequestsTable,
  leaveBalanceEntriesTable,
  leavePoliciesTable,
  publicHolidaysTable,
  notificationsTable,
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
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      leaveRequestRows: [] as Record<string, unknown>[],
      leaveBalanceEntryRows: [] as Record<string, unknown>[],
      leavePolicyRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
      notificationRows: [] as Record<string, unknown>[],
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
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "headMembershipId", "validTo"]),
    leaveRequestsTable: mockTable("leave_requests", [
      "id",
      "organizationId",
      "employeeId",
      "leavePolicyId",
      "startDate",
      "endDate",
      "status",
    ]),
    leaveBalanceEntriesTable: mockTable("leave_balance_entries", [
      "id",
      "organizationId",
      "employeeId",
      "leavePolicyId",
      "entryType",
      "amount",
      "effectiveDate",
    ]),
    leavePoliciesTable: mockTable("leave_policies", ["id", "carryForwardAllowed", "carryForwardExpiryMonths"]),
    publicHolidaysTable: mockTable("public_holidays", ["id", "organizationId", "status", "recurring", "date", "observedDate", "name"]),
    notificationsTable: mockTable("notifications", ["userId", "read"]),
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
  departmentHeadsTable,
  leaveRequestsTable,
  leaveBalanceEntriesTable,
  leavePoliciesTable,
  publicHolidaysTable,
  notificationsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        // modules/organizationModules/membershipRoles/rolePermissions mirror
        // leaveTypes.test.ts's precedent: an unfiltered passthrough is
        // correct for single-organization/single-membership tests.
        const unfiltered =
          table === modulesTable
            ? fixtures.moduleRows
            : table === organizationModulesTable
              ? fixtures.organizationModuleRows
              : table === membershipRolesTable
                ? fixtures.membershipRoleRows
                : table === rolePermissionsTable
                  ? fixtures.permissionRows
                  : undefined;
        if (unfiltered !== undefined) {
          const rows = unfiltered as unknown[];
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === departmentHeadsTable) rows = []; // no dept-head-scoped test in this file needs a non-empty result
        else if (table === leaveRequestsTable) rows = fixtures.leaveRequestRows;
        else if (table === leaveBalanceEntriesTable) rows = fixtures.leaveBalanceEntryRows;
        else if (table === leavePoliciesTable) rows = fixtures.leavePolicyRows;
        else if (table === publicHolidaysTable) rows = fixtures.publicHolidayRows;
        else if (table === notificationsTable) rows = fixtures.notificationRows;

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
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  // resolveActiveOrganizationId's fallback (lib/membership.ts) also composes
  // or/isNull/gt for its active-and-unexpired check; not otherwise exercised
  // by these tests (fixtures are already constructed active/unexpired), so
  // these are always-true passthroughs, same precedent as leaveRequests.test.ts.
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const HR_EMPLOYEE_ID = 1;
const MANAGER_EMPLOYEE_ID = 2;
const REPORT_EMPLOYEE_ID = 3;
const OTHER_ORG_EMPLOYEE_ID = 99;

function mockSession(userId = 1, activeOrganizationId: number | null = ORG_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000), activeOrganizationId },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: activeOrganizationId, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function mockLeaveModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "leave", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function mockHrAdmin() {
  fixtures.membershipRoleRows = [{ membershipId: 5, roleId: 1 }];
  fixtures.permissionRows = [{ roleId: 1, key: "leave_request.manage" }, { roleId: 1, key: "leave_request.approve" }];
}

function mockManager() {
  fixtures.membershipRoleRows = [{ membershipId: 5, roleId: 1 }];
  fixtures.permissionRows = [{ roleId: 1, key: "leave_request.approve" }];
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
  fixtures.leaveRequestRows = [];
  fixtures.leaveBalanceEntryRows = [];
  fixtures.leavePolicyRows = [];
  fixtures.publicHolidayRows = [];
  fixtures.notificationRows = [];
});

describe("GET /api/dashboard/summary — leaveMetrics (W40)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(401);
  });

  it("is null when the leave module is disabled for the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(false);
    mockHrAdmin();

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics).toBeNull();
  });

  it("is null (not zero-filled) when there is no active organization membership at all", async () => {
    mockSession(1, null);
    fixtures.membershipRows = [];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics).toBeNull();
  });

  it("returns all-zero, non-null metrics for an organization with the module enabled but no leave data yet", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics).toEqual({
      employeesOnLeave: 0,
      upcomingApprovedLeave: 0,
      pendingApprovalCount: 0,
      upcomingPublicHolidays: 0,
      leaveUtilizationPercent: 0,
      expiringCarryForwardBalances: 0,
      requestsByStatus: { pending: 0, pending_hr: 0, approved: 0, rejected: 0, cancelled: 0 },
    });
  });

  it("an HR admin (leave_request.manage) sees org-wide figures, including another manager's team", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();
    fixtures.employeeUserLinkRows = [{ employeeId: HR_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [
      { id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: REPORT_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID },
    ];
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_EMPLOYEE_ID, leavePolicyId: 1, startDate: "2020-01-01", endDate: "2099-01-01", status: "approved" },
      { id: 2, organizationId: ORG_ID, employeeId: REPORT_EMPLOYEE_ID, leavePolicyId: 1, status: "pending", startDate: "2099-01-01", endDate: "2099-01-02" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    // Sees the report's on-going approved leave even though the caller (HR
    // admin) isn't that employee's manager — org-wide reach.
    expect(res.body.leaveMetrics.employeesOnLeave).toBe(1);
    expect(res.body.leaveMetrics.requestsByStatus).toEqual({ pending: 1, pending_hr: 0, approved: 1, rejected: 0, cancelled: 0 });
  });

  it("a manager without leave_request.manage sees only their own + direct reports' figures, not another team's", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockManager();
    fixtures.employeeUserLinkRows = [{ employeeId: MANAGER_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [
      { id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null },
      { id: REPORT_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID },
      // Belongs to a different manager entirely — must never be counted.
      { id: OTHER_ORG_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: HR_EMPLOYEE_ID },
    ];
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: REPORT_EMPLOYEE_ID, leavePolicyId: 1, startDate: "2020-01-01", endDate: "2099-01-01", status: "approved" },
      { id: 2, organizationId: ORG_ID, employeeId: OTHER_ORG_EMPLOYEE_ID, leavePolicyId: 1, startDate: "2020-01-01", endDate: "2099-01-01", status: "approved" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    // Only the manager's own direct report counts, not the other manager's.
    expect(res.body.leaveMetrics.employeesOnLeave).toBe(1);
  });

  it("computes leaveUtilizationPercent from the ledger (usage / credited)", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();
    fixtures.employeeUserLinkRows = [{ employeeId: HR_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [{ id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];
    fixtures.leaveBalanceEntryRows = [
      { id: 1, organizationId: ORG_ID, employeeId: HR_EMPLOYEE_ID, leavePolicyId: 1, entryType: "opening_balance", amount: "20.00", effectiveDate: "2026-01-01" },
      { id: 2, organizationId: ORG_ID, employeeId: HR_EMPLOYEE_ID, leavePolicyId: 1, entryType: "usage", amount: "-5.00", effectiveDate: "2026-02-01" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics.leaveUtilizationPercent).toBe(25);
  });

  it("counts an expiring carry-forward balance only under a policy that actually supports carry-forward expiry", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();
    fixtures.employeeUserLinkRows = [{ employeeId: HR_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [{ id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];
    // Chosen so effectiveDate + 1 month lands exactly 5 days from today,
    // safely inside the 30-day window regardless of the current month's
    // length (a plain "today" + "1 month" can be 28-31 days out, which is
    // too close to the 30-day boundary to be a reliable test fixture).
    const targetExpiry = new Date();
    targetExpiry.setUTCDate(targetExpiry.getUTCDate() + 5);
    const effectiveDateObj = new Date(targetExpiry);
    effectiveDateObj.setUTCMonth(effectiveDateObj.getUTCMonth() - 1);
    const effectiveDate = effectiveDateObj.toISOString().slice(0, 10);
    fixtures.leaveBalanceEntryRows = [
      // Policy 1 supports expiry (1 month out) — lands inside the 30-day
      // upcoming window used here.
      { id: 1, organizationId: ORG_ID, employeeId: HR_EMPLOYEE_ID, leavePolicyId: 1, entryType: "carry_forward", amount: "3.00", effectiveDate },
      // Policy 2 allows carry-forward but has no expiry configured — must
      // never be counted as "expiring".
      { id: 2, organizationId: ORG_ID, employeeId: HR_EMPLOYEE_ID, leavePolicyId: 2, entryType: "carry_forward", amount: "3.00", effectiveDate },
    ];
    fixtures.leavePolicyRows = [
      { id: 1, carryForwardAllowed: true, carryForwardExpiryMonths: 1 },
      { id: 2, carryForwardAllowed: true, carryForwardExpiryMonths: null },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics.expiringCarryForwardBalances).toBe(1);
  });

  it("counts upcoming public holidays org-wide, independent of employee scope", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockManager();
    fixtures.employeeUserLinkRows = [{ employeeId: MANAGER_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [{ id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];
    const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, status: "active", recurring: false, date: inTenDays, observedDate: null, name: "Founders Day" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics.upcomingPublicHolidays).toBe(1);
  });

  it("does not leak another organization's leave data into the summary", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();
    fixtures.employeeUserLinkRows = [{ employeeId: HR_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [{ id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];
    fixtures.leaveRequestRows = [
      // A different organization's request — must never be counted.
      { id: 1, organizationId: 999, employeeId: 500, leavePolicyId: 1, startDate: "2020-01-01", endDate: "2099-01-01", status: "approved" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.leaveMetrics.employeesOnLeave).toBe(0);
    expect(res.body.leaveMetrics.requestsByStatus).toEqual({ pending: 0, pending_hr: 0, approved: 0, rejected: 0, cancelled: 0 });
  });

  it("excludes sensitive fields — no employee names, reasons, or raw request rows in the response", async () => {
    mockSession();
    mockActiveMembership();
    mockLeaveModuleEnabled(true);
    mockHrAdmin();
    fixtures.employeeUserLinkRows = [{ employeeId: HR_EMPLOYEE_ID, applicationUserId: 1 }];
    fixtures.employeeRows = [{ id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null }];
    fixtures.leaveRequestRows = [
      { id: 1, organizationId: ORG_ID, employeeId: HR_EMPLOYEE_ID, leavePolicyId: 1, startDate: "2020-01-01", endDate: "2099-01-01", status: "approved" },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.leaveMetrics);
    expect(keys.sort()).toEqual(
      [
        "employeesOnLeave",
        "upcomingApprovedLeave",
        "pendingApprovalCount",
        "upcomingPublicHolidays",
        "leaveUtilizationPercent",
        "expiringCarryForwardBalances",
        "requestsByStatus",
      ].sort(),
    );
  });
});
