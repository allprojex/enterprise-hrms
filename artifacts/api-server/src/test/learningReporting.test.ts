/**
 * Integration tests for Learning Dashboard & Reporting (Phase 3D, W92),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus scope resolution and aggregation through
 * supertest. Mock harness mirrors performanceReporting.test.ts's own
 * field-based-filtering pattern, extended with gte/lt/isNotNull support for
 * the certificate-expiry-window query. No real database connection.
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeNumberAllocationsTable,
  employeeUserLinksTable,
  departmentsTable,
  positionsTable,
  learningEnrollmentsTable,
  learningCoursesTable,
  learningCertificatesTable,
  learningCourseSessionsTable,
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
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      enrollmentRows: [] as Record<string, unknown>[],
      courseRows: [] as Record<string, unknown>[],
      certificateRows: [] as Record<string, unknown>[],
      sessionCatalogRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
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
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "employeeNumber"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title"]),
    learningEnrollmentsTable: mockTable("learning_enrollments", [
      "id", "organizationId", "courseId", "sessionId", "employeeId",
      "courseTitleSnapshot", "categorySnapshot", "deliveryModeSnapshot", "hasAssessmentSnapshot",
      "issuesCertificateSnapshot", "certificateValidityMonthsSnapshot", "departmentIdSnapshot",
      "positionIdSnapshot", "managerEmployeeIdSnapshot", "mandatoryAtAssignment", "originType",
      "dueDate", "approvalStatus", "status", "passed", "score", "completedAt", "cancelReason", "createdAt",
    ]),
    learningCoursesTable: mockTable("learning_courses", ["id", "organizationId", "status"]),
    learningCertificatesTable: mockTable("learning_certificates", [
      "id", "organizationId", "enrollmentId", "employeeId", "courseTitleSnapshot",
      "certificateNumber", "issuedAt", "expiresAt", "status", "revokeReason",
    ]),
    learningCourseSessionsTable: mockTable("learning_course_sessions", ["id", "organizationId", "courseId", "scheduledAt"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "gte"; field: string; val: unknown }
  | { __op: "lt"; field: string; val: unknown }
  | { __op: "isNotNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "gte") return (row[cond.field] as Date) >= (cond.val as Date);
  if (cond.__op === "lt") return (row[cond.field] as Date) < (cond.val as Date);
  if (cond.__op === "isNotNull") return row[cond.field] != null;
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
  employeeNumberAllocationsTable,
  employeeUserLinksTable,
  departmentsTable,
  positionsTable,
  learningEnrollmentsTable,
  learningCoursesTable,
  learningCertificatesTable,
  learningCourseSessionsTable,
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
        else if (table === employeeNumberAllocationsTable) rows = fixtures.employeeNumberAllocationRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === positionsTable) rows = fixtures.positionRows;
        else if (table === learningEnrollmentsTable) rows = fixtures.enrollmentRows;
        else if (table === learningCoursesTable) rows = fixtures.courseRows;
        else if (table === learningCertificatesTable) rows = fixtures.certificateRows;
        else if (table === learningCourseSessionsTable) rows = fixtures.sessionCatalogRows;
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
  or: (...conds: Cond[]) => {
    const filtered = conds.filter(Boolean);
    return filtered.length > 0 ? { __op: "or", conds: filtered } : undefined;
  },
  isNull: () => undefined,
  isNotNull: (col: string) => ({ __op: "isNotNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gt: () => undefined,
  gte: (col: string, val: unknown) => ({ __op: "gte", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  lt: (col: string, val: unknown) => ({ __op: "lt", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  lte: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => COUNT_SENTINEL,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_ID = 1;
const MANAGER_ID = 2;
const EMPLOYEE_ID = 3;
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
  fixtures.moduleRows = [{ id: 1, key: "learning", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId, moduleId: 1, enabled: true }];
}

function mockOwnEmployeeLinked(employeeId = HR_ID, applicationUserId = HR_ID) {
  fixtures.employeeUserLinkRows = [...fixtures.employeeUserLinkRows.filter((r) => r.applicationUserId !== applicationUserId), { employeeId, applicationUserId }];
}

function mockReportDefinitions() {
  fixtures.reportRows = [
    { key: "headcount", label: "Headcount", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
    { key: "learning_enrollment_status", label: "Enrollment Status", description: "d", category: "learning", requiredPermissionKey: "learning.reports.read" },
    { key: "learning_completion_summary", label: "Completion Summary", description: "d", category: "learning", requiredPermissionKey: "learning.reports.read" },
    { key: "learning_certificate_expiry", label: "Certificate Expiry", description: "d", category: "learning", requiredPermissionKey: "learning.reports.read" },
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
    { id: HR_ID, organizationId: ORG_ID, firstName: "Hana", lastName: "Hr", employeeNumber: "E001" },
    { id: MANAGER_ID, organizationId: ORG_ID, firstName: "Mona", lastName: "Manager", employeeNumber: "E002" },
    { id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Eli", lastName: "Employee", employeeNumber: "E003" },
    { id: UNRELATED_ID, organizationId: ORG_ID, firstName: "Uma", lastName: "Unrelated", employeeNumber: "E004" },
  ];
  // Phase 3H, W119 — the historical-resolution fix reads
  // employee_number_allocations, never employees.employeeNumber directly;
  // an early, still-open validFrom safely predates every fixture
  // enrollment/certificate date used across this file's own existing tests.
  fixtures.employeeNumberAllocationRows = [
    { id: 1, organizationId: ORG_ID, employeeId: HR_ID, employeeNumber: "E001", allocationMethod: "generated", validFrom: new Date("2000-01-01"), validTo: null },
    { id: 2, organizationId: ORG_ID, employeeId: MANAGER_ID, employeeNumber: "E002", allocationMethod: "generated", validFrom: new Date("2000-01-01"), validTo: null },
    { id: 3, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "E003", allocationMethod: "generated", validFrom: new Date("2000-01-01"), validTo: null },
    { id: 4, organizationId: ORG_ID, employeeId: UNRELATED_ID, employeeNumber: "E004", allocationMethod: "generated", validFrom: new Date("2000-01-01"), validTo: null },
  ];
  fixtures.employeeUserLinkRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.enrollmentRows = [];
  fixtures.courseRows = [];
  fixtures.certificateRows = [];
  fixtures.sessionCatalogRows = [];
  fixtures.reportRows = [];

  mockSession();
  mockActiveMembership();
  mockModuleEnabled();
  mockReportDefinitions();
});

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: ORG_ID,
    courseId: 1,
    sessionId: null,
    employeeId: EMPLOYEE_ID,
    courseTitleSnapshot: "Fire Safety",
    categorySnapshot: "Compliance",
    deliveryModeSnapshot: "self_paced",
    hasAssessmentSnapshot: false,
    issuesCertificateSnapshot: false,
    certificateValidityMonthsSnapshot: null,
    departmentIdSnapshot: 100,
    positionIdSnapshot: 200,
    managerEmployeeIdSnapshot: MANAGER_ID,
    mandatoryAtAssignment: false,
    originType: "hr_assigned",
    dueDate: null,
    approvalStatus: "auto_approved",
    status: "assigned",
    passed: null,
    score: null,
    completedAt: null,
    cancelReason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function dashboard(userToken = "valid-token") {
  return request(app).get(`/api/organizations/${ORG_ID}/learning/dashboard`).set("Authorization", `Bearer ${userToken}`);
}
function report(key: string, query = "", userToken = "valid-token") {
  return request(app)
    .get(`/api/organizations/${ORG_ID}/learning/reports/${key}${query ? `?${query}` : ""}`)
    .set("Authorization", `Bearer ${userToken}`);
}

describe("GET /api/organizations/:organizationId/learning/dashboard", () => {
  it("returns 403 when the learning module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("returns 403 without learning.reports.read", async () => {
    mockPermissions(["learning.manage"]);
    expect((await dashboard()).status).toBe(403);
  });

  it("org-wide (learning.manage) sees every enrollment with a zero-filled status breakdown, activeCourseCount org-wide", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.courseRows = [{ id: 1, organizationId: ORG_ID, status: "active" }, { id: 2, organizationId: ORG_ID, status: "draft" }];
    fixtures.enrollmentRows = [
      enrollment({ id: 1, status: "assigned" }),
      enrollment({ id: 2, status: "completed", employeeId: UNRELATED_ID }),
      enrollment({ id: 3, status: "in_progress", employeeId: UNRELATED_ID }),
    ];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.activeCourseCount).toBe(1);
    expect(res.body.enrollmentsAssignedCount).toBe(3);
    const buckets: Record<string, number> = Object.fromEntries(res.body.statusBreakdown.map((b: { status: string; count: number }) => [b.status, b.count]));
    expect(buckets).toEqual({ assigned: 1, in_progress: 1, completed: 1, failed: 0, cancelled: 0 });
  });

  it("a manager (own+manager-of-record scope) sees only their own and their direct reports' enrollments", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(6, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["learning.reports.read"]);
    fixtures.enrollmentRows = [
      enrollment({ id: 1, employeeId: EMPLOYEE_ID, managerEmployeeIdSnapshot: MANAGER_ID, status: "in_progress" }),
      enrollment({ id: 2, employeeId: UNRELATED_ID, managerEmployeeIdSnapshot: UNRELATED_ID, status: "completed" }),
    ];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.enrollmentsAssignedCount).toBe(1);
  });

  it("a manager with zero direct reports never falls back to organization-wide access", async () => {
    mockSession(UNRELATED_ID);
    mockActiveMembership(7, ORG_ID, UNRELATED_ID);
    mockOwnEmployeeLinked(UNRELATED_ID, UNRELATED_ID);
    mockPermissions(["learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, employeeId: EMPLOYEE_ID, managerEmployeeIdSnapshot: MANAGER_ID })];
    const res = await dashboard();
    expect(res.body.enrollmentsAssignedCount).toBe(0);
  });

  it("a caller with no linked employee and no learning.manage gets a valid, empty scope", async () => {
    mockPermissions(["learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1 })];
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.enrollmentsAssignedCount).toBe(0);
    expect(res.body.statusBreakdown.every((b: { count: number }) => b.count === 0)).toBe(true);
  });

  it("pendingApprovalCount counts approvalStatus = pending regardless of status", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, approvalStatus: "pending", status: "assigned" })];
    const res = await dashboard();
    expect(res.body.pendingApprovalCount).toBe(1);
  });

  it("overdueCount excludes completed/failed/cancelled even with a passed dueDate (Owner Decision 2)", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    const past = new Date(Date.now() - 86400000);
    fixtures.enrollmentRows = [
      enrollment({ id: 1, dueDate: past, status: "assigned" }),
      enrollment({ id: 2, dueDate: past, status: "completed", employeeId: UNRELATED_ID }),
      enrollment({ id: 3, dueDate: past, status: "failed", employeeId: UNRELATED_ID }),
      enrollment({ id: 4, dueDate: past, status: "cancelled", employeeId: UNRELATED_ID }),
      enrollment({ id: 5, dueDate: new Date(Date.now() + 86400000), status: "assigned", employeeId: UNRELATED_ID }),
    ];
    const res = await dashboard();
    expect(res.body.overdueCount).toBe(1);
  });

  it("certificatesExpiringSoonCount: active certs within 30 days count; revoked/expired/far-future/null-expiry excluded", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    const now = Date.now();
    fixtures.certificateRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "active", expiresAt: new Date(now + 10 * 86400000) }, // in 10 days — counts
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "active", expiresAt: new Date(now + 40 * 86400000) }, // in 40 days — excluded
      { id: 3, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "revoked", expiresAt: new Date(now + 5 * 86400000) }, // revoked — excluded
      { id: 4, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "active", expiresAt: new Date(now - 86400000) }, // already expired — excluded
      { id: 5, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, status: "active", expiresAt: null }, // never expires — excluded
    ];
    const res = await dashboard();
    expect(res.body.certificatesExpiringSoonCount).toBe(1);
  });

  it("denies cross-organization membership entirely", async () => {
    mockActiveMembership(5, OTHER_ORG_ID, HR_ID);
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await dashboard()).status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/learning/reports/:reportKey", () => {
  it("returns 404 for an unknown report key", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await report("bogus_key")).status).toBe(404);
  });

  it("returns 404 for a real report key from a different category", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await report("headcount")).status).toBe(404);
  });

  it("returns 403 when the learning module is not enabled", async () => {
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await report("learning_enrollment_status")).status).toBe(403);
  });

  it("learning_enrollment_status: one row per in-scope enrollment with snapshot columns", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, mandatoryAtAssignment: true })];
    const res = await report("learning_enrollment_status");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0];
    expect(row.employee).toBe("Eli Employee");
    expect(row.employeeNumber).toBe("E003");
    expect(row.course).toBe("Fire Safety");
    expect(row.category).toBe("Compliance");
    expect(row.mandatoryAtAssignment).toBe("Yes");
    expect(row.managerOfRecord).toBe("Mona Manager");
    expect(row.status).toBe("assigned");
    expect(row.approvalStatus).toBe("auto_approved");
  });

  describe("historical staff-number resolution (Phase 3H, W119, frozen plan §6)", () => {
    it("shows an enrollment's own historical staff number as of its assignment date, not the live employees.employeeNumber cache", async () => {
      mockPermissions(["learning.manage", "learning.reports.read"]);
      // The employee's OWN employeeNumber cache is deliberately set to
      // something different from the allocation history — proving the
      // report reads employee_number_allocations, never the cache.
      fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Eli", lastName: "Employee", employeeNumber: "STALE-CACHE-VALUE" }];
      fixtures.employeeNumberAllocationRows = [
        { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "OLD-0003", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2027-01-01") },
      ];
      // The enrollment's own createdAt (2026-01-01, this file's own fixture
      // default) falls inside OLD-0003's own valid window.
      fixtures.enrollmentRows = [enrollment({ id: 1 })];
      const res = await report("learning_enrollment_status");
      expect(res.status).toBe(200);
      expect(res.body.rows[0].employeeNumber).toBe("OLD-0003");
    });

    it("does not let a since-reused number's new holder overwrite an old enrollment's own historical display", async () => {
      mockPermissions(["learning.manage", "learning.reports.read"]);
      fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Eli", lastName: "Employee", employeeNumber: null }];
      fixtures.employeeNumberAllocationRows = [
        // Eli's own historical holding of EMP-0007 — closed when reused.
        { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "EMP-0007", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2025-01-01") },
        // A different employee now currently holds the same, reused number.
        { id: 2, organizationId: ORG_ID, employeeId: UNRELATED_ID, employeeNumber: "EMP-0007", allocationMethod: "manual", validFrom: new Date("2025-06-01"), validTo: null },
      ];
      // Eli's enrollment predates the reuse (createdAt 2026-01-01 is AFTER
      // Eli's own window closed on 2025-01-01 in this scenario — use an
      // enrollment createdAt inside Eli's own window instead).
      fixtures.enrollmentRows = [enrollment({ id: 1, createdAt: new Date("2024-06-01") })];
      const res = await report("learning_enrollment_status");
      expect(res.status).toBe(200);
      expect(res.body.rows[0].employee).toBe("Eli Employee");
      expect(res.body.rows[0].employeeNumber).toBe("EMP-0007"); // Eli's own historical number, not overwritten by the new holder.
    });
  });

  it("department/position snapshot filters narrow correctly, not by current department", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [
      enrollment({ id: 1, departmentIdSnapshot: 100, positionIdSnapshot: 200 }),
      enrollment({ id: 2, departmentIdSnapshot: 999, positionIdSnapshot: 999, employeeId: UNRELATED_ID }),
    ];
    const res = await report("learning_enrollment_status", "departmentId=100&positionId=200");
    expect(res.body.rows).toHaveLength(1);
  });

  it("employee filter for an unrelated (out of scope) employee returns empty, never broadens a manager's own scope", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(6, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, employeeId: UNRELATED_ID, managerEmployeeIdSnapshot: UNRELATED_ID })];
    const res = await report("learning_enrollment_status", `employeeId=${UNRELATED_ID}`);
    expect(res.body.rows).toHaveLength(0);
  });

  it("cross-org filter id is safe — the organizationId scope condition still applies", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1 })];
    const res = await report("learning_enrollment_status", "employeeId=999999");
    expect(res.body.rows).toHaveLength(0);
  });

  it("learning_completion_summary: per-course counts, completionPercentage excludes pending/rejected/cancelled but includes failed", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [
      enrollment({ id: 1, courseId: 1, status: "completed", approvalStatus: "auto_approved" }),
      enrollment({ id: 2, courseId: 1, status: "failed", approvalStatus: "auto_approved", employeeId: UNRELATED_ID }),
      enrollment({ id: 3, courseId: 1, status: "cancelled", approvalStatus: "auto_approved", employeeId: UNRELATED_ID }),
      enrollment({ id: 4, courseId: 1, status: "assigned", approvalStatus: "pending", employeeId: UNRELATED_ID }),
      enrollment({ id: 5, courseId: 1, status: "assigned", approvalStatus: "rejected", employeeId: UNRELATED_ID }),
      enrollment({ id: 6, courseId: 1, status: "assigned", approvalStatus: "approved", employeeId: UNRELATED_ID }),
    ];
    const res = await report("learning_completion_summary");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    const row = res.body.rows[0];
    expect(row.assignedCount).toBe(6);
    expect(row.completedCount).toBe(1);
    expect(row.failedCount).toBe(1);
    expect(row.cancelledCount).toBe(1);
    // denominator = completed(1) + failed(1) + approved-assigned(1) = 3 (excludes pending, rejected, cancelled)
    expect(row.completionPercentage).toBeCloseTo(33.33, 1);
  });

  it("learning_completion_summary: denominator of 0 returns null, never a division error", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, courseId: 1, status: "cancelled", approvalStatus: "auto_approved" })];
    const res = await report("learning_completion_summary");
    expect(res.body.rows[0].completionPercentage).toBeNull();
  });

  it("learning_certificate_expiry: computed active/expired/revoked, never a stored expired value", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    const now = Date.now();
    fixtures.certificateRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C1", issuedAt: new Date(now - 100000), expiresAt: new Date(now + 100000000), status: "active", revokeReason: null },
      { id: 2, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C2", issuedAt: new Date(now - 100000), expiresAt: new Date(now - 100000), status: "active", revokeReason: null },
      { id: 3, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C3", issuedAt: new Date(now - 100000), expiresAt: new Date(now + 100000000), status: "revoked", revokeReason: "Policy violation" },
    ];
    const res = await report("learning_certificate_expiry");
    expect(res.status).toBe(200);
    const byNumber: Record<string, string> = Object.fromEntries(res.body.rows.map((r: { certificateNumber: string; computedStatus: string }) => [r.certificateNumber, r.computedStatus]));
    expect(byNumber.C1).toBe("active");
    expect(byNumber.C2).toBe("expired");
    expect(byNumber.C3).toBe("revoked");
  });

  it("learning_certificate_expiry: shows the employee's staff number as of the certificate's own issue date, never the live cache (Phase 3H, W119, frozen plan §6)", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Eli", lastName: "Employee", employeeNumber: "STALE-CACHE-VALUE" }];
    fixtures.employeeNumberAllocationRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "OLD-0003", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2027-01-01") },
    ];
    fixtures.certificateRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C1", issuedAt: new Date("2024-01-01"), expiresAt: null, status: "active", revokeReason: null },
    ];
    const res = await report("learning_certificate_expiry");
    expect(res.status).toBe(200);
    expect(res.body.rows[0].employeeNumber).toBe("OLD-0003");
  });

  it("learning_certificate_expiry: manager scope resolves visibility transitively through the issuing enrollment", async () => {
    mockSession(MANAGER_ID);
    mockActiveMembership(6, ORG_ID, MANAGER_ID);
    mockOwnEmployeeLinked(MANAGER_ID, MANAGER_ID);
    mockPermissions(["learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1, employeeId: EMPLOYEE_ID, managerEmployeeIdSnapshot: MANAGER_ID })];
    fixtures.certificateRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C1", issuedAt: new Date(), expiresAt: null, status: "active", revokeReason: null },
      { id: 2, organizationId: ORG_ID, employeeId: UNRELATED_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: "C2", issuedAt: new Date(), expiresAt: null, status: "active", revokeReason: null },
    ];
    const res = await report("learning_certificate_expiry");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].certificateNumber).toBe("C1");
  });

  it("denies cross-organization membership entirely", async () => {
    mockActiveMembership(5, OTHER_ORG_ID, HR_ID);
    mockPermissions(["learning.manage", "learning.reports.read"]);
    expect((await report("learning_enrollment_status")).status).toBe(403);
  });

  it("supports ?format=csv with a text/csv content type", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1 })];
    const res = await report("learning_enrollment_status", "format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain("Employee");
    expect(res.text).toContain("Eli Employee");
  });

  it("JSON and CSV expose the same underlying rows for the same filters", async () => {
    mockPermissions(["learning.manage", "learning.reports.read"]);
    fixtures.enrollmentRows = [enrollment({ id: 1 })];
    const json = await report("learning_enrollment_status");
    const csv = await report("learning_enrollment_status", "format=csv");
    expect(json.body.rows).toHaveLength(1);
    expect(csv.text.split("\n")).toHaveLength(2);
  });
});
