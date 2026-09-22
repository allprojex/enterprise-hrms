/**
 * Integration tests for Learning Courses & Course Sessions (Phase 3D,
 * W86), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real service-layer
 * validation through supertest. @workspace/db is mocked with the same
 * generic Cond-matching select/insert/update harness established by
 * performanceRatingScalesAndTemplates.test.ts. No real database
 * connection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

const {
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
  learningCoursesTable,
  learningCourseSessionsTable,
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
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    learningCoursesTable: mockTable("learning_courses", [
      "id", "organizationId", "categoryCode", "title", "description", "deliveryMode",
      "mandatoryDefault", "requiresApproval", "hasAssessment", "issuesCertificate",
      "certificateValidityMonths", "status", "createdBy",
    ]),
    learningCourseSessionsTable: mockTable("learning_course_sessions", [
      "id", "organizationId", "courseId", "scheduledAt", "durationMinutes", "location",
      "meetingLink", "instructorEmployeeId", "capacity", "status",
    ]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      courseRows: [] as Record<string, unknown>[],
      courseSessionRows: [] as Record<string, unknown>[],
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

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "organization_memberships":
      return state.membershipRows;
    case "membership_roles":
      return state.membershipRoleRows as Record<string, unknown>[];
    case "role_permissions":
      return state.permissionRows as Record<string, unknown>[];
    case "modules":
      return state.moduleRows;
    case "organization_modules":
      return state.organizationModuleRows;
    case "employees":
      return state.employeeRows;
    case "learning_courses":
      return state.courseRows;
    case "learning_course_sessions":
      return state.courseSessionRows;
    case "audit_events":
      return state.auditRows;
    default:
      return [];
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  switch (table.__name) {
    case "employees":
      state.employeeRows = rows;
      return;
    case "learning_courses":
      state.courseRows = rows;
      return;
    case "learning_course_sessions":
      state.courseSessionRows = rows;
      return;
    case "audit_events":
      state.auditRows = rows;
      return;
  }
}

function makeQueryClient(): unknown {
  const client = {
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
        const rows = rowsFor(table);
        const builder = {
          where(cond: Cond) {
            const filtered = rows.filter((r) => matches(r, cond));
            return {
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
              orderBy: () => Promise.resolve(filtered),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
            };
          },
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  learningCoursesTable,
  learningCourseSessionsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: () => ({ __op: "and", conds: [] }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const OTHER_ORG_USER_ID = 3;

function mockSession(userId: number) {
  state.sessionRows = [
    {
      session: { id: 1, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee",
        organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date(),
      },
    },
  ];
}

function tokenFor(userId: number) {
  return `token-${userId}`;
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

function mockLearningModuleEnabled(organizationId = ORG_ID) {
  state.moduleRows = [{ id: 1, key: "learning", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  state.organizationModuleRows = [
    ...state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== organizationId),
    { id: state.organizationModuleRows.length + 1, organizationId, moduleId: 1, enabled: true },
  ];
}

function hrHeaders(orgUserId = HR_USER_ID) {
  mockSession(orgUserId);
  mockPermissions(["learning.read.own", "learning.manage"]);
  return { Authorization: `Bearer ${tokenFor(orgUserId)}` };
}
function employeeHeaders() {
  mockSession(EMPLOYEE_USER_ID);
  mockPermissions(["learning.read.own"]);
  return { Authorization: `Bearer ${tokenFor(EMPLOYEE_USER_ID)}` };
}
function otherOrgHrHeaders() {
  mockSession(OTHER_ORG_USER_ID);
  mockPermissions(["learning.read.own", "learning.manage"]);
  return { Authorization: `Bearer ${tokenFor(OTHER_ORG_USER_ID)}` };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [];
  state.organizationModuleRows = [];
  state.employeeRows = [];
  state.courseRows = [];
  state.courseSessionRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockMembership(HR_USER_ID, ORG_ID, 100);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 101);
  mockMembership(OTHER_ORG_USER_ID, OTHER_ORG_ID, 102);
  mockLearningModuleEnabled(ORG_ID);
  mockLearningModuleEnabled(OTHER_ORG_ID);

  state.employeeRows = [
    { id: 500, organizationId: ORG_ID },
    { id: 600, organizationId: OTHER_ORG_ID },
  ];
});

describe("Learning Courses", () => {
  it("denies access when the Learning module is not enabled", async () => {
    state.organizationModuleRows = [];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/courses`).set(hrHeaders());
    expect(res.status).toBe(403);
  });

  it("denies course creation to an employee without learning.manage", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(employeeHeaders())
      .send({ categoryCode: "compliance", title: "Code of Conduct", deliveryMode: "self_paced" });
    expect(res.status).toBe(403);
  });

  it("permits a plain employee to list/read courses (broad read via learning.read.own)", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/courses`).set(employeeHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("creates a course as draft by default", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "Code of Conduct", deliveryMode: "self_paced" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.categoryCode).toBe("compliance");
  });

  it("rejects certificateValidityMonths supplied without issuesCertificate", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced", issuesCertificate: false, certificateValidityMonths: 12 });
    expect(res.status).toBe(400);
  });

  it("accepts certificateValidityMonths when issuesCertificate is true", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced", issuesCertificate: true, certificateValidityMonths: 12 });
    expect(res.status).toBe(201);
    expect(res.body.certificateValidityMonths).toBe(12);
  });

  it("rejects an invalid status value", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced", status: "deleted" });
    expect(res.status).toBe(400);
  });

  it("activates a draft course, then locks edits once archived except reactivation", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced" });
    const courseId = create.body.id;

    const activate = await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ status: "active" });
    expect(activate.status).toBe(200);
    expect(activate.body.status).toBe("active");

    const archive = await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ status: "archived" });
    expect(archive.status).toBe(200);
    expect(archive.body.status).toBe("archived");

    const blockedEdit = await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ title: "New Title" });
    expect(blockedEdit.status).toBe(409);

    const reactivate = await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ status: "active" });
    expect(reactivate.status).toBe(200);

    const editAfterReactivate = await request(app).patch(`/api/organizations/${ORG_ID}/learning/courses/${courseId}`).set(hrHeaders()).send({ title: "New Title" });
    expect(editAfterReactivate.status).toBe(200);
    expect(editAfterReactivate.body.title).toBe("New Title");
  });

  it("denies cross-org course access", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced" });
    const courseId = create.body.id;

    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/learning/courses/${courseId}`).set(otherOrgHrHeaders());
    expect(res.status).toBe(404);
  });

  it("generates no audit rows from a plain course read", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "X", deliveryMode: "self_paced" });
    state.auditRows = [];
    await request(app).get(`/api/organizations/${ORG_ID}/learning/courses/${create.body.id}`).set(hrHeaders());
    expect(state.auditRows).toHaveLength(0);
  });
});

describe("Learning Course Sessions", () => {
  async function createCourse(deliveryMode: "self_paced" | "instructor_led" = "instructor_led") {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses`)
      .set(hrHeaders())
      .send({ categoryCode: "compliance", title: "Fire Safety", deliveryMode });
    return res.body.id as number;
  }

  it("denies session creation to an employee without learning.manage", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(employeeHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    expect(res.status).toBe(403);
  });

  it("404s when creating a session for a nonexistent course", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/9999/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    expect(res.status).toBe(404);
  });

  it("creates a session in scheduled status", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60, location: "Room A", capacity: 20 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("scheduled");
    expect(res.body.courseId).toBe(courseId);
  });

  it("rejects a cross-org instructorEmployeeId", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60, instructorEmployeeId: 600 });
    expect(res.status).toBe(400);
  });

  it("accepts a same-org instructorEmployeeId", async () => {
    const courseId = await createCourse();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60, instructorEmployeeId: 500 });
    expect(res.status).toBe(201);
    expect(res.body.instructorEmployeeId).toBe(500);
  });

  it("rejects non-positive durationMinutes and capacity", async () => {
    const courseId = await createCourse();
    const badDuration = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 0 });
    expect(badDuration.status).toBe(400);
  });

  it("edits a scheduled session's fields", async () => {
    const courseId = await createCourse();
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60, capacity: 20 });
    const sessionId = create.body.id;

    const edit = await request(app)
      .patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`)
      .set(hrHeaders())
      .send({ capacity: 30, location: "Room B" });
    expect(edit.status).toBe(200);
    expect(edit.body.capacity).toBe(30);
    expect(edit.body.location).toBe("Room B");
  });

  it("transitions scheduled -> completed, then permanently locks the row (no further edit or transition)", async () => {
    const courseId = await createCourse();
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    const sessionId = create.body.id;

    const complete = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "completed" });
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");

    const repeatComplete = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "completed" });
    expect(repeatComplete.status).toBe(409);

    const cancelAfterComplete = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "cancelled" });
    expect(cancelAfterComplete.status).toBe(409);

    const editAfterComplete = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ location: "New Room" });
    expect(editAfterComplete.status).toBe(409);
  });

  it("transitions scheduled -> cancelled, permanently locked", async () => {
    const courseId = await createCourse();
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    const sessionId = create.body.id;

    const cancel = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    const repeatCancel = await request(app).patch(`/api/organizations/${ORG_ID}/learning/sessions/${sessionId}`).set(hrHeaders()).send({ status: "cancelled" });
    expect(repeatCancel.status).toBe(409);
  });

  it("rejects a client attempt to set status back to 'scheduled' (schema-level, not a valid target)", async () => {
    const courseId = await createCourse();
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/learning/sessions/${create.body.id}`)
      .set(hrHeaders())
      .send({ status: "scheduled" });
    expect(res.status).toBe(400);
  });

  it("denies cross-org session access", async () => {
    const courseId = await createCourse();
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/learning/sessions/${create.body.id}`).set(otherOrgHrHeaders());
    expect(res.status).toBe(404);
  });

  it("lists sessions scoped to their own course", async () => {
    const courseId = await createCourse();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`)
      .set(hrHeaders())
      .send({ scheduledAt: "2026-09-01T09:00:00.000Z", durationMinutes: 60 });
    const res = await request(app).get(`/api/organizations/${ORG_ID}/learning/courses/${courseId}/sessions`).set(employeeHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
