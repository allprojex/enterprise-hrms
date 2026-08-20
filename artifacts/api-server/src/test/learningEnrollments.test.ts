/**
 * Integration tests for Learning Enrollment, Assignment & Approval (Phase
 * 3D, W87), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real service-layer
 * validation through supertest. @workspace/db is mocked with the same
 * generic Cond-matching harness established by learningCoursesAndSessions
 * .test.ts / performanceCyclesAndAssignment.test.ts, extended with:
 *   - `ne` (not-equal) Cond support, needed by hasNonTerminalEnrollment's
 *     ne(status,'completed')/ne(status,'failed')/ne(status,'cancelled').
 *   - A count-aware select() stage: when the projection passed to
 *     `.select({ value: count() })` is detected (the mocked `count()`
 *     returns the sentinel string "count"), the stage resolves to
 *     `[{ value: matchedRows.length }]` instead of the raw row list — this
 *     is what makes the session-capacity race check and listEnrollments'
 *     `total` genuinely meaningful here, rather than the inert passthrough
 *     performanceCyclesAndAssignment.test.ts's own comment describes for a
 *     count query it never needed to assert against.
 *   - `.for("update")` as a chainable no-op passthrough (real row-locking
 *     behavior is exercised only in live QA, never here).
 * No real database connection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "ne"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "ne") return row[cond.field] !== cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  return true;
}

const {
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeeUserLinksTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  masterDataItemsTable,
  learningCoursesTable,
  learningCourseSessionsTable,
  learningEnrollmentsTable,
  auditEventsTable,
  state,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "applicationUserId", "employeeId"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "positionId", "reportingManagerId", "employmentStatus"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "name"]),
    masterDataItemsTable: mockTable("master_data_items", ["id", "domain", "organizationId", "code", "label", "status"]),
    learningCoursesTable: mockTable("learning_courses", [
      "id", "organizationId", "categoryCode", "title", "description", "deliveryMode",
      "mandatoryDefault", "requiresApproval", "hasAssessment", "issuesCertificate",
      "certificateValidityMonths", "status", "createdBy",
    ]),
    learningCourseSessionsTable: mockTable("learning_course_sessions", [
      "id", "organizationId", "courseId", "scheduledAt", "durationMinutes", "location",
      "meetingLink", "instructorEmployeeId", "capacity", "status",
    ]),
    learningEnrollmentsTable: mockTable("learning_enrollments", [
      "id", "organizationId", "courseId", "sessionId", "employeeId",
      "courseTitleSnapshot", "categorySnapshot", "deliveryModeSnapshot", "hasAssessmentSnapshot",
      "issuesCertificateSnapshot", "certificateValidityMonthsSnapshot", "departmentIdSnapshot",
      "positionIdSnapshot", "managerEmployeeIdSnapshot", "mandatoryAtAssignment", "originType",
      "assignedByMembershipId", "dueDate", "approvalStatus", "approvalDecidedByMembershipId",
      "approvalDecidedAt", "status", "attended", "attendanceMarkedByMembershipId", "attendanceMarkedAt",
      "passed", "score", "completedAt", "cancelReason",
    ]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId", "metadata"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      masterDataItemRows: [] as Record<string, unknown>[],
      courseRows: [] as Record<string, unknown>[],
      courseSessionRows: [] as Record<string, unknown>[],
      enrollmentRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      nextIds: new Map<string, number>() as Map<string, number>,
    },
  };
});

function nextId(tableName: string): number {
  const n = (state.nextIds.get(tableName) ?? 0) + 1;
  state.nextIds.set(tableName, n);
  return n;
}

const TABLE_STATE_KEY: Record<string, keyof typeof state> = {
  employee_user_links: "employeeUserLinkRows",
  employees: "employeeRows",
  departments: "departmentRows",
  positions: "positionRows",
  master_data_items: "masterDataItemRows",
  learning_courses: "courseRows",
  learning_course_sessions: "courseSessionRows",
  learning_enrollments: "enrollmentRows",
  audit_events: "auditRows",
};

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "organization_memberships") return state.membershipRows;
  if (table.__name === "membership_roles") return state.membershipRoleRows as Record<string, unknown>[];
  if (table.__name === "role_permissions") return state.permissionRows as Record<string, unknown>[];
  if (table.__name === "modules") return state.moduleRows;
  if (table.__name === "organization_modules") return state.organizationModuleRows;
  const key = TABLE_STATE_KEY[table.__name];
  return key ? (state[key] as Record<string, unknown>[]) : [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  const key = TABLE_STATE_KEY[table.__name];
  if (key) (state as never as Record<string, unknown>)[key] = rows;
}

function makeQueryClient(): unknown {
  const client = {
    select: (proj?: Record<string, unknown>) => ({
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
        if (table === membershipRolesTable || table === rolePermissionsTable || table === modulesTable) {
          const rows = rowsFor(table);
          const passthrough = {
            innerJoin: () => passthrough,
            where: () => passthrough,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return passthrough;
        }

        const isCount = !!proj && Object.values(proj).includes("count");
        const rows = rowsFor(table);
        const stage = (
          current: Record<string, unknown>[],
          off = 0,
          lim: number | undefined = undefined,
        ): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const resolved = (): Record<string, unknown>[] => {
            if (isCount) return [{ value: current.length }];
            return lim === undefined ? current.slice(off) : current.slice(off, off + lim);
          };
          const promise = Promise.resolve(resolved());
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond)), off, lim),
            orderBy: () => stage(current, off, lim),
            limit: (n: number) => stage(current, off, n),
            offset: (n: number) => stage(current, n, lim),
            for: () => stage(current, off, lim),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const items = Array.isArray(v) ? v : [v];
        const inserted = items.map((item) => ({ id: nextId(table.__name), createdAt: new Date(), updatedAt: new Date(), ...item }));
        setRowsFor(table, [...rowsFor(table), ...inserted]);
        return { returning: () => Promise.resolve(inserted) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = rowsFor(table);
          const updated: Record<string, unknown>[] = [];
          const next = rows.map((r) => {
            if (matches(r, cond)) {
              const merged = { ...r, ...patch };
              updated.push(merged);
              return merged;
            }
            return r;
          });
          setRowsFor(table, next);
          return { returning: () => Promise.resolve(updated) };
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where(cond: Cond) {
        const rows = rowsFor(table);
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        return Promise.resolve();
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const db = makeQueryClient();

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeeUserLinksTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  masterDataItemsTable,
  learningCoursesTable,
  learningCourseSessionsTable,
  learningEnrollmentsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  ne: (col: string, val: unknown) => ({ __op: "ne", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => "count",
  desc: () => "desc",
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

const HR_USER_ID = 1;
const MANAGER_USER_ID = 2;
const EMPLOYEE_USER_ID = 3;
const EMPLOYEE2_USER_ID = 4; // no manager — used for "not a direct report" cases
const OTHER_ORG_USER_ID = 5;

const HR_EMPLOYEE_ID = 900;
const MANAGER_ID = 200;
const EMPLOYEE_ID = 100; // reports to MANAGER_ID
const EMPLOYEE2_ID = 101; // no manager
const OTHER_ORG_EMPLOYEE_ID = 300;

function mockSession(userId: number) {
  state.sessionRows = [
    {
      session: { id: userId, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee",
        organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date(),
      },
    },
  ];
}

function mockMembership(userId: number, organizationId: number, membershipId: number) {
  state.membershipRows = [
    ...state.membershipRows.filter((m) => (m as Record<string, unknown>).applicationUserId !== userId),
    { id: membershipId, applicationUserId: userId, organizationId, status: "active" },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = permissionKeys.map((key) => ({ key }));
}

const EMPLOYEE_TIER_PERMISSIONS = ["learning.read.own", "learning.write.own", "learning.review.write", "learning.reports.read"];
const HR_TIER_PERMISSIONS = [...EMPLOYEE_TIER_PERMISSIONS, "learning.manage"];

function hrHeaders() {
  mockSession(HR_USER_ID);
  mockPermissions(HR_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${HR_USER_ID}` };
}
function managerHeaders() {
  mockSession(MANAGER_USER_ID);
  mockPermissions(EMPLOYEE_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${MANAGER_USER_ID}` };
}
function employeeHeaders() {
  mockSession(EMPLOYEE_USER_ID);
  mockPermissions(EMPLOYEE_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${EMPLOYEE_USER_ID}` };
}
function employee2Headers() {
  mockSession(EMPLOYEE2_USER_ID);
  mockPermissions(EMPLOYEE_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${EMPLOYEE2_USER_ID}` };
}
function otherOrgHrHeaders() {
  mockSession(OTHER_ORG_USER_ID);
  mockPermissions(HR_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${OTHER_ORG_USER_ID}` };
}

function mockLearningModuleEnabled(organizationId: number) {
  state.moduleRows = [{ id: 1, key: "learning", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  state.organizationModuleRows = [
    ...state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== organizationId),
    { id: state.organizationModuleRows.length + 1, organizationId, moduleId: 1, enabled: true },
  ];
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [];
  state.organizationModuleRows = [];
  state.employeeUserLinkRows = [];
  state.employeeRows = [];
  state.departmentRows = [];
  state.positionRows = [];
  state.masterDataItemRows = [];
  state.courseRows = [];
  state.courseSessionRows = [];
  state.enrollmentRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockMembership(HR_USER_ID, ORG_ID, 1000);
  mockMembership(MANAGER_USER_ID, ORG_ID, 1001);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 1002);
  mockMembership(EMPLOYEE2_USER_ID, ORG_ID, 1003);
  mockMembership(OTHER_ORG_USER_ID, OTHER_ORG_ID, 1004);
  mockLearningModuleEnabled(ORG_ID);
  mockLearningModuleEnabled(OTHER_ORG_ID);

  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: HR_USER_ID, employeeId: HR_EMPLOYEE_ID },
    { id: 2, applicationUserId: MANAGER_USER_ID, employeeId: MANAGER_ID },
    { id: 3, applicationUserId: EMPLOYEE_USER_ID, employeeId: EMPLOYEE_ID },
    { id: 4, applicationUserId: EMPLOYEE2_USER_ID, employeeId: EMPLOYEE2_ID },
    { id: 5, applicationUserId: OTHER_ORG_USER_ID, employeeId: OTHER_ORG_EMPLOYEE_ID },
  ];
  state.employeeRows = [
    { id: HR_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 1, positionId: 1, reportingManagerId: null, employmentStatus: "active" },
    { id: MANAGER_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: MANAGER_ID, employmentStatus: "active" },
    { id: EMPLOYEE2_ID, organizationId: ORG_ID, departmentId: 6, positionId: 9, reportingManagerId: null, employmentStatus: "active" },
    { id: OTHER_ORG_EMPLOYEE_ID, organizationId: OTHER_ORG_ID, departmentId: null, positionId: null, reportingManagerId: null, employmentStatus: "active" },
  ];
  state.masterDataItemRows = [{ id: 1, domain: "training_category", organizationId: null, code: "compliance", label: "Compliance Training", status: "active" }];
});

async function createCourse(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/organizations/${ORG_ID}/learning/courses`)
    .set(hrHeaders())
    .send({ categoryCode: "compliance", title: "Fire Safety", deliveryMode: "self_paced", ...overrides });
  expect(res.status).toBe(201);
  if ((overrides.status as string | undefined) === undefined) {
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${res.body.id}`).set(hrHeaders()).send({ status: "active" });
  }
  return res.body.id as number;
}

async function createSession(courseId: number, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
    .set(hrHeaders())
    .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60, ...overrides });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("Employee-requested enrollment", () => {
  it("auto_approved when the course does not require approval", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.status).toBe(201);
    expect(res.body.originType).toBe("employee_requested");
    expect(res.body.approvalStatus).toBe("auto_approved");
    expect(res.body.status).toBe("assigned");
  });

  it("pending when the course requires approval", async () => {
    const courseId = await createCourse({ requiresApproval: true });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.status).toBe(201);
    expect(res.body.approvalStatus).toBe("pending");
  });

  it("captures full historical snapshots at creation, immutable to a later course edit", async () => {
    const courseId = await createCourse({
      categoryCode: "compliance",
      title: "Fire Safety",
      deliveryMode: "self_paced",
      mandatoryDefault: false,
      hasAssessment: true,
      issuesCertificate: true,
      certificateValidityMonths: 12,
    });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.status).toBe(201);
    expect(res.body.courseTitleSnapshot).toBe("Fire Safety");
    expect(res.body.categorySnapshot).toBe("Compliance Training");
    expect(res.body.deliveryModeSnapshot).toBe("self_paced");
    expect(res.body.hasAssessmentSnapshot).toBe(true);
    expect(res.body.issuesCertificateSnapshot).toBe(true);
    expect(res.body.certificateValidityMonthsSnapshot).toBe(12);
    expect(res.body.departmentIdSnapshot).toBe(5);
    expect(res.body.positionIdSnapshot).toBe(7);
    expect(res.body.managerEmployeeIdSnapshot).toBe(MANAGER_ID);
    expect(res.body.mandatoryAtAssignment).toBe(false);

    // Mutate the live course afterward — the existing enrollment's own
    // snapshot must not change (§9).
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ title: "Renamed Course" });
    const refetch = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${res.body.id}`).set(employeeHeaders());
    expect(refetch.status).toBe(200);
    expect(refetch.body.courseTitleSnapshot).toBe("Fire Safety");
  });

  it("requires sessionId for an instructor-led course", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.status).toBe(400);
  });

  it("forbids sessionId for a self-paced course", async () => {
    const courseId = await createCourse({ deliveryMode: "self_paced" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId: 999 });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate non-terminal enrollment for the same course", async () => {
    const courseId = await createCourse();
    const first = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(second.status).toBe(409);
  });

  it("denies a user with no linked employee record", async () => {
    const courseId = await createCourse();
    state.employeeUserLinkRows = state.employeeUserLinkRows.filter((r) => r.applicationUserId !== EMPLOYEE_USER_ID);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.status).toBe(403);
  });

  it("404s for a nonexistent course, 409s for a draft (not-yet-active) course", async () => {
    const notFound = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/9999/enroll`).set(employeeHeaders()).send({});
    expect(notFound.status).toBe(404);

    const draftCourse = await createCourse({ status: "draft" });
    const draftRes = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${draftCourse}/enroll`).set(employeeHeaders()).send({});
    expect(draftRes.status).toBe(409);
  });
});

describe("HR/L&D assignment", () => {
  it("bulk-assigns all_active employees as hr_assigned/auto_approved", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(hrHeaders())
      .send({ scope: "all_active" });
    expect(res.status).toBe(201);
    expect(res.body.assignedCount).toBeGreaterThan(0);
    for (const e of res.body.enrollments) {
      expect(e.originType).toBe("hr_assigned");
      expect(e.approvalStatus).toBe("auto_approved");
    }
  });

  it("skips (not fails) an employee who already holds a non-terminal enrollment", async () => {
    const courseId = await createCourse();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(hrHeaders())
      .send({ scope: "manual", employeeIds: [EMPLOYEE_ID] });

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(hrHeaders())
      .send({ scope: "manual", employeeIds: [EMPLOYEE_ID, EMPLOYEE2_ID] });
    expect(res.status).toBe(201);
    expect(res.body.assignedCount).toBe(1);
    expect(res.body.skippedCount).toBe(1);
    expect(res.body.skippedEmployeeIds).toEqual([EMPLOYEE_ID]);
  });

  it("rejects a cross-org employeeId in a manual assign", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(hrHeaders())
      .send({ scope: "manual", employeeIds: [OTHER_ORG_EMPLOYEE_ID] });
    expect(res.status).toBe(400);
  });

  it("honors a mandatory override even when the course's own mandatoryDefault is false", async () => {
    const courseId = await createCourse({ mandatoryDefault: false });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(hrHeaders())
      .send({ scope: "manual", employeeIds: [EMPLOYEE_ID], mandatory: true });
    expect(res.status).toBe(201);
    expect(res.body.enrollments[0].mandatoryAtAssignment).toBe(true);
  });
});

describe("Manager assignment", () => {
  it("a manager assigns their own direct report as manager_assigned/auto_approved", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(managerHeaders())
      .send({ scope: "manual", employeeIds: [EMPLOYEE_ID] });
    expect(res.status).toBe(201);
    expect(res.body.enrollments[0].originType).toBe("manager_assigned");
    expect(res.body.enrollments[0].approvalStatus).toBe("auto_approved");
    expect(res.body.enrollments[0].managerEmployeeIdSnapshot).toBe(MANAGER_ID);
  });

  it("a manager may not use an audience-targeting scope", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(managerHeaders())
      .send({ scope: "all_active" });
    expect(res.status).toBe(403);
  });

  it("a manager may not assign an employee who is not their direct report", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/assign`)
      .set(managerHeaders())
      .send({ scope: "manual", employeeIds: [EMPLOYEE2_ID] });
    expect(res.status).toBe(403);
  });
});

describe("Approval decisions", () => {
  async function createPendingRequest() {
    const courseId = await createCourse({ requiresApproval: true });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(res.body.approvalStatus).toBe("pending");
    return res.body.id as number;
  }

  it("the manager of record approves a pending request", async () => {
    const enrollmentId = await createPendingRequest();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/approve`).set(managerHeaders()).send();
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe("approved");
  });

  it("repeat approve, or reject after approve, both 409 (atomic conflict guard)", async () => {
    const enrollmentId = await createPendingRequest();
    const first = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/approve`).set(managerHeaders()).send();
    expect(first.status).toBe(200);
    const repeat = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/approve`).set(managerHeaders()).send();
    expect(repeat.status).toBe(409);
    const rejectAfter = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/reject`).set(managerHeaders()).send();
    expect(rejectAfter.status).toBe(409);
  });

  it("an employee who is neither the manager of record nor HR/L&D cannot decide it", async () => {
    const enrollmentId = await createPendingRequest();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/approve`).set(employee2Headers()).send();
    expect(res.status).toBe(403);
  });

  it("HR/L&D may approve any pending request organization-wide", async () => {
    const enrollmentId = await createPendingRequest();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/approve`).set(hrHeaders()).send();
    expect(res.status).toBe(200);
  });

  it("the requester may never decide their own request, even when they also hold learning.manage", async () => {
    const courseId = await createCourse({ requiresApproval: true });
    const ownRequest = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(hrHeaders()).send({});
    expect(ownRequest.status).toBe(201);
    expect(ownRequest.body.approvalStatus).toBe("pending");

    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${ownRequest.body.id}/approve`).set(hrHeaders()).send();
    expect(res.status).toBe(403);
  });
});

describe("Session capacity", () => {
  it("enforces capacity atomically, and cancellation frees a seat", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led" });
    const sessionId = await createSession(courseId, { capacity: 1 });

    const first = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employee2Headers()).send({ sessionId });
    expect(second.status).toBe(409);

    const cancel = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${first.body.id}/cancel`).set(employeeHeaders()).send();
    expect(cancel.status).toBe(200);

    const third = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employee2Headers()).send({ sessionId });
    expect(third.status).toBe(201);
  });

  it("404s enrolling against a nonexistent session, 409s against a cancelled one", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led" });
    const missing = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId: 9999 });
    expect(missing.status).toBe(404); // "Session not found" is the one CourseSessionNotEnrollable case mapped to 404

    const sessionId = await createSession(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "cancelled" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId });
    expect(res.status).toBe(409);
  });
});

describe("Cancellation", () => {
  it("an employee cancels their own non-mandatory, not-yet-started enrollment without a reason", async () => {
    const courseId = await createCourse({ mandatoryDefault: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(employeeHeaders()).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("an employee may never cancel a mandatory enrollment themselves", async () => {
    const courseId = await createCourse({ mandatoryDefault: true });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(employeeHeaders()).send();
    expect(res.status).toBe(403);
  });

  it("an employee cannot self-cancel once the enrollment is no longer 'assigned'", async () => {
    const courseId = await createCourse({ mandatoryDefault: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    state.enrollmentRows = state.enrollmentRows.map((r) => (r.id === enroll.body.id ? { ...r, status: "in_progress" } : r));
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(employeeHeaders()).send();
    expect(res.status).toBe(409);
  });

  it("HR/L&D must always supply a reason, mandatory or not", async () => {
    const courseId = await createCourse({ mandatoryDefault: true });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const noReason = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(hrHeaders()).send({});
    expect(noReason.status).toBe(400);
    const withReason = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`)
      .set(hrHeaders())
      .send({ cancelReason: "Compliance waiver approved" });
    expect(withReason.status).toBe(200);
    expect(withReason.body.cancelReason).toBe("Compliance waiver approved");
  });

  it("cancelling an already-terminal enrollment 409s", async () => {
    const courseId = await createCourse({ mandatoryDefault: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(employeeHeaders()).send();
    const repeat = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/cancel`).set(employeeHeaders()).send();
    expect(repeat.status).toBe(409);
  });
});

describe("Authorization and tenant isolation", () => {
  it("an unrelated employee cannot view another employee's enrollment; the manager of record and HR/L&D can", async () => {
    const courseId = await createCourse();
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});

    const unrelated = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}`).set(employee2Headers());
    expect(unrelated.status).toBe(403);

    const manager = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}`).set(managerHeaders());
    expect(manager.status).toBe(200);

    const hr = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}`).set(hrHeaders());
    expect(hr.status).toBe(200);
  });

  it("the instructor of record can view an enrollment against their own session", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led" });
    const sessionId = await createSession(courseId, { instructorEmployeeId: EMPLOYEE2_ID });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}`).set(employee2Headers());
    expect(res.status).toBe(200);
  });

  it("GET .../enrollments (org-wide) requires learning.manage — a manager alone is denied", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments`).set(managerHeaders());
    expect(res.status).toBe(403);
  });

  it("team-enrollments returns only the caller's manager-of-record scope", async () => {
    const courseId = await createCourse();
    await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employee2Headers()).send({});

    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/team-enrollments`).set(managerHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("denies cross-org enrollment access", async () => {
    const courseId = await createCourse();
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/learning/enrollments/${enroll.body.id}`).set(otherOrgHrHeaders());
    expect(res.status).toBe(404);
  });
});

describe("Self-paced progress (W88)", () => {
  async function progress(enrollmentId: number, status: string, headers: Record<string, string>) {
    return request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(headers).send({ status });
  }

  it("advances assigned -> in_progress -> completed for an auto-approved self-paced enrollment", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(enroll.body.approvalStatus).toBe("auto_approved");

    const start = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(start.status).toBe(200);
    expect(start.body.status).toBe("in_progress");

    const complete = await progress(enroll.body.id, "completed", employeeHeaders());
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");
    expect(complete.body.completedAt).toBeTruthy();
  });

  it("repeat/out-of-order transitions 409 (atomic conflict guard)", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});

    const completeTooEarly = await progress(enroll.body.id, "completed", employeeHeaders());
    expect(completeTooEarly.status).toBe(409);

    const start = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(start.status).toBe(200);
    const repeatStart = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(repeatStart.status).toBe(409);

    const complete = await progress(enroll.body.id, "completed", employeeHeaders());
    expect(complete.status).toBe(200);
    const repeatComplete = await progress(enroll.body.id, "completed", employeeHeaders());
    expect(repeatComplete.status).toBe(409);
  });

  it("a still-pending request cannot start", async () => {
    const courseId = await createCourse({ requiresApproval: true });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    expect(enroll.body.approvalStatus).toBe("pending");
    const res = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(res.status).toBe(409);
  });

  it("a rejected request can never start", async () => {
    const courseId = await createCourse({ requiresApproval: true });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const reject = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/reject`).set(managerHeaders()).send();
    expect(reject.status).toBe(200);
    const res = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(res.status).toBe(409);
  });

  it("an approved (previously-pending) request may start", async () => {
    const courseId = await createCourse({ requiresApproval: true });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const approve = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enroll.body.id}/approve`).set(managerHeaders()).send();
    expect(approve.status).toBe(200);
    const res = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(res.status).toBe(200);
  });

  it("instructor-led enrollments cannot use this route", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led" });
    const sessionId = await createSession(courseId);
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId });
    const res = await progress(enroll.body.id, "in_progress", employeeHeaders());
    expect(res.status).toBe(403);
  });

  it("an unrelated employee may not advance another employee's enrollment", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await progress(enroll.body.id, "in_progress", employee2Headers());
    expect(res.status).toBe(403);
  });

  it("rejects an invalid target status value", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await progress(enroll.body.id, "cancelled", employeeHeaders());
    expect(res.status).toBe(400);
  });

  it("denies cross-org progress advancement", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enroll = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
    const res = await request(app)
      .patch(`/api/organizations/${OTHER_ORG_ID}/learning/enrollments/${enroll.body.id}/progress`)
      .set(otherOrgHrHeaders())
      .send({ status: "in_progress" });
    expect(res.status).toBe(404);
  });
});
