/**
 * Integration tests for Learning Certificates & Evidence (Phase 3D, W90),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus real service-layer validation through
 * supertest. @workspace/db is mocked with the same generic Cond-matching
 * harness established by learningEnrollments.test.ts (ne/isNull/count-
 * aware-select/.for("update") support, needed here because certificate
 * issuance is exercised through the real completeEnrollment transaction,
 * not a separate mocked path), extended with:
 *   - learningCertificatesTable / learningEnrollmentEvidenceTable /
 *     employeeDocumentsTable mock tables.
 *   - a hand-rolled innerJoin (learning_enrollment_evidence ->
 *     employee_documents, matched by employeeDocumentId = id), mirroring
 *     performanceReviewEvidence.test.ts's own identical-shaped join.
 *   - `vi.mock("../lib/fileStorage", ...)` — no real disk I/O.
 * No real database connection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "ne"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "and"; conds: Cond[] }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "ne") return row[cond.field] !== cond.val;
  if (cond.__op === "isNull") return row[cond.field] == null;
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
  masterDataItemsTable,
  learningCoursesTable,
  learningCourseSessionsTable,
  learningEnrollmentsTable,
  learningCertificatesTable,
  learningEnrollmentEvidenceTable,
  employeeDocumentsTable,
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
    learningCertificatesTable: mockTable("learning_certificates", [
      "id", "organizationId", "enrollmentId", "employeeId", "courseTitleSnapshot", "certificateNumber",
      "issuedAt", "expiresAt", "status", "revokedByMembershipId", "revokedAt", "revokeReason", "employeeDocumentId",
    ]),
    learningEnrollmentEvidenceTable: mockTable("learning_enrollment_evidence", [
      "id", "organizationId", "enrollmentId", "employeeDocumentId", "addedByMembershipId", "addedAt",
    ]),
    employeeDocumentsTable: mockTable("employee_documents", [
      "id", "organizationId", "employeeId", "categoryCode", "fileName", "storageKey", "mimeType", "fileSize", "uploadedBy",
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
      masterDataItemRows: [] as Record<string, unknown>[],
      courseRows: [] as Record<string, unknown>[],
      courseSessionRows: [] as Record<string, unknown>[],
      enrollmentRows: [] as Record<string, unknown>[],
      certificateRows: [] as Record<string, unknown>[],
      evidenceRows: [] as Record<string, unknown>[],
      documentRows: [] as Record<string, unknown>[],
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
  master_data_items: "masterDataItemRows",
  learning_courses: "courseRows",
  learning_course_sessions: "courseSessionRows",
  learning_enrollments: "enrollmentRows",
  learning_certificates: "certificateRows",
  learning_enrollment_evidence: "evidenceRows",
  employee_documents: "documentRows",
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
            // The only join shape this workstream's own queries ever use:
            // learning_enrollment_evidence -> employee_documents, matched
            // by employeeDocumentId = id — hand-matched here, mirroring
            // performanceReviewEvidence.test.ts's own identical harness.
            innerJoin(joinTable: { __name: string }) {
              const joinRows = rowsFor(joinTable);
              const joined = current.map((r) => {
                const match = joinRows.find((j) => j.id === r.employeeDocumentId);
                return { ...match, ...r };
              });
              return stage(joined, off, lim);
            },
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
        const inserted = items.map((item) => ({ id: nextId(table.__name), createdAt: new Date(), updatedAt: new Date(), addedAt: new Date(), ...item }));
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
  masterDataItemsTable,
  learningCoursesTable,
  learningCourseSessionsTable,
  learningEnrollmentsTable,
  learningCertificatesTable,
  learningEnrollmentEvidenceTable,
  employeeDocumentsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  ne: (col: string, val: unknown) => ({ __op: "ne", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  count: () => "count",
  desc: () => "desc",
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "documents/mock-key.pdf"),
  readOrgFile: vi.fn(async () => Buffer.from("evidence file contents")),
  deleteOrgFile: vi.fn(async () => undefined),
}));

const { default: app } = await import("../app");
const fileStorage = await import("../lib/fileStorage");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

const HR_USER_ID = 1;
const MANAGER_USER_ID = 2;
const EMPLOYEE_USER_ID = 3;
const EMPLOYEE2_USER_ID = 4;
const INSTRUCTOR_USER_ID = 5;
const OTHER_ORG_USER_ID = 6;

const HR_EMPLOYEE_ID = 900;
const MANAGER_ID = 200;
const EMPLOYEE_ID = 100; // reports to MANAGER_ID
const EMPLOYEE2_ID = 101; // no manager, unrelated
const INSTRUCTOR_ID = 201;
const OTHER_ORG_EMPLOYEE_ID = 300;

const PDF_BUFFER = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0)]);

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
function instructorHeaders() {
  mockSession(INSTRUCTOR_USER_ID);
  mockPermissions(EMPLOYEE_TIER_PERMISSIONS);
  return { Authorization: `Bearer token-${INSTRUCTOR_USER_ID}` };
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
  state.masterDataItemRows = [];
  state.courseRows = [];
  state.courseSessionRows = [];
  state.enrollmentRows = [];
  state.certificateRows = [];
  state.evidenceRows = [];
  state.documentRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockMembership(HR_USER_ID, ORG_ID, 1000);
  mockMembership(MANAGER_USER_ID, ORG_ID, 1001);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 1002);
  mockMembership(EMPLOYEE2_USER_ID, ORG_ID, 1003);
  mockMembership(INSTRUCTOR_USER_ID, ORG_ID, 1004);
  mockMembership(OTHER_ORG_USER_ID, OTHER_ORG_ID, 1005);
  mockLearningModuleEnabled(ORG_ID);
  mockLearningModuleEnabled(OTHER_ORG_ID);

  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: HR_USER_ID, employeeId: HR_EMPLOYEE_ID },
    { id: 2, applicationUserId: MANAGER_USER_ID, employeeId: MANAGER_ID },
    { id: 3, applicationUserId: EMPLOYEE_USER_ID, employeeId: EMPLOYEE_ID },
    { id: 4, applicationUserId: EMPLOYEE2_USER_ID, employeeId: EMPLOYEE2_ID },
    { id: 5, applicationUserId: INSTRUCTOR_USER_ID, employeeId: INSTRUCTOR_ID },
    { id: 6, applicationUserId: OTHER_ORG_USER_ID, employeeId: OTHER_ORG_EMPLOYEE_ID },
  ];
  state.employeeRows = [
    { id: HR_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 1, positionId: 1, reportingManagerId: null, employmentStatus: "active" },
    { id: MANAGER_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: MANAGER_ID, employmentStatus: "active" },
    { id: EMPLOYEE2_ID, organizationId: ORG_ID, departmentId: 6, positionId: 9, reportingManagerId: null, employmentStatus: "active" },
    { id: INSTRUCTOR_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: OTHER_ORG_EMPLOYEE_ID, organizationId: OTHER_ORG_ID, departmentId: null, positionId: null, reportingManagerId: null, employmentStatus: "active" },
  ];
  state.masterDataItemRows = [{ id: 1, domain: "training_category", organizationId: null, code: "compliance", label: "Compliance Training", status: "active" }];

  vi.mocked(fileStorage.writeOrgFile).mockClear();
  vi.mocked(fileStorage.deleteOrgFile).mockClear();
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
    .send({ scheduledAt: "2030-09-01T09:00:00.000Z", durationMinutes: 60, instructorEmployeeId: INSTRUCTOR_ID, ...overrides });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function selfPacedEnroll(courseId: number) {
  const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({});
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function instructorLedEnroll(courseId: number, sessionId: number) {
  const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/enroll`).set(employeeHeaders()).send({ sessionId });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("Certificate issuance (via completeEnrollment)", () => {
  it("self-paced, non-assessed, certificate-eligible course -> completing issues a certificate", async () => {
    const courseId = await createCourse({ issuesCertificate: true, certificateValidityMonths: 12, requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(employeeHeaders()).send({ status: "in_progress" });
    const complete = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({});
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");

    expect(state.certificateRows).toHaveLength(1);
    const cert = state.certificateRows[0] as Record<string, unknown>;
    expect(cert.enrollmentId).toBe(enrollmentId);
    expect(cert.employeeId).toBe(EMPLOYEE_ID);
    expect(cert.courseTitleSnapshot).toBe("Fire Safety");
    expect(cert.status).toBe("active");
    expect(cert.expiresAt).toBeInstanceOf(Date);
    const eventTypes = state.auditRows.map((r) => (r as Record<string, unknown>).eventType);
    expect(eventTypes).toContain("learning_certificate.issued");
  });

  it("certificateValidityMonths null -> expiresAt is null (never expires)", async () => {
    const courseId = await createCourse({ issuesCertificate: true, certificateValidityMonths: undefined, requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(employeeHeaders()).send({ status: "in_progress" });
    await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({});
    expect((state.certificateRows[0] as Record<string, unknown>).expiresAt).toBeNull();
  });

  it("assessed course, passed=true -> completed + certificate issued", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led", hasAssessment: true, issuesCertificate: true, requiresApproval: false });
    const sessionId = await createSession(courseId);
    const enrollmentId = await instructorLedEnroll(courseId, sessionId);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(instructorHeaders()).send({ passed: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(state.certificateRows).toHaveLength(1);
  });

  it("assessed course, passed=false -> failed, no certificate ever issued", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led", hasAssessment: true, issuesCertificate: true, requiresApproval: false });
    const sessionId = await createSession(courseId);
    const enrollmentId = await instructorLedEnroll(courseId, sessionId);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(instructorHeaders()).send({ passed: false });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
    expect(state.certificateRows).toHaveLength(0);
  });

  it("certificate-ineligible course (issuesCertificate=false) -> no certificate on completion", async () => {
    const courseId = await createCourse({ issuesCertificate: false, requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(employeeHeaders()).send({ status: "in_progress" });
    await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({});
    expect(state.certificateRows).toHaveLength(0);
  });

  it("repeat completion is rejected (409) and never produces a duplicate certificate", async () => {
    const courseId = await createCourse({ issuesCertificate: true, requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(employeeHeaders()).send({ status: "in_progress" });
    const first = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({});
    expect(first.status).toBe(200);
    const repeat = await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({});
    expect(repeat.status).toBe(409);
    expect(state.certificateRows).toHaveLength(1);
  });

  it("a genuine concurrent completion race issues exactly one certificate", async () => {
    const courseId = await createCourse({ issuesCertificate: true, requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    await request(app).patch(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/progress`).set(employeeHeaders()).send({ status: "in_progress" });

    const [a, b] = await Promise.all([
      request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({}),
      request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/complete`).set(hrHeaders()).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(state.certificateRows).toHaveLength(1);
  });
});

describe("Certificate list/revoke routes", () => {
  beforeEach(() => {
    state.certificateRows = [
      { id: 1, organizationId: ORG_ID, enrollmentId: 1, employeeId: EMPLOYEE_ID, courseTitleSnapshot: "Fire Safety", certificateNumber: null, issuedAt: new Date(), expiresAt: null, status: "active", revokedByMembershipId: null, revokedAt: null, revokeReason: null, employeeDocumentId: null },
      { id: 2, organizationId: ORG_ID, enrollmentId: 2, employeeId: EMPLOYEE2_ID, courseTitleSnapshot: "Other Course", certificateNumber: null, issuedAt: new Date(), expiresAt: null, status: "active", revokedByMembershipId: null, revokedAt: null, revokeReason: null, employeeDocumentId: null },
    ];
  });

  it("my-certificates returns only the caller's own certificates", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/my-certificates`).set(employeeHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].employeeId).toBe(EMPLOYEE_ID);
  });

  it("org-wide certificates list requires learning.manage", async () => {
    const denied = await request(app).get(`/api/organizations/${ORG_ID}/learning/certificates`).set(managerHeaders());
    expect(denied.status).toBe(403);
    const allowed = await request(app).get(`/api/organizations/${ORG_ID}/learning/certificates`).set(hrHeaders());
    expect(allowed.status).toBe(200);
    expect(allowed.body.total).toBe(2);
    expect(allowed.body.items).toHaveLength(2);
  });

  it("HR revokes an active certificate with a mandatory reason", async () => {
    const noReason = await request(app).post(`/api/organizations/${ORG_ID}/learning/certificates/1/revoke`).set(hrHeaders()).send({});
    expect(noReason.status).toBe(400);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/certificates/1/revoke`).set(hrHeaders()).send({ revokeReason: "Issued in error" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");
  });

  it("repeat revocation is rejected -> 409, never restored", async () => {
    await request(app).post(`/api/organizations/${ORG_ID}/learning/certificates/1/revoke`).set(hrHeaders()).send({ revokeReason: "Issued in error" });
    const repeat = await request(app).post(`/api/organizations/${ORG_ID}/learning/certificates/1/revoke`).set(hrHeaders()).send({ revokeReason: "Trying again" });
    expect(repeat.status).toBe(409);
  });

  it("a manager (review.write only, not HR) cannot revoke", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/learning/certificates/1/revoke`).set(managerHeaders()).send({ revokeReason: "x" });
    expect(res.status).toBe(403);
  });

  it("denies cross-org revocation", async () => {
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/learning/certificates/1/revoke`).set(otherOrgHrHeaders()).send({ revokeReason: "x" });
    expect(res.status).toBe(404);
  });
});

function upload(headers: Record<string, string>, enrollmentId: number, opts: { buffer?: Buffer; filename?: string; contentType?: string } = {}) {
  return request(app)
    .post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`)
    .set(headers)
    .attach("file", opts.buffer ?? PDF_BUFFER, { filename: opts.filename ?? "evidence.pdf", contentType: opts.contentType ?? "application/pdf" });
}

describe("Enrollment evidence", () => {
  it("the enrollment's own employee uploads evidence", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const res = await upload(employeeHeaders(), enrollmentId);
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("evidence.pdf");
    expect(state.documentRows).toHaveLength(1);
    expect((state.documentRows[0] as Record<string, unknown>).employeeId).toBe(EMPLOYEE_ID);
    expect((state.documentRows[0] as Record<string, unknown>).categoryCode).toBe("learning_evidence");
    const eventTypes = state.auditRows.map((r) => (r as Record<string, unknown>).eventType);
    expect(eventTypes).toContain("employee_document.uploaded");
    expect(eventTypes).toContain("learning_enrollment.evidence_attached");
  });

  it("the manager of record uploads evidence", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const res = await upload(managerHeaders(), enrollmentId);
    expect(res.status).toBe(201);
  });

  it("the session's own instructor of record uploads evidence", async () => {
    const courseId = await createCourse({ deliveryMode: "instructor_led", requiresApproval: false });
    const sessionId = await createSession(courseId);
    const enrollmentId = await instructorLedEnroll(courseId, sessionId);
    const res = await upload(instructorHeaders(), enrollmentId);
    expect(res.status).toBe(201);
  });

  it("HR uploads evidence organization-wide", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const res = await upload(hrHeaders(), enrollmentId);
    expect(res.status).toBe(201);
  });

  it("an unrelated employee cannot upload evidence", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const res = await upload(employee2Headers(), enrollmentId);
    expect(res.status).toBe(403);
    expect(state.documentRows).toHaveLength(0);
  });

  it("rejects a file whose content does not match an allowed type", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const res = await upload(employeeHeaders(), enrollmentId, { buffer: Buffer.from("not a real pdf"), filename: "fake.pdf" });
    expect(res.status).toBe(400);
    expect(state.documentRows).toHaveLength(0);
  });

  it("rejects an oversized file with a typed 400", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const oversized = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(11 * 1024 * 1024, 0)]);
    const res = await upload(employeeHeaders(), enrollmentId, { buffer: oversized });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10MB/);
  });

  it("cleans up the written file if the DB transaction fails (no orphan)", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    const originalTransaction = db as { transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
    const spy = vi.spyOn(originalTransaction, "transaction").mockRejectedValueOnce(new Error("simulated DB failure"));
    const res = await upload(employeeHeaders(), enrollmentId);
    expect(res.status).toBe(500);
    expect(fileStorage.deleteOrgFile).toHaveBeenCalledWith(ORG_ID, "documents/mock-key.pdf");
    expect(state.documentRows).toHaveLength(0);
    expect(state.evidenceRows).toHaveLength(0);
    spy.mockRestore();
  });

  it("denies evidence upload while the Learning module is disabled", async () => {
    const courseId = await createCourse({ requiresApproval: false });
    const enrollmentId = await selfPacedEnroll(courseId);
    state.organizationModuleRows = [];
    const res = await upload(employeeHeaders(), enrollmentId);
    expect(res.status).toBe(403);
  });

  describe("list and download", () => {
    it("the own employee, manager of record, instructor of record, and HR can all list evidence; an unrelated employee cannot", async () => {
      const courseId = await createCourse({ deliveryMode: "instructor_led", requiresApproval: false });
      const sessionId = await createSession(courseId);
      const enrollmentId = await instructorLedEnroll(courseId, sessionId);
      await upload(employeeHeaders(), enrollmentId);

      const own = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(employeeHeaders());
      expect(own.status).toBe(200);
      expect(own.body).toHaveLength(1);

      const mgr = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(managerHeaders());
      expect(mgr.status).toBe(200);

      const instr = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(instructorHeaders());
      expect(instr.status).toBe(200);

      const hr = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(hrHeaders());
      expect(hr.status).toBe(200);

      const unrelated = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(employee2Headers());
      expect(unrelated.status).toBe(403);
    });

    it("evidence remains visible after the enrollment reaches a terminal state", async () => {
      const courseId = await createCourse({ requiresApproval: false });
      const enrollmentId = await selfPacedEnroll(courseId);
      await upload(employeeHeaders(), enrollmentId);
      await request(app).post(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/cancel`).set(employeeHeaders()).send({});
      const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence`).set(employeeHeaders());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("downloads the file with correct content-type and body, denies an unrelated employee, and 404s a mismatched evidence/enrollment or cross-org pair", async () => {
      const courseId = await createCourse({ requiresApproval: false });
      const enrollmentId = await selfPacedEnroll(courseId);
      const uploaded = await upload(employeeHeaders(), enrollmentId);
      const evidenceId = uploaded.body.id;

      const ok = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`).set(employeeHeaders());
      expect(ok.status).toBe(200);
      expect(ok.headers["content-type"]).toContain("application/pdf");
      expect(Buffer.isBuffer(ok.body) ? ok.body.toString() : ok.text).toBe("evidence file contents");

      const denied = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`).set(employee2Headers());
      expect(denied.status).toBe(403);

      const wrongEvidence = await request(app).get(`/api/organizations/${ORG_ID}/learning/enrollments/${enrollmentId}/evidence/999999/download`).set(employeeHeaders());
      expect(wrongEvidence.status).toBe(404);

      const crossOrg = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`).set(otherOrgHrHeaders());
      expect(crossOrg.status).toBe(404);
    });
  });
});
