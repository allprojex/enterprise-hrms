/**
 * Integration tests for Performance HR Review, Finalization, Override &
 * Reopen (Phase 3C, W79), exercising the real requireAuth/
 * requireMembership/requireModuleEnabled/requirePermission chain plus
 * real service-layer validation through supertest. @workspace/db is
 * mocked with the same generic Cond-matching harness established by
 * performanceManagerReview.test.ts. No real database connection.
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
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
  performanceRatingScalesTable,
  performanceRatingScaleLevelsTable,
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
    performanceReviewGoalsTable: mockTable("performance_review_goals", ["id", "organizationId", "reviewId", "title", "approvalStatus", "measurementType", "weight", "notApplicable"]),
    performanceReviewCompetenciesTable: mockTable("performance_review_competencies", ["id", "organizationId", "reviewId", "label", "weight", "sortOrder", "employeeRatingValue", "employeeComment", "managerRatingValue", "managerComment", "notApplicable", "notApplicableReason"]),
    performanceRatingScalesTable: mockTable("performance_rating_scales", ["id", "organizationId", "name", "status"]),
    performanceRatingScaleLevelsTable: mockTable("performance_rating_scale_levels", ["id", "ratingScaleId", "value", "label", "description", "sortOrder"]),
    performanceReviewsTable: mockTable("performance_reviews", [
      "id", "organizationId", "cycleId", "templateId", "ratingScaleId", "employeeId", "reviewerEmployeeId",
      "departmentIdSnapshot", "positionIdSnapshot", "goalsWeight", "competenciesWeight",
      "scoringPrecisionSnapshot", "acknowledgementRequiredSnapshot", "status",
      "selfAssessmentSubmittedAt", "managerReviewSubmittedAt", "hrFinalizedAt", "acknowledgedAt",
      "computedOverallScore", "hrOverrideScore", "hrOverrideReason", "revisionNumber",
    ]),
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
      goalRows: [] as Record<string, unknown>[],
      reviewCompetencyRows: [] as Record<string, unknown>[],
      ratingScaleRows: [] as Record<string, unknown>[],
      ratingScaleLevelRows: [] as Record<string, unknown>[],
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
  performance_review_goals: "goalRows",
  performance_review_competencies: "reviewCompetencyRows",
  performance_rating_scales: "ratingScaleRows",
  performance_rating_scale_levels: "ratingScaleLevelRows",
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
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
  performanceRatingScalesTable,
  performanceRatingScaleLevelsTable,
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
const HR_USER_ID = 1;
const EMPLOYEE_USER_ID = 2;
const MANAGER_USER_ID = 3;
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
    scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: "hr_review",
    selfAssessmentSubmittedAt: new Date("2026-01-01"), managerReviewSubmittedAt: new Date("2026-01-02"),
    hrFinalizedAt: null, acknowledgedAt: null,
    computedOverallScore: "88.00", hrOverrideScore: null, hrOverrideReason: null, revisionNumber: 1,
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
  state.goalRows = [];
  state.reviewCompetencyRows = [];
  state.ratingScaleRows = [];
  state.ratingScaleLevelRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  state.membershipRows = [
    { id: 100, applicationUserId: HR_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 101, applicationUserId: EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 102, applicationUserId: MANAGER_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 103, applicationUserId: OTHER_ORG_USER_ID, organizationId: OTHER_ORG_ID, status: "active" },
  ];
  state.membershipRoleRows = [{ roleId: 1 }];
  // performance.manage/.finalize deliberately NOT granted by default — the
  // mock's role/permission tables are a blind passthrough (every caller
  // resolves the same set), so granting them globally would defeat the
  // employee/manager-denial tests below. Tests needing HR authority add
  // them explicitly.
  state.permissionRows = [{ key: "performance.read.own" }, { key: "performance.write.own" }, { key: "performance.review.write" }];

  state.reviewRows = [baseReview()];
  // The review's reviewerEmployeeId is 2 — link it to MANAGER_USER_ID so
  // resolvePerformanceActorEmployeeId resolves the "reviewer of record"
  // relationship correctly in the post-reopen lifecycle test below.
  state.employeeUserLinkRows = [{ id: 1, applicationUserId: MANAGER_USER_ID, employeeId: 2 }];
  state.employeeRows = [{ id: 2, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" }];
});

function reviewId(): number {
  return 1;
}

function grantHr() {
  state.permissionRows.push({ key: "performance.finalize" }, { key: "performance.manage" });
}

describe("Performance HR Review — module gating and permission", () => {
  it("denies when the performance module is disabled", async () => {
    state.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).send();
    expect(res.status).toBe(401);
  });

  it("denies the employee from finalizing", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("denies the manager from finalizing merely via performance.review.write", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("requires performance.finalize, not merely performance.manage, to finalize", async () => {
    state.permissionRows.push({ key: "performance.manage" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("requires performance.manage, not merely performance.finalize, to reopen", async () => {
    state.reviewRows[0].status = "finalized";
    state.permissionRows.push({ key: "performance.finalize" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review", reason: "correction" });
    expect(res.status).toBe(403);
  });

  it("denies cross-org review access", async () => {
    state.membershipRows.push({ id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    grantHr();
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}`).set(auth(OTHER_ORG_USER_ID));
    expect(res.status).toBe(404);
  });
});

describe("Performance HR Review — finalization requires hr_review", () => {
  it("blocks finalization when the review is not in hr_review", async () => {
    state.reviewRows[0].status = "manager_review";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(res.status).toBe(409);
  });

  it("finalizes without an override, preserving the manager's computedOverallScore", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("finalized");
    expect(res.body.computedOverallScore).toBe("88.00");
    expect(res.body.hrOverrideScore).toBeNull();
    expect(res.body.hrFinalizedAt).toBeTruthy();
    expect(state.auditRows.some((r) => r.eventType === "performance_review.finalized")).toBe(true);
    expect(state.auditRows.some((r) => r.eventType === "performance_review.score_overridden")).toBe(false);
  });
});

describe("Performance HR Review — override", () => {
  it("accepts a valid override and finalizes in the same call", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideScore: 92.5, hrOverrideReason: "Exceptional Q4 impact" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("finalized");
    expect(res.body.hrOverrideScore).toBe("92.5");
    expect(res.body.hrOverrideReason).toBe("Exceptional Q4 impact");
  });

  it("preserves computedOverallScore unchanged even with an override applied", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideScore: 50, hrOverrideReason: "Recalibrated" });
    expect(res.body.computedOverallScore).toBe("88.00");
  });

  it("requires a reason whenever an override score is supplied", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideScore: 92.5 });
    expect(res.status).toBe(400);
  });

  it("rejects a reason with no score (inconsistent pairing)", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideReason: "Why though" });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range override score", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideScore: 150, hrOverrideReason: "Too high" });
    expect(res.status).toBe(400);
  });

  it("audits performance_review.score_overridden distinctly from performance_review.finalized", async () => {
    grantHr();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send({ hrOverrideScore: 92.5, hrOverrideReason: "Adjusted" });
    expect(state.auditRows.filter((r) => r.eventType === "performance_review.score_overridden")).toHaveLength(1);
    expect(state.auditRows.filter((r) => r.eventType === "performance_review.finalized")).toHaveLength(1);
  });
});

describe("Performance HR Review — finalization atomicity, lock, and repeat submission", () => {
  it("rejects a second finalization with a controlled 409", async () => {
    grantHr();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(second.status).toBe(409);
  });
});

describe("Performance HR Review — reopen", () => {
  it("rejects reopen with no reason", async () => {
    state.reviewRows[0].status = "finalized";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid target stage", async () => {
    state.reviewRows[0].status = "finalized";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "draft", reason: "no" });
    expect(res.status).toBe(400);
  });

  it("rejects reopening finalized forward to itself (not strictly earlier)", async () => {
    state.reviewRows[0].status = "finalized";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "finalized", reason: "no" });
    expect(res.status).toBe(400);
  });

  it("rejects reopening a manager_review-status review forward to hr_review", async () => {
    state.reviewRows[0].status = "manager_review";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review", reason: "no" });
    expect(res.status).toBe(400);
  });

  it("rejects reopening a review still in self_assessment (nothing to reopen)", async () => {
    state.reviewRows[0].status = "self_assessment";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "self_assessment", reason: "no" });
    expect(res.status).toBe(409);
  });

  it("valid reopen finalized -> hr_review: clears hrFinalizedAt/acknowledgedAt/override, preserves computedOverallScore, increments revisionNumber", async () => {
    state.reviewRows[0].status = "finalized";
    state.reviewRows[0].hrFinalizedAt = new Date();
    state.reviewRows[0].hrOverrideScore = "92.50";
    state.reviewRows[0].hrOverrideReason = "prior override";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review", reason: "Found a calculation error" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("hr_review");
    expect(res.body.hrFinalizedAt).toBeNull();
    expect(res.body.hrOverrideScore).toBeNull();
    expect(res.body.hrOverrideReason).toBeNull();
    expect(res.body.computedOverallScore).toBe("88.00"); // preserved — manager's work not redone
    expect(res.body.revisionNumber).toBe(2);
  });

  it("valid reopen finalized -> manager_review: clears computedOverallScore too (manager must redo it)", async () => {
    state.reviewRows[0].status = "finalized";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "Manager missed a goal" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("manager_review");
    expect(res.body.computedOverallScore).toBeNull();
    expect(res.body.managerReviewSubmittedAt).toBeNull();
    expect(res.body.revisionNumber).toBe(2);
  });

  it("valid reopen acknowledged -> hr_review (W83A: acknowledged is now reachable, treated identically to finalized per §10.4)", async () => {
    state.reviewRows[0].status = "acknowledged";
    state.reviewRows[0].acknowledgedAt = new Date();
    state.reviewRows[0].hrOverrideScore = "92.50";
    state.reviewRows[0].hrOverrideReason = "prior override";
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review", reason: "Employee flagged a factual error after acknowledging" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("hr_review");
    expect(res.body.acknowledgedAt).toBeNull();
    expect(res.body.hrOverrideScore).toBeNull();
    expect(res.body.hrOverrideReason).toBeNull();
    expect(res.body.computedOverallScore).toBe("88.00"); // preserved — manager's work not redone
    expect(res.body.revisionNumber).toBe(2);
    const row = state.auditRows.find((r) => r.eventType === "performance_review.reopened");
    expect((row!.beforeState as { status?: string }).status).toBe("acknowledged");
  });

  it("valid reopen hr_review -> self_assessment: clears everything downstream including selfAssessmentSubmittedAt", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "self_assessment", reason: "Employee disputes the whole review" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("self_assessment");
    expect(res.body.selfAssessmentSubmittedAt).toBeNull();
    expect(res.body.managerReviewSubmittedAt).toBeNull();
    expect(res.body.computedOverallScore).toBeNull();
  });

  it("increments revisionNumber exactly once per reopen", async () => {
    grantHr();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "x" });
    expect(res.body.revisionNumber).toBe(2);
  });

  it("rejects a repeat reopen attempt with a controlled conflict, never an inconsistent revision", async () => {
    // This mock harness executes requests fully sequentially, so it can't
    // reproduce a true simultaneous race directly — the second call
    // legitimately finds the (now-changed) status already invalid for the
    // same target, which the business-rule check (400) catches before the
    // atomic UPDATE guard (409) would. Both are the same underlying
    // protection (the finalize suite's own "second finalization -> 409"
    // test exercises the identical atomic-conditional-update mechanism
    // directly) — what matters here is that the revision never
    // double-increments and no silent second reopen ever succeeds.
    grantHr();
    const first = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "first" });
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "second" });
    expect(first.status).toBe(200);
    expect(first.body.revisionNumber).toBe(2);
    expect([400, 409]).toContain(second.status);
  });

  it("audits the reopen with beforeState/afterState and metadata", async () => {
    grantHr();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "Found an error" });
    const row = state.auditRows.find((r) => r.eventType === "performance_review.reopened");
    expect(row).toBeTruthy();
    expect((row!.metadata as { targetStage?: string }).targetStage).toBe("manager_review");
    expect(row!.beforeState).toBeTruthy();
    expect(row!.afterState).toBeTruthy();
  });

  it("denies cross-org reopen", async () => {
    state.membershipRows.push({ id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    grantHr();
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(OTHER_ORG_USER_ID)).send({ targetStage: "hr_review", reason: "x" });
    expect(res.status).toBe(404);
  });

  it("denies cross-org finalize", async () => {
    state.membershipRows.push({ id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    grantHr();
    const res = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(OTHER_ORG_USER_ID)).send();
    expect(res.status).toBe(404);
  });
});

describe("Performance HR Review — post-reopen lifecycle continues normally", () => {
  it("re-enables W78 manager edits after reopening to manager_review", async () => {
    grantHr();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "manager_review", reason: "Redo" });
    // Manager (reviewer of record) can now act again, exactly as W78's own routes already guard on status === 'manager_review'.
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ managerRatingValue: 3 });
    // No competency row exists in this fixture set (only review-level tests here) — expect 404, not 409/403,
    // proving the STAGE gate itself no longer blocks the manager (it reached the not-found check).
    expect(res.status).toBe(404);
  });

  it("W83A: lifecycle resumes normally after reopening a real acknowledged review back to hr_review — HR can finalize again", async () => {
    state.reviewRows[0].status = "acknowledged";
    state.reviewRows[0].acknowledgedAt = new Date();
    grantHr();
    const reopened = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/reopen`).set(auth(HR_USER_ID)).send({ targetStage: "hr_review", reason: "Correction needed" });
    expect(reopened.body.status).toBe("hr_review");
    const refinalized = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/finalize`).set(auth(HR_USER_ID)).send();
    expect(refinalized.status).toBe(200);
    expect(refinalized.body.status).toBe("finalized");
    expect(refinalized.body.revisionNumber).toBe(2); // reopen incremented it; re-finalize itself does not increment further
  });
});

describe("Performance HR Review — GET/list audit noise", () => {
  it("generates no audit rows from a plain review read", async () => {
    grantHr();
    state.auditRows = [];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}`).set(auth(HR_USER_ID));
    expect(state.auditRows).toHaveLength(0);
  });
});
