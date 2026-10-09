/**
 * Integration tests for Performance Employee Acknowledgement (Phase 3C,
 * W83A — the finalized -> acknowledged transition closing the gap W83
 * verification found), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real service-layer
 * validation through supertest. @workspace/db is mocked with the same
 * generic Cond-matching harness established by performanceHrReview.test.ts.
 * No real database connection.
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
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeeUserLinksTable,
  employeesTable,
  performanceReviewsTable,
  performanceReviewCompetenciesTable,
  performanceReviewGoalsTable,
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
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "applicationUserId", "employeeId"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "positionId", "reportingManagerId", "employmentStatus"]),
    performanceReviewsTable: mockTable("performance_reviews", [
      "id", "organizationId", "cycleId", "templateId", "ratingScaleId", "employeeId", "reviewerEmployeeId",
      "departmentIdSnapshot", "positionIdSnapshot", "goalsWeight", "competenciesWeight",
      "scoringPrecisionSnapshot", "acknowledgementRequiredSnapshot", "status",
      "selfAssessmentSubmittedAt", "managerReviewSubmittedAt", "hrFinalizedAt", "acknowledgedAt",
      "employeeFinalComment", "computedOverallScore", "hrOverrideScore", "hrOverrideReason", "revisionNumber",
    ]),
    performanceReviewCompetenciesTable: mockTable("performance_review_competencies", ["id", "organizationId", "reviewId", "label", "weight", "sortOrder", "employeeRatingValue", "employeeComment", "managerRatingValue", "managerComment", "notApplicable", "notApplicableReason"]),
    performanceReviewGoalsTable: mockTable("performance_review_goals", ["id", "organizationId", "reviewId", "title", "approvalStatus", "measurementType", "weight", "notApplicable"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId", "metadata", "beforeState", "afterState"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      reviewRows: [] as Record<string, unknown>[],
      reviewCompetencyRows: [] as Record<string, unknown>[],
      goalRows: [] as Record<string, unknown>[],
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
  performance_reviews: "reviewRows",
  performance_review_competencies: "reviewCompetencyRows",
  performance_review_goals: "goalRows",
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
  employeeUserLinksTable,
  employeesTable,
  performanceReviewsTable,
  performanceReviewCompetenciesTable,
  performanceReviewGoalsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const EMPLOYEE_USER_ID = 1;
const UNRELATED_EMPLOYEE_USER_ID = 2;
const HR_USER_ID = 3;
const OTHER_ORG_USER_ID = 4;

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

function auth(userId: number) {
  mockSession(userId);
  return { Authorization: `Bearer token-${userId}` };
}

function baseReview(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, organizationId: ORG_ID, cycleId: 1, templateId: 1, ratingScaleId: 1,
    employeeId: 1, reviewerEmployeeId: 2,
    departmentIdSnapshot: 5, positionIdSnapshot: 7, goalsWeight: 60, competenciesWeight: 40,
    scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: "finalized",
    selfAssessmentSubmittedAt: new Date("2026-01-01"), managerReviewSubmittedAt: new Date("2026-01-02"),
    hrFinalizedAt: new Date("2026-01-03"), acknowledgedAt: null, employeeFinalComment: null,
    computedOverallScore: "88.00", hrOverrideScore: "92.50", hrOverrideReason: "Exceptional impact", revisionNumber: 1,
    ...overrides,
  };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [{ id: 1, key: "performance", status: "active", defaultEnabled: false, requiredModuleKeys: [] }];
  state.organizationModuleRows = [
    { id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true },
    { id: 2, organizationId: OTHER_ORG_ID, moduleId: 1, enabled: true },
  ];
  state.employeeUserLinkRows = [];
  state.employeeRows = [];
  state.reviewRows = [];
  state.reviewCompetencyRows = [];
  state.goalRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  state.membershipRows = [
    { id: 100, applicationUserId: EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 101, applicationUserId: UNRELATED_EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 102, applicationUserId: HR_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 103, applicationUserId: OTHER_ORG_USER_ID, organizationId: OTHER_ORG_ID, status: "active" },
  ];
  state.membershipRoleRows = [{ roleId: 1 }];
  // Every role in this fixture holds performance.write.own (matches the
  // frozen role matrix — every seeded role includes it), so the coarse
  // permission gate never distinguishes these tests; the real dispatch is
  // the service-layer own-review comparison, tested explicitly below.
  state.permissionRows = [{ key: "performance.read.own" }, { key: "performance.write.own" }];

  // employeeId 1 is the review's own employee; employeeId 99 belongs to an
  // unrelated employee who happens to share the same organization.
  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: EMPLOYEE_USER_ID, employeeId: 1 },
    { id: 2, applicationUserId: UNRELATED_EMPLOYEE_USER_ID, employeeId: 99 },
  ];
  state.employeeRows = [
    { id: 1, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: 99, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
  ];

  state.reviewRows = [baseReview()];
});

function reviewId(): number {
  return 1;
}

describe("Performance Acknowledgement — module gating and authentication", () => {
  it("denies when the performance module is disabled", async () => {
    state.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).send();
    expect(res.status).toBe(401);
  });

  it("denies a caller with no membership in the target organization", async () => {
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect([401, 403, 404]).toContain(res.status);
  });
});

describe("Performance Acknowledgement — authorization (own review only)", () => {
  it("denies an unrelated employee from acknowledging someone else's review", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(UNRELATED_EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("denies a caller with no linked employee record at all (HR with no employee link)", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(HR_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("resolves the caller's employee identity server-side, never trusting a client-supplied one", async () => {
    // No employeeId/membershipId field exists on AcknowledgePerformanceReviewInput at all — sending one is a no-op, proven by the own-employee success test below still keying off the server-resolved link.
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ employeeId: 99, membershipId: 999 });
    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe(1); // unaffected by the injected fields
  });

  it("denies cross-org acknowledgement (WWM review requested under a different org context)", async () => {
    state.membershipRows.push({ id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(OTHER_ORG_USER_ID)).send();
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent review id", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/9999/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(404);
  });
});

describe("Performance Acknowledgement — requires finalized status", () => {
  it.each(["draft", "self_assessment", "manager_review", "hr_review"])("rejects acknowledgement while status is %s", async (status) => {
    state.reviewRows[0].status = status;
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(409);
  });

  it("permits acknowledgement when acknowledgementRequiredSnapshot is false (optional, not blocked)", async () => {
    state.reviewRows[0].acknowledgementRequiredSnapshot = false;
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });
});

describe("Performance Acknowledgement — the transition itself", () => {
  it("transitions finalized -> acknowledged with a server-generated acknowledgedAt", async () => {
    const before = Date.now();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
    expect(res.body.acknowledgedAt).toBeTruthy();
    expect(new Date(res.body.acknowledgedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("ignores a client-supplied acknowledgedAt entirely", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ acknowledgedAt: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(new Date(res.body.acknowledgedAt).getFullYear()).not.toBe(2020);
  });

  it("saves an optional employeeFinalComment", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ employeeFinalComment: "I saw this, though I disagree with the timeline." });
    expect(res.status).toBe(200);
    expect(res.body.employeeFinalComment).toBe("I saw this, though I disagree with the timeline.");
  });

  it("acknowledges cleanly with no comment supplied at all", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(res.body.employeeFinalComment).toBeNull();
  });

  it("never mutates manager/HR score fields — computedOverallScore, hrOverrideScore, hrOverrideReason all preserved exactly", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ employeeFinalComment: "noted" });
    expect(res.status).toBe(200);
    expect(res.body.computedOverallScore).toBe("88.00");
    expect(res.body.hrOverrideScore).toBe("92.50");
    expect(res.body.hrOverrideReason).toBe("Exceptional impact");
  });

  it("cannot alter score fields by sending them in the request body (not accepted by the schema at all)", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ computedOverallScore: "1.00", hrOverrideScore: "1.00", status: "draft" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
    expect(res.body.computedOverallScore).toBe("88.00");
    expect(res.body.hrOverrideScore).toBe("92.50");
  });
});

describe("Performance Acknowledgement — atomicity, repeat and concurrent protection", () => {
  it("rejects a second acknowledgement with a controlled 409", async () => {
    const first = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(second.status).toBe(409);
  });

  it("exactly one of two concurrent acknowledgement attempts succeeds", async () => {
    const [a, b] = await Promise.all([
      request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send(),
      request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`).set(auth(EMPLOYEE_USER_ID)).send(),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe("Performance Acknowledgement — audit", () => {
  it("records performance_review.acknowledged with safe metadata, no free-text comment included", async () => {
    await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/acknowledge`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ employeeFinalComment: "a secret grievance" });
    const row = state.auditRows.find((r) => r.eventType === "performance_review.acknowledged");
    expect(row).toBeTruthy();
    expect(JSON.stringify(row!.metadata)).not.toContain("secret grievance");
  });

  it("generates no audit rows from a plain review read", async () => {
    state.auditRows = [];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}`).set(auth(EMPLOYEE_USER_ID));
    expect(state.auditRows).toHaveLength(0);
  });
});
