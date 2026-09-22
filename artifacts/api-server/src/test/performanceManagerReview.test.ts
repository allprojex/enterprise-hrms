/**
 * Integration tests for Performance Manager Review (Phase 3C, W78),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain plus real service-layer validation (including
 * the deterministic §11 scoring model) through supertest. @workspace/db
 * is mocked with the same generic Cond-matching harness
 * performanceSelfAssessment.test.ts established. No real database
 * connection is made.
 *
 * The lifecycle fixture below starts reviews already in manager_review
 * (rather than staging via SQL, which this workstream's own tests don't
 * need to avoid — only live QA is instructed to use the real routes for
 * every transition) so each test can focus on W78's own behavior; W77's
 * own test file already exhaustively covers the self_assessment ->
 * manager_review transition itself.
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
    performanceReviewsTable: mockTable("performance_reviews", [
      "id", "organizationId", "cycleId", "templateId", "ratingScaleId", "employeeId", "reviewerEmployeeId",
      "departmentIdSnapshot", "positionIdSnapshot", "goalsWeight", "competenciesWeight",
      "scoringPrecisionSnapshot", "acknowledgementRequiredSnapshot", "status",
      "selfAssessmentSubmittedAt", "managerReviewSubmittedAt", "computedOverallScore",
      "hrOverrideScore", "hrOverrideReason",
    ]),
    performanceReviewGoalsTable: mockTable("performance_review_goals", [
      "id", "organizationId", "reviewId", "title", "description", "measurementType", "target", "actualResult",
      "unit", "weight", "dueDate", "status", "employeeComment", "managerComment", "computedScore",
      "originType", "approvalStatus", "notApplicable", "notApplicableReason",
    ]),
    performanceReviewCompetenciesTable: mockTable("performance_review_competencies", [
      "id", "organizationId", "reviewId", "label", "description", "weight", "sortOrder",
      "employeeRatingValue", "employeeComment", "managerRatingValue", "managerComment", "notApplicable", "notApplicableReason",
    ]),
    performanceRatingScalesTable: mockTable("performance_rating_scales", ["id", "organizationId", "name", "status"]),
    performanceRatingScaleLevelsTable: mockTable("performance_rating_scale_levels", ["id", "ratingScaleId", "value", "label", "description", "sortOrder"]),
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
const EMPLOYEE_USER_ID = 1;
const MANAGER_USER_ID = 2;
const OTHER_MANAGER_USER_ID = 3;
const OTHER_ORG_USER_ID = 4;

const EMPLOYEE_ID = 1;
const MANAGER_ID = 2;
const OTHER_MANAGER_ID = 3;

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
  state.ratingScaleRows = [];
  state.ratingScaleLevelRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  state.membershipRows = [
    { id: 100, applicationUserId: EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 101, applicationUserId: MANAGER_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 102, applicationUserId: OTHER_MANAGER_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 103, applicationUserId: OTHER_ORG_USER_ID, organizationId: OTHER_ORG_ID, status: "active" },
  ];
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = [{ key: "performance.read.own" }, { key: "performance.write.own" }, { key: "performance.review.write" }];

  state.employeeUserLinkRows = [
    { id: 1, applicationUserId: EMPLOYEE_USER_ID, employeeId: EMPLOYEE_ID },
    { id: 2, applicationUserId: MANAGER_USER_ID, employeeId: MANAGER_ID },
    { id: 3, applicationUserId: OTHER_MANAGER_USER_ID, employeeId: OTHER_MANAGER_ID },
  ];
  state.employeeRows = [
    { id: EMPLOYEE_ID, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: MANAGER_ID, employmentStatus: "active" },
    { id: MANAGER_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: OTHER_MANAGER_ID, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
  ];

  state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Standard", status: "active" }];
  state.ratingScaleLevelRows = [
    { id: 1, ratingScaleId: 1, value: "1", label: "Low", sortOrder: 0 },
    { id: 2, ratingScaleId: 1, value: "5", label: "High", sortOrder: 1 },
  ];

  state.reviewRows = [
    {
      id: 1, organizationId: ORG_ID, cycleId: 1, templateId: 1, ratingScaleId: 1,
      employeeId: EMPLOYEE_ID, reviewerEmployeeId: MANAGER_ID,
      departmentIdSnapshot: 5, positionIdSnapshot: 7, goalsWeight: 60, competenciesWeight: 40,
      scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: "manager_review",
      selfAssessmentSubmittedAt: new Date(), managerReviewSubmittedAt: null, computedOverallScore: null,
      hrOverrideScore: null, hrOverrideReason: null,
    },
  ];
  state.reviewCompetencyRows = [
    { id: 1, organizationId: ORG_ID, reviewId: 1, label: "Delivery", description: null, weight: 100, sortOrder: 0, employeeRatingValue: "5", employeeComment: "Went well", managerRatingValue: null, managerComment: null, notApplicable: false },
  ];
  state.goalRows = [
    { id: 1, organizationId: ORG_ID, reviewId: 1, title: "Ship X", measurementType: "numeric", target: "10", actualResult: null, weight: 100, originType: "manager", approvalStatus: "accepted", employeeComment: "On track", managerComment: null, computedScore: null, notApplicable: false },
  ];
});

function reviewId(): number {
  return 1;
}

describe("Performance Manager Review — module gating and team-reviews", () => {
  it("denies when the performance module is disabled", async () => {
    state.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/team-reviews`).set(auth(MANAGER_USER_ID));
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/team-reviews`);
    expect(res.status).toBe(401);
  });

  it("lets the reviewer of record list only their own team reviews", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/team-reviews`).set(auth(MANAGER_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reviewerEmployeeId).toBe(MANAGER_ID);
  });

  it("returns an empty list for an unrelated manager", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/team-reviews`).set(auth(OTHER_MANAGER_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("denies the employee (self-service) from accessing manager mutation routes", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(EMPLOYEE_USER_ID)).send();
    expect(res.status).toBe(403);
  });

  it("denies cross-org review access", async () => {
    state.membershipRows.push({ id: 104, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId()}`).set(auth(OTHER_ORG_USER_ID));
    expect(res.status).toBe(404);
  });
});

describe("Performance Manager Review — submitted self-assessment visibility", () => {
  it("shows the reviewer the employee's submitted self-assessment fields", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}`).set(auth(MANAGER_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.competencies[0].employeeRatingValue).toBe("5");
    expect(res.body.goals[0].employeeComment).toBe("On track");
  });
});

describe("Performance Manager Review — competency manager rating", () => {
  it("lets the reviewer of record rate a competency with a valid scale value", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ managerRatingValue: 5, managerComment: "Excellent" });
    expect(res.status).toBe(200);
    expect(res.body.managerRatingValue).toBe("5");
    expect(res.body.employeeRatingValue).toBe("5"); // untouched
  });

  it("rejects a manager rating outside the review's configured rating scale", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ managerRatingValue: 3 });
    expect(res.status).toBe(400);
  });

  it("denies an unrelated manager from rating a competency", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(OTHER_MANAGER_USER_ID))
      .send({ managerRatingValue: 5 });
    expect(res.status).toBe(403);
  });

  it("never lets the manager route touch employeeRatingValue/employeeComment", async () => {
    await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ managerRatingValue: 5 });
    expect(state.reviewCompetencyRows[0].employeeRatingValue).toBe("5");
    expect(state.reviewCompetencyRows[0].employeeComment).toBe("Went well");
  });

  it("marks a competency not applicable with a required reason", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ notApplicable: true, notApplicableReason: "Role changed mid-cycle" });
    expect(res.status).toBe(200);
    expect(res.body.notApplicable).toBe(true);
  });

  it("rejects marking a competency not applicable with no reason", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ notApplicable: true });
    expect(res.status).toBe(400);
  });
});

describe("Performance Manager Review — goal result entry (via the extended W76 PATCH route)", () => {
  it("lets the reviewer of record set actualResult and managerComment on an accepted goal", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ actualResult: 8, managerComment: "Mostly delivered" });
    expect(res.status).toBe(200);
    expect(res.body.actualResult).toBe("8");
  });

  it("rejects actualResult on a qualitative goal", async () => {
    state.goalRows.push({ id: 2, organizationId: ORG_ID, reviewId: 1, title: "Qual", measurementType: "qualitative", target: null, actualResult: null, weight: 0, originType: "manager", approvalStatus: "accepted", employeeComment: null, notApplicable: false });
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/2`)
      .set(auth(MANAGER_USER_ID))
      .send({ actualResult: 5 });
    expect(res.status).toBe(400);
  });

  it("rejects a boolean actualResult that isn't 0 or 1", async () => {
    state.goalRows.push({ id: 3, organizationId: ORG_ID, reviewId: 1, title: "Bool", measurementType: "boolean", target: null, actualResult: null, weight: 0, originType: "manager", approvalStatus: "accepted", employeeComment: null, notApplicable: false });
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/3`)
      .set(auth(MANAGER_USER_ID))
      .send({ actualResult: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects a rating-goal actualResult outside the configured scale", async () => {
    state.goalRows.push({ id: 4, organizationId: ORG_ID, reviewId: 1, title: "Rate", measurementType: "rating", target: null, actualResult: null, weight: 0, originType: "manager", approvalStatus: "accepted", employeeComment: null, notApplicable: false });
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/4`)
      .set(auth(MANAGER_USER_ID))
      .send({ actualResult: 3 });
    expect(res.status).toBe(400);
  });

  it("marks a goal not applicable with a required reason", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ notApplicable: true, notApplicableReason: "Deprioritized" });
    expect(res.status).toBe(200);
    expect(res.body.notApplicable).toBe(true);
  });

  it("denies the employee from setting actualResult through the goal PATCH route", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/goals/1`)
      .set(auth(EMPLOYEE_USER_ID))
      .send({ actualResult: 8 });
    expect(res.status).toBe(403);
  });
});

describe("Performance Manager Review — submission readiness", () => {
  it("blocks submission when a proposed goal remains unresolved", async () => {
    state.goalRows[0].actualResult = "8";
    state.reviewCompetencyRows[0].managerRatingValue = "5";
    state.goalRows.push({ id: 2, organizationId: ORG_ID, reviewId: 1, title: "Pending", measurementType: "numeric", target: "5", actualResult: null, weight: 0, originType: "employee_proposed", approvalStatus: "proposed", employeeComment: null, notApplicable: false });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p: string) => p.includes("Pending"))).toBe(true);
  });

  it("blocks submission when an accepted goal is missing actualResult", async () => {
    state.reviewCompetencyRows[0].managerRatingValue = "5";
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p: string) => p.includes("Ship X"))).toBe(true);
  });

  it("blocks submission when a competency is missing managerRatingValue", async () => {
    state.goalRows[0].actualResult = "8";
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p: string) => p.includes("Delivery"))).toBe(true);
  });

  it("blocks submission when official goal weights don't sum to 100", async () => {
    state.goalRows[0].actualResult = "8";
    state.goalRows[0].weight = 60;
    state.reviewCompetencyRows[0].managerRatingValue = "5";
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p: string) => p.includes("sum to 100"))).toBe(true);
  });

  it("blocks submission when both sections are entirely N/A/empty", async () => {
    state.goalRows[0].notApplicable = true;
    state.goalRows[0].notApplicableReason = "n/a";
    state.reviewCompetencyRows[0].notApplicable = true;
    state.reviewCompetencyRows[0].notApplicableReason = "n/a";
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(400);
    expect(res.body.problems.some((p: string) => p.toLowerCase().includes("scoreable"))).toBe(true);
  });

  it("denies an unrelated manager from submitting", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(OTHER_MANAGER_USER_ID)).send();
    expect(res.status).toBe(403);
  });
});

describe("Performance Manager Review — successful submission, scoring, and lock", () => {
  async function makeReady() {
    state.goalRows[0].actualResult = "8"; // 8/10 -> 80
    state.reviewCompetencyRows[0].managerRatingValue = "5"; // 5/5 -> 100
  }

  it("submits successfully, computes the official score deterministically, sets managerReviewSubmittedAt, and transitions to hr_review", async () => {
    await makeReady();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("hr_review");
    expect(res.body.managerReviewSubmittedAt).toBeTruthy();
    // goalsWeight=60, competenciesWeight=40: 80*0.6 + 100*0.4 = 88
    expect(Number(res.body.computedOverallScore)).toBe(88);
    expect(state.goalRows[0].computedScore).toBe("80");
    expect(state.auditRows.some((r) => r.eventType === "performance_review.manager_review_submitted")).toBe(true);
  });

  it("never lets employee self-rating affect the official score", async () => {
    await makeReady();
    state.reviewCompetencyRows[0].employeeRatingValue = "1"; // would score 20 if it mattered
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.status).toBe(200);
    expect(Number(res.body.computedOverallScore)).toBe(88); // unchanged — employeeRatingValue never enters the formula
  });

  it("leaves hrOverrideScore/hrOverrideReason untouched", async () => {
    await makeReady();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(res.body.hrOverrideScore).toBeNull();
    expect(res.body.hrOverrideReason).toBeNull();
  });

  it("rejects a second submission with a controlled 409", async () => {
    await makeReady();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    expect(second.status).toBe(409);
  });

  it("rejects a manager edit attempt after submission (lock)", async () => {
    await makeReady();
    await request(app).post(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/manager-review`).set(auth(MANAGER_USER_ID)).send();
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}/competencies/1`)
      .set(auth(MANAGER_USER_ID))
      .send({ managerRatingValue: 1 });
    expect(res.status).toBe(409);
  });

  it("GET/list generate no audit noise", async () => {
    state.auditRows = [];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/team-reviews`).set(auth(MANAGER_USER_ID));
    await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId()}`).set(auth(MANAGER_USER_ID));
    expect(state.auditRows).toHaveLength(0);
  });
});
