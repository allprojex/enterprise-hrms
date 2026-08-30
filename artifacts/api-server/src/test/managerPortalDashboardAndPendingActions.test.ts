/**
 * Integration tests for GET .../manager-portal/dashboard and
 * GET .../manager-portal/pending-actions (Phase 3G, W110), exercising the
 * real requireAuth/requireMembership/requireModuleEnabled chain through
 * supertest. Every underlying module's own service/authorization function
 * (listPendingApprovals, listTeamReviews, listTeamEnrollments,
 * listTeamAssetAssignments, getAttendanceRegisterForEmployees,
 * resolveOrganizationTodayCivilDate, each module's own actor-resolver,
 * getModuleAccess, hasPermission) is mocked directly at the module
 * boundary — these tests verify managerPortalDashboard.ts's/
 * managerPortalPendingActions.ts's own aggregation and filtering logic,
 * not each underlying module's own internal correctness (already covered
 * by that module's own test suite). @workspace/db is mocked only for what
 * this file's own direct queries need (employees, performance_cycles) plus
 * the auth-chain tables (users, sessions, organization_memberships) — no
 * real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  return true;
}

const {
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  employeesTable,
  performanceCyclesTable,
  state,
  TimezoneErrorClass,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  class TimezoneErrorClass extends Error {}
  return {
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName"]),
    performanceCyclesTable: mockTable("performance_cycles", ["id", "name"]),
    TimezoneErrorClass,
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      cycleRows: [] as Record<string, unknown>[],
      moduleEnabled: new Map<number, Set<string>>(),
      permissions: new Map<number, Set<string>>(),
      actorEmployeeIdByUser: new Map<number, number | null>(),
      directReportsByManager: new Map<number, { id: number }[]>(),
      leaveRequests: [] as { organizationId: number; id: number; employeeId: number; status: string; createdAt: Date }[],
      performanceReviews: [] as { organizationId: number; id: number; employeeId: number; reviewerEmployeeId: number; cycleId: number; status: string; createdAt: Date }[],
      learningEnrollments: [] as { organizationId: number; id: number; employeeId: number; managerEmployeeIdSnapshot: number; approvalStatus: string; courseTitleSnapshot: string; createdAt: Date }[],
      recruitmentParticipation: [] as {
        organizationId: number;
        kind: string;
        id: number;
        title: string;
        status: string;
        occurredAt: Date;
        deepLink: string;
      }[],
      assetAssignments: [] as { organizationId: number; managerEmployeeId: number }[],
      attendanceThrows: false,
      todayDate: "2026-08-22",
      attendanceStatusByEmployee: new Map<number, string>(),
    },
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  employeesTable,
  performanceCyclesTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = state.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }
        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = state.membershipRows;
        else if (table === employeesTable) rows = state.employeeRows;
        else if (table === performanceCyclesTable) rows = state.cycleRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => Promise.resolve(filtered),
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
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
  or: () => undefined,
  ne: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

vi.mock("../lib/managerPortalAuthorization", () => ({
  MANAGER_PORTAL_MODULE_KEY: "manager_portal",
  resolveManagerPortalActorEmployeeId: async (_organizationId: number, applicationUserId: number) => state.actorEmployeeIdByUser.get(applicationUserId) ?? null,
  listLiveDirectReports: async (_organizationId: number, managerEmployeeId: number) => state.directReportsByManager.get(managerEmployeeId) ?? [],
}));

vi.mock("../lib/organizationModules", () => ({
  getModuleAccess: async (organizationId: number, key: string) => ({ found: true, enabled: state.moduleEnabled.get(organizationId)?.has(key) ?? false }),
}));

vi.mock("../lib/permissions", () => ({
  hasPermission: async (membershipId: number, key: string) => state.permissions.get(membershipId)?.has(key) ?? false,
}));

vi.mock("../lib/attendanceDailySummary", () => ({
  OrganizationTimezoneNotConfiguredError: TimezoneErrorClass,
  getAttendanceRegisterForEmployees: async (_organizationId: number, employeeIds: number[]) => {
    if (state.attendanceThrows) throw new TimezoneErrorClass("timezone not configured");
    return employeeIds.map((id) => ({ employeeId: id, summaries: [{ status: state.attendanceStatusByEmployee.get(id) ?? "present" }] }));
  },
}));
vi.mock("../lib/attendanceReporting", () => ({
  resolveOrganizationTodayCivilDate: async (_organizationId: number) => {
    if (state.attendanceThrows) throw new TimezoneErrorClass("timezone not configured");
    return state.todayDate;
  },
}));

// Leave Approval Workflow Reconciliation: the real listPendingApprovals now
// takes {isOrgWideHr, headedDepartmentIds} instead of an
// (approverEmployeeId, isOrgWide) pair, and authority is Department-Head-
// resolved via lib/departmentHeads.ts rather than reportingManagerId. This
// test file's own purpose is verifying the Manager Portal's AGGREGATION
// layer, not re-proving Leave/Department-Head correctness (covered by
// leaveApprovals.test.ts/departmentHeads.test.ts) — so the mocked
// listDepartmentsHeadedByMembership below bridges membershipId back to the
// caller's own actorEmployeeIdByUser identity and reuses the existing
// directReportsByManager fixture verbatim (treating "headed department"
// as a stand-in single-element list containing the caller's own
// managerEmployeeId), so no individual test body below needs to change.
vi.mock("../lib/departmentHeads", () => ({
  listDepartmentsHeadedByMembership: async (_organizationId: number, membershipId: number) => {
    const membership = state.membershipRows.find((m) => m.id === membershipId);
    if (!membership) return [];
    const employeeId = state.actorEmployeeIdByUser.get(membership.applicationUserId as number);
    return employeeId != null ? [employeeId] : [];
  },
}));

vi.mock("../lib/leaveApprovals", () => ({
  listPendingApprovals: async (organizationId: number, params: { isOrgWideHr: boolean; headedDepartmentIds: number[] }) => {
    if (params.isOrgWideHr) return state.leaveRequests.filter((r) => r.organizationId === organizationId && r.status === "pending");
    const managerEmployeeId = params.headedDepartmentIds[0];
    if (managerEmployeeId == null) return [];
    const managedIds = (state.directReportsByManager.get(managerEmployeeId) ?? []).map((e) => e.id);
    return state.leaveRequests.filter((r) => r.organizationId === organizationId && r.status === "pending" && managedIds.includes(r.employeeId));
  },
}));

vi.mock("../lib/performanceAuthorization", () => ({
  PERFORMANCE_MODULE_KEY: "performance",
  resolvePerformanceActorEmployeeId: async (_organizationId: number, applicationUserId: number) => state.actorEmployeeIdByUser.get(applicationUserId) ?? null,
}));
vi.mock("../lib/performanceManagerReview", () => ({
  listTeamReviews: async (organizationId: number, reviewerEmployeeId: number) =>
    state.performanceReviews.filter((r) => r.organizationId === organizationId && r.reviewerEmployeeId === reviewerEmployeeId),
}));

vi.mock("../lib/learningAuthorization", () => ({
  LEARNING_MODULE_KEY: "learning",
  resolveLearningActorEmployeeId: async (_organizationId: number, applicationUserId: number) => state.actorEmployeeIdByUser.get(applicationUserId) ?? null,
}));
vi.mock("../lib/learningEnrollments", () => ({
  listTeamEnrollments: async (organizationId: number, managerEmployeeId: number) =>
    state.learningEnrollments.filter((e) => e.organizationId === organizationId && e.managerEmployeeIdSnapshot === managerEmployeeId),
}));

vi.mock("../lib/assetManagementAuthorization", () => ({
  ASSET_MANAGEMENT_MODULE_KEY: "asset_management",
  resolveAssetActorEmployeeId: async (_organizationId: number, applicationUserId: number) => state.actorEmployeeIdByUser.get(applicationUserId) ?? null,
}));
vi.mock("../lib/assets", () => ({
  listTeamAssetAssignments: async (organizationId: number, managerEmployeeId: number | null) =>
    managerEmployeeId == null ? [] : state.assetAssignments.filter((a) => a.organizationId === organizationId && a.managerEmployeeId === managerEmployeeId),
}));

// WS-15 P2 (§31.28) — Recruitment participation is a new underlying service,
// so it is mocked at its module boundary like every other one above. This file
// mocks @workspace/db down to the handful of tables its own queries need, so a
// service that reads interviews/scorecards/requisitions cannot run against it —
// and testing that service's internals here is not this file's job. Its own
// live suite (managerPortalRecruitmentLive.test.ts) covers it against a real
// database.
vi.mock("../lib/managerPortalRecruitmentParticipation", () => ({
  resolveManagerPortalRecruitmentParticipation: async (organizationId: number, applicationUserId: number) => ({
    linked: state.actorEmployeeIdByUser.get(applicationUserId) != null,
    items: state.recruitmentParticipation.filter((r) => r.organizationId === organizationId),
  }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const MANAGER_USER_ID = 1;
const HR_USER_ID = 2;
const UNRELATED_MANAGER_USER_ID = 3;
const UNLINKED_USER_ID = 4;
const ZERO_REPORT_USER_ID = 5;
const MANAGER_EMPLOYEE_ID = 900;
const HR_EMPLOYEE_ID = 901;
const UNRELATED_MANAGER_EMPLOYEE_ID = 902;
const ZERO_REPORT_EMPLOYEE_ID = 903;
const REPORT_A_ID = 910;
const REPORT_B_ID = 911;

function mockSession(userId: number) {
  state.sessionRows = [
    { session: { id: userId, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) }, user: { id: userId, email: "u@example.com", firstName: "T", lastName: "U", organizationId: ORG_ID, createdAt: new Date() } },
  ];
}
function mockMembership(userId: number, organizationId: number, membershipId: number) {
  state.membershipRows = [
    ...state.membershipRows.filter((m) => m.applicationUserId !== userId),
    { id: membershipId, applicationUserId: userId, organizationId, status: "active" },
  ];
}
function enableAllModules(organizationId: number) {
  state.moduleEnabled.set(organizationId, new Set(["manager_portal", "attendance", "leave", "performance", "learning", "asset_management"]));
}
function setPermissions(membershipId: number, keys: string[]) {
  state.permissions.set(membershipId, new Set(keys));
}

const EMPLOYEE_PERMISSIONS = ["attendance.read.own", "leave_request.approve", "performance.review.write", "learning.review.write", "asset_management.read.own"];
const HR_PERMISSIONS = [...EMPLOYEE_PERMISSIONS, "leave_request.manage"];

function managerHeaders() {
  mockSession(MANAGER_USER_ID);
  setPermissions(100, EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${MANAGER_USER_ID}` };
}
function hrHeaders() {
  mockSession(HR_USER_ID);
  setPermissions(101, HR_PERMISSIONS);
  return { Authorization: `Bearer token-${HR_USER_ID}` };
}
function unrelatedManagerHeaders() {
  mockSession(UNRELATED_MANAGER_USER_ID);
  setPermissions(102, EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${UNRELATED_MANAGER_USER_ID}` };
}
function unlinkedHeaders() {
  mockSession(UNLINKED_USER_ID);
  setPermissions(103, EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${UNLINKED_USER_ID}` };
}
function zeroReportHeaders() {
  mockSession(ZERO_REPORT_USER_ID);
  setPermissions(104, EMPLOYEE_PERMISSIONS);
  return { Authorization: `Bearer token-${ZERO_REPORT_USER_ID}` };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.employeeRows = [];
  state.cycleRows = [];
  state.moduleEnabled = new Map();
  state.permissions = new Map();
  state.actorEmployeeIdByUser = new Map();
  state.directReportsByManager = new Map();
  state.leaveRequests = [];
  state.performanceReviews = [];
  state.learningEnrollments = [];
  state.assetAssignments = [];
  state.attendanceThrows = false;
  state.attendanceStatusByEmployee = new Map();

  mockMembership(MANAGER_USER_ID, ORG_ID, 100);
  mockMembership(HR_USER_ID, ORG_ID, 101);
  mockMembership(UNRELATED_MANAGER_USER_ID, ORG_ID, 102);
  mockMembership(UNLINKED_USER_ID, ORG_ID, 103);
  mockMembership(ZERO_REPORT_USER_ID, ORG_ID, 104);
  enableAllModules(ORG_ID);
  enableAllModules(OTHER_ORG_ID);

  state.actorEmployeeIdByUser.set(MANAGER_USER_ID, MANAGER_EMPLOYEE_ID);
  state.actorEmployeeIdByUser.set(HR_USER_ID, HR_EMPLOYEE_ID);
  state.actorEmployeeIdByUser.set(UNRELATED_MANAGER_USER_ID, UNRELATED_MANAGER_EMPLOYEE_ID);
  state.actorEmployeeIdByUser.set(ZERO_REPORT_USER_ID, ZERO_REPORT_EMPLOYEE_ID);
  // UNLINKED_USER_ID intentionally has no entry -> resolves to null.

  state.directReportsByManager.set(MANAGER_EMPLOYEE_ID, [{ id: REPORT_A_ID }, { id: REPORT_B_ID }]);
  state.directReportsByManager.set(HR_EMPLOYEE_ID, []);
  state.directReportsByManager.set(UNRELATED_MANAGER_EMPLOYEE_ID, []);
  state.directReportsByManager.set(ZERO_REPORT_EMPLOYEE_ID, []);
});

describe("GET /api/organizations/:organizationId/manager-portal/dashboard", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when manager_portal is disabled", async () => {
    const headers = managerHeaders();
    state.moduleEnabled.set(ORG_ID, new Set());
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.status).toBe(403);
  });

  it("returns all six fields with zero-filled counts when enabled and no qualifying data", async () => {
    const headers = managerHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      linked: true,
      directReportsCount: 2,
      attendanceAbsentOrLateTodayCount: 0,
      pendingLeaveActionsCount: 0,
      pendingPerformanceActionsCount: 0,
      pendingLearningActionsCount: 0,
      teamAssetsInCustodyCount: 0,
    });
  });

  it("counts direct reports from W109's own listLiveDirectReports, not a second definition", async () => {
    const headers = managerHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.directReportsCount).toBe(2);
  });

  it("Attendance: counts only absent/late direct reports today, excluding present/partial/on_leave/holiday/non_working_day", async () => {
    const headers = managerHeaders();
    state.attendanceStatusByEmployee.set(REPORT_A_ID, "absent");
    state.attendanceStatusByEmployee.set(REPORT_B_ID, "late");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.attendanceAbsentOrLateTodayCount).toBe(2);
  });

  it("Attendance: excludes partial/on_leave/present from the count", async () => {
    const headers = managerHeaders();
    state.attendanceStatusByEmployee.set(REPORT_A_ID, "partial");
    state.attendanceStatusByEmployee.set(REPORT_B_ID, "on_leave");
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.attendanceAbsentOrLateTodayCount).toBe(0);
  });

  it("Attendance: returns null (not an error, not zero) when the organization timezone is not configured", async () => {
    const headers = managerHeaders();
    state.attendanceThrows = true;
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.attendanceAbsentOrLateTodayCount).toBeNull();
    // Other tiles remain computable — one module's edge case doesn't take down the whole response.
    expect(res.body.directReportsCount).toBe(2);
  });

  it("every module-backed tile is null (not 0, not omitted) when that module is disabled", async () => {
    const headers = managerHeaders();
    state.moduleEnabled.set(ORG_ID, new Set(["manager_portal"]));
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.attendanceAbsentOrLateTodayCount).toBeNull();
    expect(res.body.pendingLeaveActionsCount).toBeNull();
    expect(res.body.pendingPerformanceActionsCount).toBeNull();
    expect(res.body.pendingLearningActionsCount).toBeNull();
    expect(res.body.teamAssetsInCustodyCount).toBeNull();
    // Direct Reports has no module dependency of its own.
    expect(res.body.directReportsCount).toBe(2);
  });

  it("a tile is null when the caller lacks that module's own permission, even though the module itself is enabled", async () => {
    const headers = managerHeaders();
    setPermissions(100, ["leave_request.approve"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.attendanceAbsentOrLateTodayCount).toBeNull();
    expect(res.body.pendingPerformanceActionsCount).toBeNull();
    expect(res.body.pendingLeaveActionsCount).toBe(0);
  });

  it("Leave: direct-reports-only count for a plain manager", async () => {
    const headers = managerHeaders();
    state.leaveRequests = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_B_ID, status: "approved", createdAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.pendingLeaveActionsCount).toBe(1);
  });

  it("Leave: org-wide count for HR/admin holding leave_request.manage — the one explicit frozen exception to direct-report-only scope", async () => {
    const headers = hrHeaders();
    state.leaveRequests = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_B_ID, status: "pending", createdAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.pendingLeaveActionsCount).toBe(2);
  });

  it("Performance: counts only status=manager_review reviews where the caller is the snapshotted reviewerEmployeeId", async () => {
    const headers = managerHeaders();
    state.performanceReviews = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_B_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "hr_review", createdAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.pendingPerformanceActionsCount).toBe(1);
  });

  it("Performance: a review snapshotted to a DIFFERENT reviewer never counts for the current live manager, even if reportingManagerId now points at them", async () => {
    const headers = managerHeaders();
    // Review's reviewerEmployeeId is HR_EMPLOYEE_ID, not MANAGER_EMPLOYEE_ID, even though
    // REPORT_A_ID currently reports live to MANAGER_EMPLOYEE_ID (per directReportsByManager).
    state.performanceReviews = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, reviewerEmployeeId: HR_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.pendingPerformanceActionsCount).toBe(0);
  });

  it("Learning: counts only approvalStatus=pending enrollments where the caller is the snapshotted managerEmployeeIdSnapshot", async () => {
    const headers = managerHeaders();
    state.learningEnrollments = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, managerEmployeeIdSnapshot: MANAGER_EMPLOYEE_ID, approvalStatus: "pending", courseTitleSnapshot: "Course A", createdAt: new Date() },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_B_ID, managerEmployeeIdSnapshot: MANAGER_EMPLOYEE_ID, approvalStatus: "approved", courseTitleSnapshot: "Course B", createdAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.pendingLearningActionsCount).toBe(1);
  });

  it("Assets: counts current-custody assignments from listTeamAssetAssignments verbatim", async () => {
    const headers = managerHeaders();
    state.assetAssignments = [{ organizationId: ORG_ID, managerEmployeeId: MANAGER_EMPLOYEE_ID }, { organizationId: ORG_ID, managerEmployeeId: MANAGER_EMPLOYEE_ID }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.teamAssetsInCustodyCount).toBe(2);
  });

  it("an unrelated manager with zero direct reports sees zero-filled relationship-derived tiles, not another manager's data", async () => {
    const headers = unrelatedManagerHeaders();
    state.leaveRequests = [{ organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.directReportsCount).toBe(0);
    expect(res.body.pendingLeaveActionsCount).toBe(0);
  });

  it("HR/admin with zero direct reports of their own: Direct Reports is 0, never an organization-wide employee count", async () => {
    const headers = hrHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body.directReportsCount).toBe(0);
  });

  it("an unlinked caller gets linked:false and zero-filled/computable tiles, never an error", async () => {
    const headers = unlinkedHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(false);
    expect(res.body.directReportsCount).toBe(0);
  });

  it("a genuinely linked employee with zero direct reports gets linked:true, directReportsCount:0", async () => {
    const headers = zeroReportHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/dashboard`).set(headers);
    expect(res.body).toMatchObject({ linked: true, directReportsCount: 0 });
  });
});

describe("GET /api/organizations/:organizationId/manager-portal/pending-actions", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when manager_portal is disabled", async () => {
    const headers = managerHeaders();
    state.moduleEnabled.set(ORG_ID, new Set());
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);
    expect(res.status).toBe(403);
  });

  it("returns linked:true, items:[] when there is nothing pending", async () => {
    const headers = managerHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);
    expect(res.status).toBe(200);
    // WS-15 P2 (§31.28) added `recruitmentParticipation` as a SIBLING of
    // `items`; `items` itself is unchanged, which is the property that keeps
    // every existing client working.
    expect(res.body).toEqual({ linked: true, items: [], recruitmentParticipation: [] });
  });

  it("passes Recruitment participation through as a sibling, leaving items untouched (WS-15 P2)", async () => {
    // Recruitment participation has no employee subject — an interview panel
    // seat concerns a candidate, not a direct report — so it cannot be merged
    // into the employee-keyed `items` shape without a placeholder.
    state.recruitmentParticipation = [
      {
        organizationId: ORG_ID,
        kind: "interview_scorecard",
        id: 77,
        title: "Interview scorecard outstanding",
        status: "completed",
        occurredAt: new Date("2026-08-01T00:00:00.000Z"),
        deepLink: "/interviews/77/scorecard",
      },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(managerHeaders());
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.recruitmentParticipation).toHaveLength(1);
    expect(res.body.recruitmentParticipation[0]).toMatchObject({
      kind: "interview_scorecard",
      id: 77,
      deepLink: "/interviews/77/scorecard",
    });
    // No candidate-shaped field reaches the row (§31.28).
    for (const forbidden of ["candidateId", "candidateName", "applicationId", "salary", "recommendation"]) {
      expect(res.body.recruitmentParticipation[0]).not.toHaveProperty(forbidden);
    }
  });

  it("aggregates exactly leave/performance/learning items — no attendance or assets keys ever appear", async () => {
    const headers = managerHeaders();
    state.leaveRequests = [{ organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date("2026-01-01") }];
    state.performanceReviews = [{ organizationId: ORG_ID, id: 2, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 5, status: "manager_review", createdAt: new Date("2026-01-02") }];
    state.cycleRows = [{ id: 5, name: "Q1 2026" }];
    state.learningEnrollments = [{ organizationId: ORG_ID, id: 3, employeeId: REPORT_B_ID, managerEmployeeIdSnapshot: MANAGER_EMPLOYEE_ID, approvalStatus: "pending", courseTitleSnapshot: "Safety Training", createdAt: new Date("2026-01-03") }];
    state.employeeRows = [
      { id: REPORT_A_ID, organizationId: ORG_ID, firstName: "Amara", lastName: "ReportA" },
      { id: REPORT_B_ID, organizationId: ORG_ID, firstName: "Bo", lastName: "ReportB" },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    const sources = res.body.items.map((i: { sourceModule: string }) => i.sourceModule).sort();
    expect(sources).toEqual(["learning", "leave", "performance"]);
    expect(res.body.items).toHaveLength(3);
  });

  it("uses only the frozen safe DTO fields, never a sensitive payload", async () => {
    const headers = managerHeaders();
    state.leaveRequests = [{ organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() }];
    state.employeeRows = [{ id: REPORT_A_ID, organizationId: ORG_ID, firstName: "Amara", lastName: "ReportA" }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    const keys = Object.keys(res.body.items[0]).sort();
    expect(keys).toEqual(["createdAt", "employeeFirstName", "employeeId", "employeeLastName", "id", "sourceModule", "status", "title"].sort());
  });

  it("Performance items appear only at status=manager_review, sourced from the reviewer-of-record snapshot", async () => {
    const headers = managerHeaders();
    state.performanceReviews = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_B_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "draft", createdAt: new Date() },
      { organizationId: ORG_ID, id: 3, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "finalized", createdAt: new Date() },
    ];
    state.cycleRows = [{ id: 1, name: "Cycle" }];
    state.employeeRows = [{ id: REPORT_A_ID, organizationId: ORG_ID, firstName: "A", lastName: "A" }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(1);
    expect(res.body.items[0].status).toBe("manager_review");
  });

  it("Performance: reviewer-of-record snapshot authority is preserved — a review snapshotted to a different reviewer never appears for the current live manager", async () => {
    const headers = managerHeaders();
    state.performanceReviews = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, reviewerEmployeeId: HR_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() },
    ];
    state.cycleRows = [{ id: 1, name: "Cycle" }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items).toHaveLength(0);
  });

  it("Learning: an enrollment where the caller is not the snapshotted manager-of-record never appears (instructor-only relationships are never included)", async () => {
    const headers = managerHeaders();
    state.learningEnrollments = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, managerEmployeeIdSnapshot: HR_EMPLOYEE_ID, approvalStatus: "pending", courseTitleSnapshot: "Course", createdAt: new Date() },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items).toHaveLength(0);
  });

  it("module disabled excludes only that source, others remain intact", async () => {
    const headers = managerHeaders();
    state.moduleEnabled.set(ORG_ID, new Set(["manager_portal", "leave", "learning"]));
    state.leaveRequests = [{ organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() }];
    state.performanceReviews = [{ organizationId: ORG_ID, id: 2, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() }];
    state.employeeRows = [{ id: REPORT_A_ID, organizationId: ORG_ID, firstName: "A", lastName: "A" }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    const sources = res.body.items.map((i: { sourceModule: string }) => i.sourceModule);
    expect(sources).toEqual(["leave"]);
  });

  it("an unrelated manager never sees another manager's pending items", async () => {
    const headers = unrelatedManagerHeaders();
    state.leaveRequests = [{ organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() }];
    state.performanceReviews = [{ organizationId: ORG_ID, id: 2, employeeId: REPORT_A_ID, reviewerEmployeeId: MANAGER_EMPLOYEE_ID, cycleId: 1, status: "manager_review", createdAt: new Date() }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items).toHaveLength(0);
  });

  it("sorts items by createdAt descending", async () => {
    const headers = managerHeaders();
    state.leaveRequests = [
      { organizationId: ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date("2026-01-01") },
      { organizationId: ORG_ID, id: 2, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date("2026-03-01") },
    ];
    state.employeeRows = [{ id: REPORT_A_ID, organizationId: ORG_ID, firstName: "A", lastName: "A" }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([2, 1]);
  });

  it("does not leak a pending item belonging to a different organization", async () => {
    const headers = managerHeaders();
    state.leaveRequests = [{ organizationId: OTHER_ORG_ID, id: 1, employeeId: REPORT_A_ID, status: "pending", createdAt: new Date() }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/pending-actions`).set(headers);

    expect(res.body.items).toHaveLength(0);
  });
});
