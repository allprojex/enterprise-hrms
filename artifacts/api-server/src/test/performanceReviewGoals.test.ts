/**
 * Integration tests for Performance Goals/Objectives Management
 * (Phase 3C, W76), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real service-layer
 * validation through supertest. @workspace/db is mocked with the same
 * generic select/insert/update/delete/transaction Cond-matching harness
 * performanceCyclesAndAssignment.test.ts established, extended with
 * employeeUserLinksTable (resolveOwnEmployeeId's own dependency) and
 * performanceReviewGoalsTable. No real database connection is made.
 *
 * Manager-side actions (createManagerGoal, updateGoal's manager path,
 * accept, reject) require the review to be 'draft' or 'manager_review' —
 * a stage no review can reach through any live route in the current
 * baseline (W75 creates reviews directly in self_assessment; W77, which
 * owns the self_assessment -> manager_review transition, does not exist
 * yet). Those paths are exercised here by directly seeding a review row
 * at the required status via state.reviewRows — a fixture-based
 * substitute for a real transition, exactly like W74's rating-scale
 * immutability lock was verified before W75 could create real reviews.
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
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  employeeUserLinksTable,
  employeesTable,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
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
    performanceReviewsTable: mockTable("performance_reviews", [
      "id", "organizationId", "cycleId", "templateId", "ratingScaleId", "employeeId", "reviewerEmployeeId",
      "departmentIdSnapshot", "positionIdSnapshot", "goalsWeight", "competenciesWeight",
      "scoringPrecisionSnapshot", "acknowledgementRequiredSnapshot", "status",
    ]),
    performanceReviewGoalsTable: mockTable("performance_review_goals", [
      "id", "organizationId", "reviewId", "title", "description", "measurementType", "target", "actualResult",
      "unit", "weight", "dueDate", "status", "employeeComment", "managerComment", "computedScore",
      "originType", "approvalStatus", "notApplicable", "notApplicableReason",
    ]),
    performanceReviewCompetenciesTable: mockTable("performance_review_competencies", [
      "id", "organizationId", "reviewId", "label", "description", "weight", "sortOrder",
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
      reviewRows: [] as Record<string, unknown>[],
      goalRows: [] as Record<string, unknown>[],
      reviewCompetencyRows: [] as Record<string, unknown>[],
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
        const inserted = items.map((item) => ({
          id: nextId(table.__name),
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "not_started",
          notApplicable: false,
          ...item,
        }));
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
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
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
const OTHER_EMPLOYEE_USER_ID = 4;
const OTHER_ORG_USER_ID = 5;

// Employee row IDs (distinct from application user IDs above).
const EMPLOYEE_ID = 1;
const MANAGER_ID = 2;
const OTHER_EMPLOYEE_ID = 3;

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
  state.auditRows = [];
  state.nextIds = new Map();

  state.membershipRows = [
    { id: 100, applicationUserId: HR_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 101, applicationUserId: EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 102, applicationUserId: MANAGER_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 103, applicationUserId: OTHER_EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: OTHER_ORG_ID, status: "active" },
  ];
  // The mock's role/permission tables are a blind passthrough (every
  // membership resolves the same permission set, see
  // performanceCyclesAndAssignment.test.ts's own established convention)
  // — so performance.manage is deliberately NOT included by default here,
  // since it would make every caller org-wide-privileged and defeat the
  // own/reviewer-of-record scoping tests below. Every seeded role holds
  // both performance.write.own and performance.review.write per §7's own
  // role matrix (the "manager" tier is a plain employee-role holder whose
  // review.write grant is narrowed to zero effect unless reviewer of
  // record) — matches production seeding. Tests needing performance.manage
  // add it explicitly.
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = [{ key: "performance.read.own" }, { key: "performance.write.own" }, { key: "performance.review.write" }];

  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: HR_USER_ID, employeeId: 99 }, // HR has no review of their own in these fixtures
    { id: 2, applicationUserId: EMPLOYEE_USER_ID, employeeId: EMPLOYEE_ID },
    { id: 3, applicationUserId: MANAGER_USER_ID, employeeId: MANAGER_ID },
    { id: 4, applicationUserId: OTHER_EMPLOYEE_USER_ID, employeeId: OTHER_EMPLOYEE_ID },
  ];
  state.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: MANAGER_ID, employmentStatus: "active" },
    { id: MANAGER_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: OTHER_EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: null, employmentStatus: "active" },
    { id: 99, organizationId: ORG_ID, departmentId: null, positionId: null, reportingManagerId: null, employmentStatus: "active" },
  ];

  state.reviewRows = [
    {
      id: 1, organizationId: ORG_ID, cycleId: 1, templateId: 1, ratingScaleId: 1,
      employeeId: EMPLOYEE_ID, reviewerEmployeeId: MANAGER_ID,
      departmentIdSnapshot: 5, positionIdSnapshot: 7, goalsWeight: 60, competenciesWeight: 40,
      scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: "self_assessment",
    },
  ];
});

function selfAssessmentReviewId(): number {
  return 1;
}

/** Directly stages review #1 at a manager-reachable stage — the fixture substitute for a real self_assessment -> manager_review transition, which doesn't exist until W77 (see file header). */
function stageReviewForManagerReview(): void {
  state.reviewRows = state.reviewRows.map((r) => (r.id === 1 ? { ...r, status: "manager_review" } : r));
}

function goalPayload(overrides: Record<string, unknown> = {}) {
  return { title: "Ship the Q1 report", measurementType: "numeric", target: 10, weight: 50, ...overrides };
}

describe("Performance Review Goals — module gating and authorization", () => {
  it("denies when the performance module is disabled for the organization", async () => {
    state.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`).send(goalPayload());
    expect(res.status).toBe(401);
  });
});

describe("Performance Review Goals — employee proposal", () => {
  it("lets the own employee propose a goal on their self_assessment-status review", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(201);
    expect(res.body.originType).toBe("employee_proposed");
    expect(res.body.approvalStatus).toBe("proposed");
    expect(state.auditRows.some((r) => r.eventType === "performance_review_goal.proposed")).toBe(true);
  });

  it("denies an employee proposing on someone else's review (server-derived identity, not client-supplied)", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(OTHER_EMPLOYEE_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(403);
  });

  it("rejects a qualitative goal with a nonzero weight", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload({ measurementType: "qualitative", target: undefined, weight: 25 }));
    expect(res.status).toBe(400);
  });

  it("accepts a qualitative goal with weight 0 and no target", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ title: "Mentor a junior engineer", measurementType: "qualitative", weight: 0 });
    expect(res.status).toBe(201);
  });

  it("rejects a numeric goal with no target (would divide by zero)", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload({ target: undefined }));
    expect(res.status).toBe(400);
  });

  it("rejects a percentage goal with target over 100", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload({ measurementType: "percentage", target: 150 }));
    expect(res.status).toBe(400);
  });

  it("rejects a boolean goal carrying a unit", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ title: "Pass the audit", measurementType: "boolean", weight: 20, unit: "pass/fail" });
    expect(res.status).toBe(400);
  });

  it("denies proposing while the review is not in self_assessment status", async () => {
    stageReviewForManagerReview();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(409);
  });

  it("denies reading/proposing against another organization's review (tenant isolation)", async () => {
    state.membershipRows.push({ id: 105, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    const res = await request(app)
      .post(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(OTHER_ORG_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(404);
  });
});

describe("Performance Review Goals — proposal editing", () => {
  it("lets the employee edit their own still-proposed goal", async () => {
    const created = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${created.body.id}`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ title: "Ship the Q1 report early" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Ship the Q1 report early");
    // No audit event is named for goal edits (see file header) — only .proposed from creation.
    expect(state.auditRows.filter((r) => (r.eventType as string).startsWith("performance_review_goal"))).toHaveLength(1);
  });

  it("denies an employee editing someone else's proposed goal", async () => {
    const created = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${created.body.id}`)
      .set(auth(OTHER_EMPLOYEE_USER_ID))
      .send({ title: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("Performance Review Goals — manager-created goals (fixture-staged, see file header)", () => {
  it("lets the reviewer of record create an official goal while manager_review, inserted already-accepted", async () => {
    stageReviewForManagerReview();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(MANAGER_USER_ID))
      .send(goalPayload({ title: "Reduce escaped defects" }));
    expect(res.status).toBe(201);
    expect(res.body.originType).toBe("manager");
    expect(res.body.approvalStatus).toBe("accepted");
    expect(state.auditRows.some((r) => r.eventType === "performance_review_goal.accepted" && (r.metadata as { action?: string })?.action === "manager_created")).toBe(true);
  });

  it("denies an unrelated manager (not reviewer of record) from creating a goal", async () => {
    stageReviewForManagerReview();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(OTHER_EMPLOYEE_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(403);
  });

  it("denies manager goal creation while the review is self_assessment (wrong stage — the manager IS the reviewer of record here, so this is a stage conflict, not a scope denial)", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(MANAGER_USER_ID))
      .send(goalPayload());
    expect(res.status).toBe(409);
  });
});

describe("Performance Review Goals — accept/reject (fixture-staged, see file header)", () => {
  async function proposeAndStageForDecision(): Promise<number> {
    const created = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    stageReviewForManagerReview();
    return created.body.id;
  }

  it("lets the reviewer of record accept a proposed goal", async () => {
    const goalId = await proposeAndStageForDecision();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`)
      .set(auth(MANAGER_USER_ID))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe("accepted");
    expect(state.auditRows.some((r) => r.eventType === "performance_review_goal.accepted" && (r.metadata as { action?: string })?.action === "proposal_accepted")).toBe(true);
  });

  it("lets the reviewer edit fields in the same accept action (§12)", async () => {
    const goalId = await proposeAndStageForDecision();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`)
      .set(auth(MANAGER_USER_ID))
      .send({ weight: 75 });
    expect(res.status).toBe(200);
    expect(res.body.weight).toBe(75);
  });

  it("lets the reviewer of record reject a proposed goal with a reason", async () => {
    const goalId = await proposeAndStageForDecision();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/reject`)
      .set(auth(MANAGER_USER_ID))
      .send({ reason: "Not aligned with this cycle's priorities" });
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe("rejected");
    expect(res.body.managerComment).toBe("Not aligned with this cycle's priorities");
    expect(state.auditRows.some((r) => r.eventType === "performance_review_goal.rejected")).toBe(true);
  });

  it("rejects a reject-action with no reason", async () => {
    const goalId = await proposeAndStageForDecision();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/reject`)
      .set(auth(MANAGER_USER_ID))
      .send({});
    expect(res.status).toBe(400);
  });

  it("denies an unrelated manager from accepting a proposal", async () => {
    const goalId = await proposeAndStageForDecision();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`)
      .set(auth(OTHER_EMPLOYEE_USER_ID))
      .send({});
    expect(res.status).toBe(403);
  });

  it("rejects a duplicate accept (terminal-state redecision, controlled 409 not a silent no-op)", async () => {
    const goalId = await proposeAndStageForDecision();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`).set(auth(MANAGER_USER_ID)).send({});
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`).set(auth(MANAGER_USER_ID)).send({});
    expect(second.status).toBe(409);
  });

  it("rejects reject-after-accept", async () => {
    const goalId = await proposeAndStageForDecision();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`).set(auth(MANAGER_USER_ID)).send({});
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/reject`)
      .set(auth(MANAGER_USER_ID))
      .send({ reason: "Too late" });
    expect(res.status).toBe(409);
  });

  it("rejects accept-after-reject", async () => {
    const goalId = await proposeAndStageForDecision();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/reject`)
      .set(auth(MANAGER_USER_ID))
      .send({ reason: "Not needed" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${goalId}/accept`).set(auth(MANAGER_USER_ID)).send({});
    expect(res.status).toBe(409);
  });

  it("denies accept while the review is still self_assessment", async () => {
    const created = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals/${created.body.id}/accept`)
      .set(auth(MANAGER_USER_ID))
      .send({});
    expect(res.status).toBe(409);
  });
});

describe("Performance Review — widened read visibility, goals in response", () => {
  it("lets the review's own employee read it via performance.read.own", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(EMPLOYEE_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.review.id).toBe(selfAssessmentReviewId());
    expect(res.body.goals).toEqual([]);
  });

  it("lets the reviewer of record read it", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(MANAGER_USER_ID));
    expect(res.status).toBe(200);
  });

  it("denies an unrelated employee from reading someone else's review", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(OTHER_EMPLOYEE_USER_ID));
    expect(res.status).toBe(403);
  });

  it("still lets performance.manage read organization-wide", async () => {
    state.permissionRows.push({ key: "performance.manage" });
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(HR_USER_ID));
    expect(res.status).toBe(200);
  });

  it("includes a proposed goal in the review-detail response", async () => {
    await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}/goals`)
      .set(auth(EMPLOYEE_USER_ID))
      .send(goalPayload());
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(EMPLOYEE_USER_ID));
    expect(res.body.goals).toHaveLength(1);
    expect(res.body.goals[0].approvalStatus).toBe("proposed");
  });
});

describe("Performance Review Goals — GET/list audit noise", () => {
  it("generates no audit rows from a plain review read", async () => {
    state.auditRows = [];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${selfAssessmentReviewId()}`).set(auth(EMPLOYEE_USER_ID));
    expect(state.auditRows).toHaveLength(0);
  });
});
