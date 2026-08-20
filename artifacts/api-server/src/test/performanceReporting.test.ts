/**
 * Integration tests for Performance Dashboard & Reporting (Phase 3C, W81),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus scope resolution and aggregation through
 * supertest. Mock harness mirrors attendanceReporting.test.ts's own
 * field-based-filtering pattern, extended with a real `or()` implementation
 * (this workstream's own scope resolution genuinely needs it, unlike
 * Attendance's own employee-id-list scoping). No real database connection
 * is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const COUNT_SENTINEL = "__COUNT__";

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
  departmentsTable,
  positionsTable,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceCyclesTable,
  reportsTable,
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
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      reviewRows: [] as Record<string, unknown>[],
      goalRows: [] as Record<string, unknown>[],
      cycleRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title"]),
    performanceReviewsTable: mockTable("performance_reviews", [
      "id",
      "organizationId",
      "cycleId",
      "employeeId",
      "reviewerEmployeeId",
      "departmentIdSnapshot",
      "positionIdSnapshot",
      "status",
      "revisionNumber",
      "computedOverallScore",
      "hrOverrideScore",
      "hrOverrideReason",
      "selfAssessmentSubmittedAt",
      "managerReviewSubmittedAt",
      "hrFinalizedAt",
      "acknowledgedAt",
    ]),
    performanceReviewGoalsTable: mockTable("performance_review_goals", [
      "id",
      "organizationId",
      "reviewId",
      "title",
      "measurementType",
      "target",
      "actualResult",
      "weight",
      "computedScore",
      "originType",
      "approvalStatus",
      "notApplicable",
    ]),
    performanceCyclesTable: mockTable("performance_cycles", ["id", "organizationId", "name", "status"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
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
  departmentsTable,
  positionsTable,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceCyclesTable,
  reportsTable,
  db: {
    select: (selection?: { value: string }) => ({
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

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows as Record<string, unknown>[];
        else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === positionsTable) rows = fixtures.positionRows;
        else if (table === performanceReviewsTable) rows = fixtures.reviewRows;
        else if (table === performanceReviewGoalsTable) rows = fixtures.goalRows;
        else if (table === performanceCyclesTable) rows = fixtures.cycleRows;
        else if (table === reportsTable) rows = fixtures.reportRows;

        let filtered = rows;
        const isCount = selection?.value === COUNT_SENTINEL;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            if (isCount) return Promise.resolve([{ value: filtered.length }]);
            return builder;
          },
          orderBy: () => builder,
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
  // Falls back to "unconstrained" (undefined, dropped by the parent and()'s
  // own .filter(Boolean)) when every supplied branch was itself a mocked-out
  // no-op (e.g. activeAndUnexpired()'s isNull/gt branches, both stubbed to
  // undefined above) — an empty or([]) must mean "no constraint from this
  // clause", never "impossible to satisfy". Real, non-empty or() calls (this
  // workstream's own employee-or-reviewer scope condition) still filter for
  // real.
  or: (...conds: Cond[]) => {
    const filtered = conds.filter(Boolean);
    return filtered.length > 0 ? { __op: "or", conds: filtered } : undefined;
  },
  isNull: () => undefined,
  gt: () => undefined,
  gte: () => undefined,
  lte: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => COUNT_SENTINEL,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_ID = 1;
const REVIEWER_ID = 2;
const REVIEWEE_ID = 3;
const UNRELATED_ID = 4;

function mockSession(userId = HR_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID, applicationUserId = HR_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockModuleEnabled(organizationId = ORG_ID) {
  fixtures.moduleRows = [{ id: 1, key: "performance", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId, moduleId: 1, enabled: true }];
}

function mockOwnEmployeeLinked(employeeId = HR_ID, applicationUserId = HR_ID) {
  fixtures.employeeUserLinkRows = [...fixtures.employeeUserLinkRows.filter((r) => r.applicationUserId !== applicationUserId), { employeeId, applicationUserId }];
}

function mockDepartmentsAndPositions() {
  fixtures.departmentRows = [{ id: 100, organizationId: ORG_ID, name: "Engineering" }];
  fixtures.positionRows = [{ id: 200, organizationId: ORG_ID, title: "Software Engineer" }];
}

function mockReportDefinitions() {
  fixtures.reportRows = [
    { key: "headcount", label: "Headcount", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
    { key: "performance_review_status", label: "Review Status", description: "d", category: "performance", requiredPermissionKey: "performance.reports.read" },
    { key: "performance_scores", label: "Scores", description: "d", category: "performance", requiredPermissionKey: "performance.reports.read" },
    { key: "performance_goal_results", label: "Goal Results", description: "d", category: "performance", requiredPermissionKey: "performance.reports.read" },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [
    { id: HR_ID, organizationId: ORG_ID, firstName: "Hana", lastName: "Hr" },
    { id: REVIEWER_ID, organizationId: ORG_ID, firstName: "Rex", lastName: "Reviewer" },
    { id: REVIEWEE_ID, organizationId: ORG_ID, firstName: "Remi", lastName: "Reviewee" },
    { id: UNRELATED_ID, organizationId: ORG_ID, firstName: "Uma", lastName: "Unrelated" },
  ];
  fixtures.employeeUserLinkRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.reviewRows = [];
  fixtures.goalRows = [];
  fixtures.cycleRows = [];
  fixtures.reportRows = [];

  mockSession();
  mockActiveMembership();
  mockModuleEnabled();
  mockDepartmentsAndPositions();
  mockReportDefinitions();
});

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: ORG_ID,
    cycleId: 1,
    employeeId: REVIEWEE_ID,
    reviewerEmployeeId: REVIEWER_ID,
    departmentIdSnapshot: 100,
    positionIdSnapshot: 200,
    status: "self_assessment",
    revisionNumber: 1,
    computedOverallScore: null,
    hrOverrideScore: null,
    hrOverrideReason: null,
    selfAssessmentSubmittedAt: null,
    managerReviewSubmittedAt: null,
    hrFinalizedAt: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

function dashboard(userToken = "valid-token", query = "") {
  return request(app)
    .get(`/api/organizations/${ORG_ID}/performance/dashboard${query ? `?${query}` : ""}`)
    .set("Authorization", `Bearer ${userToken}`);
}
function report(key: string, query = "", userToken = "valid-token") {
  return request(app)
    .get(`/api/organizations/${ORG_ID}/performance/reports/${key}${query ? `?${query}` : ""}`)
    .set("Authorization", `Bearer ${userToken}`);
}

describe("GET /api/organizations/:organizationId/performance/dashboard", () => {
  it("returns 403 when the performance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("returns 403 without performance.reports.read", async () => {
    mockPermissions(["performance.manage"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("org-wide (performance.manage) sees every review with a zero-filled status breakdown", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [
      review({ id: 1, status: "self_assessment" }),
      review({ id: 2, status: "manager_review", employeeId: UNRELATED_ID }),
      review({ id: 3, status: "finalized", employeeId: UNRELATED_ID }),
    ];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.employeesAssignedCount).toBe(2);
    expect(res.body.activeCycleCount).toBe(1);
    const buckets: Record<string, number> = Object.fromEntries(res.body.statusBreakdown.map((b: { status: string; count: number }) => [b.status, b.count]));
    expect(buckets).toEqual({ draft: 0, self_assessment: 1, manager_review: 1, hr_review: 0, finalized: 1, acknowledged: 0 });
    expect(res.body.finalizedCount).toBe(1);
  });

  it("a reviewer (own scope) sees only reviews where they are employee or reviewer of record", async () => {
    mockSession(REVIEWER_ID);
    mockActiveMembership(6, ORG_ID, REVIEWER_ID);
    mockOwnEmployeeLinked(REVIEWER_ID, REVIEWER_ID);
    mockPermissions(["performance.reports.read"]);
    fixtures.reviewRows = [
      review({ id: 1, employeeId: REVIEWEE_ID, reviewerEmployeeId: REVIEWER_ID, status: "manager_review" }),
      review({ id: 2, employeeId: UNRELATED_ID, reviewerEmployeeId: UNRELATED_ID, status: "manager_review" }),
    ];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.managerReviewPendingCount).toBe(1);
    expect(res.body.employeesAssignedCount).toBe(1);
  });

  it("a caller with no linked employee and no performance.manage gets a valid, empty scope", async () => {
    mockPermissions(["performance.reports.read"]);
    fixtures.reviewRows = [review({ id: 1 })];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.employeesAssignedCount).toBe(0);
    expect(res.body.statusBreakdown.every((b: { count: number }) => b.count === 0)).toBe(true);
  });

  it("a reopened review counts only under its current status, not a prior one", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    // revisionNumber 2 simulates a review that was reopened from finalized
    // back to manager_review — the dashboard groups by the live status
    // column only, so no separate accounting for the prior finalized state.
    fixtures.reviewRows = [review({ id: 1, status: "manager_review", revisionNumber: 2 })];
    const res = await dashboard();
    const buckets: Record<string, number> = Object.fromEntries(res.body.statusBreakdown.map((b: { status: string; count: number }) => [b.status, b.count]));
    expect(buckets.manager_review).toBe(1);
    expect(buckets.finalized).toBe(0);
  });

  it("cycleId narrows the review-scoped tiles but not activeCycleCount", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [
      { id: 1, organizationId: ORG_ID, name: "Cycle A", status: "open" },
      { id: 2, organizationId: ORG_ID, name: "Cycle B", status: "open" },
    ];
    fixtures.reviewRows = [review({ id: 1, cycleId: 1 }), review({ id: 2, cycleId: 2, employeeId: UNRELATED_ID })];
    const res = await dashboard("valid-token", "cycleId=1");
    expect(res.status).toBe(200);
    expect(res.body.cycleId).toBe(1);
    expect(res.body.employeesAssignedCount).toBe(1);
    expect(res.body.activeCycleCount).toBe(2);
  });

  it("counts proposed goals awaiting manager decision as its own tile", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.reviewRows = [review({ id: 1 })];
    fixtures.goalRows = [
      { id: 1, organizationId: ORG_ID, reviewId: 1, approvalStatus: "proposed" },
      { id: 2, organizationId: ORG_ID, reviewId: 1, approvalStatus: "accepted" },
    ];
    const res = await dashboard();
    expect(res.body.proposedGoalsAwaitingDecisionCount).toBe(1);
  });

  it("denies cross-organization membership entirely", async () => {
    mockActiveMembership(5, OTHER_ORG_ID, HR_ID);
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/performance/reports/:reportKey", () => {
  it("returns 404 for an unknown report key", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await report("bogus_key")).status).toBe(404);
  });

  it("returns 404 for a real report key from a different category", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await report("headcount")).status).toBe(404);
  });

  it("returns 403 when the performance module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await report("performance_review_status")).status).toBe(403);
  });

  it("performance_review_status: one row per in-scope review with snapshot columns, no unrelated fields", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, status: "hr_review", revisionNumber: 3 })];
    const res = await report("performance_review_status");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0];
    expect(row.employee).toBe("Remi Reviewee");
    expect(row.cycle).toBe("2026 Cycle");
    expect(row.status).toBe("hr_review");
    expect(row.reviewer).toBe("Rex Reviewer");
    expect(row.department).toBe("Engineering");
    expect(row.position).toBe("Software Engineer");
    expect(row.revisionNumber).toBe(3);
    expect(row.hrOverrideScore).toBeUndefined();
    expect(row.hrOverrideReason).toBeUndefined();
  });

  it("performance_scores: manager score, HR override, and effective score always distinct", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [
      review({ id: 1, status: "finalized", computedOverallScore: "88.00" }),
      review({ id: 2, status: "finalized", computedOverallScore: "88.00", hrOverrideScore: "92.50", employeeId: UNRELATED_ID }),
    ];
    const res = await report("performance_scores");
    expect(res.status).toBe(200);
    const [noOverride, withOverride] = res.body.rows;
    expect(noOverride.managerScore).toBe("88.00");
    expect(noOverride.hrOverrideScore).toBeNull();
    expect(noOverride.effectiveScore).toBe("88.00");
    expect(withOverride.managerScore).toBe("88.00");
    expect(withOverride.hrOverrideScore).toBe("92.50");
    expect(withOverride.effectiveScore).toBe("92.50");
  });

  it("performance_goal_results: only accepted goals appear, never proposed/rejected", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, status: "finalized" })];
    fixtures.goalRows = [
      { id: 1, organizationId: ORG_ID, reviewId: 1, title: "Accepted Goal", measurementType: "numeric", target: "10.00", actualResult: "8.00", weight: 100, computedScore: "80.00", originType: "manager", approvalStatus: "accepted", notApplicable: false },
      { id: 2, organizationId: ORG_ID, reviewId: 1, title: "Proposed Goal", measurementType: "numeric", target: "5.00", actualResult: null, weight: 0, computedScore: null, originType: "employee_proposed", approvalStatus: "proposed", notApplicable: false },
      { id: 3, organizationId: ORG_ID, reviewId: 1, title: "Rejected Goal", measurementType: "numeric", target: "5.00", actualResult: null, weight: 0, computedScore: null, originType: "employee_proposed", approvalStatus: "rejected", notApplicable: false },
    ];
    const res = await report("performance_goal_results");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].goal).toBe("Accepted Goal");
    expect(res.body.rows[0].originType).toBe("manager");
    expect(res.body.rows[0].approvalStatus).toBe("accepted");
  });

  it("cycle filter narrows to the given cycle only", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [
      { id: 1, organizationId: ORG_ID, name: "Cycle A", status: "open" },
      { id: 2, organizationId: ORG_ID, name: "Cycle B", status: "open" },
    ];
    fixtures.reviewRows = [review({ id: 1, cycleId: 1 }), review({ id: 2, cycleId: 2, employeeId: UNRELATED_ID })];
    const res = await report("performance_review_status", "cycleId=1");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].cycle).toBe("Cycle A");
  });

  it("department snapshot filter narrows correctly, not by current department", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, departmentIdSnapshot: 100 }), review({ id: 2, departmentIdSnapshot: 999, employeeId: UNRELATED_ID })];
    const res = await report("performance_review_status", "departmentId=100");
    expect(res.body.rows).toHaveLength(1);
  });

  it("position snapshot filter narrows correctly", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, positionIdSnapshot: 200 }), review({ id: 2, positionIdSnapshot: 999, employeeId: UNRELATED_ID })];
    const res = await report("performance_review_status", "positionId=200");
    expect(res.body.rows).toHaveLength(1);
  });

  it("reviewer filter narrows correctly", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, reviewerEmployeeId: REVIEWER_ID }), review({ id: 2, reviewerEmployeeId: UNRELATED_ID, employeeId: UNRELATED_ID })];
    const res = await report("performance_review_status", `reviewerId=${REVIEWER_ID}`);
    expect(res.body.rows).toHaveLength(1);
  });

  it("employee filter for an unrelated (out of scope) employee returns empty, never broadens a reviewer's own scope", async () => {
    mockSession(REVIEWER_ID);
    mockActiveMembership(6, ORG_ID, REVIEWER_ID);
    mockOwnEmployeeLinked(REVIEWER_ID, REVIEWER_ID);
    mockPermissions(["performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, employeeId: UNRELATED_ID, reviewerEmployeeId: UNRELATED_ID })];
    const res = await report("performance_review_status", `employeeId=${UNRELATED_ID}`);
    expect(res.body.rows).toHaveLength(0);
  });

  it("cross-org filter id (employeeId from another organization) is safe — the organizationId scope condition still applies", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1 })];
    const res = await report("performance_review_status", "employeeId=999999");
    expect(res.body.rows).toHaveLength(0);
  });

  it("denies cross-organization membership entirely", async () => {
    mockActiveMembership(5, OTHER_ORG_ID, HR_ID);
    mockPermissions(["performance.manage", "performance.reports.read"]);
    expect((await report("performance_review_status")).status).toBe(403);
  });

  it("supports ?format=csv with a text/csv content type and no unrelated internal fields", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1 })];
    const res = await report("performance_review_status", "format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Employee");
    expect(res.text).toContain("Remi Reviewee");
  });

  it("JSON and CSV expose the same underlying rows for the same filters", async () => {
    mockPermissions(["performance.manage", "performance.reports.read"]);
    fixtures.cycleRows = [{ id: 1, organizationId: ORG_ID, name: "2026 Cycle", status: "open" }];
    fixtures.reviewRows = [review({ id: 1, status: "finalized" })];
    const json = await report("performance_scores");
    const csv = await report("performance_scores", "format=csv");
    expect(json.body.rows).toHaveLength(1);
    expect(csv.text.split("\n")).toHaveLength(2);
  });
});
