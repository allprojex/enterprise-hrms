/**
 * Integration tests for Performance Cycles & Review Assignment
 * (Phase 3C, W75), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real service-layer
 * validation through supertest. @workspace/db is mocked with a generic
 * select/insert/update/delete/transaction harness driven by a real
 * eq/and/inArray Cond tree (extends performanceRatingScalesAndTemplates
 * .test.ts's own established pattern with inArray support, since
 * eligibility resolution genuinely needs it). No real database connection
 * is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

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
  performanceRatingScalesTable,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  performanceCyclesTable,
  performanceReviewsTable,
  performanceReviewCompetenciesTable,
  performanceReviewGoalsTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  organizationSettingsTable,
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
    // W76 widened GET .../reviews/:id to resolve the caller's own employee
    // via resolveOwnEmployeeId (employee_user_links) — no test row is
    // seeded (this file's HR_USER_ID has no employee link), so the
    // fallback empty-array path (rowsFor's default for an unlisted table)
    // is exercised: resolveOwnEmployeeId correctly returns null, and every
    // existing test here still passes via performance.manage's org-wide
    // grant, unaffected by this addition.
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "applicationUserId", "employeeId"]),
    // Same widened-route reason as employeeUserLinksTable above: GET
    // .../reviews/:id now also returns `goals` (empty for every review
    // this file creates, since W75 never creates goals).
    performanceReviewGoalsTable: mockTable("performance_review_goals", ["id", "organizationId", "reviewId", "approvalStatus"]),
    performanceRatingScalesTable: mockTable("performance_rating_scales", ["id", "organizationId", "name", "status"]),
    performanceReviewTemplatesTable: mockTable("performance_review_templates", [
      "id", "organizationId", "name", "ratingScaleId", "goalsWeight", "competenciesWeight", "applicabilityScope", "status",
    ]),
    performanceTemplateCompetenciesTable: mockTable("performance_template_competencies", ["id", "templateId", "label", "description", "weight", "sortOrder"]),
    performanceCyclesTable: mockTable("performance_cycles", [
      "id", "organizationId", "name", "cycleType", "startDate", "endDate",
      "selfAssessmentWindowStart", "selfAssessmentWindowEnd",
      "managerReviewWindowStart", "managerReviewWindowEnd",
      "hrFinalizationWindowStart", "hrFinalizationWindowEnd",
      "templateId", "ratingScaleId", "applicabilityScope",
      "applicabilityDepartmentIds", "applicabilityPositionIds", "status",
    ]),
    performanceReviewsTable: mockTable("performance_reviews", [
      "id", "organizationId", "cycleId", "templateId", "ratingScaleId", "employeeId", "reviewerEmployeeId",
      "departmentIdSnapshot", "positionIdSnapshot", "goalsWeight", "competenciesWeight",
      "scoringPrecisionSnapshot", "acknowledgementRequiredSnapshot", "status",
    ]),
    performanceReviewCompetenciesTable: mockTable("performance_review_competencies", [
      "id", "organizationId", "reviewId", "label", "description", "weight", "sortOrder",
    ]),
    employeesTable: mockTable("employees", ["id", "organizationId", "departmentId", "positionId", "reportingManagerId", "employmentStatus"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "name"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings", "updatedAt"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId", "metadata"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      ratingScaleRows: [] as Record<string, unknown>[],
      templateRows: [] as Record<string, unknown>[],
      templateCompetencyRows: [] as Record<string, unknown>[],
      cycleRows: [] as Record<string, unknown>[],
      reviewRows: [] as Record<string, unknown>[],
      reviewCompetencyRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      settingsRows: [] as Record<string, unknown>[],
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
  performance_rating_scales: "ratingScaleRows",
  performance_review_templates: "templateRows",
  performance_template_competencies: "templateCompetencyRows",
  performance_cycles: "cycleRows",
  performance_reviews: "reviewRows",
  performance_review_competencies: "reviewCompetencyRows",
  employees: "employeeRows",
  departments: "departmentRows",
  positions: "positionRows",
  organization_settings: "settingsRows",
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
          revisionNumber: 1,
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
  performanceRatingScalesTable,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  performanceCyclesTable,
  performanceReviewsTable,
  performanceReviewCompetenciesTable,
  performanceReviewGoalsTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  organizationSettingsTable,
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
const OTHER_ORG_USER_ID = 3;

function mockSession(userId: number) {
  // Overwrite, not append — the sessionsTable mock (see makeQueryClient
  // above) is a blind passthrough that ignores its own where()/limit()
  // arguments and returns every row it has, exactly matching
  // performanceRatingScalesAndTemplates.test.ts's own established
  // single-active-session convention: establish exactly one session
  // immediately before the request that needs it, never several at once.
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

/** Establishes this user's session fresh (see mockSession) and returns their auth header — call immediately before each request. */
function auth(userId: number) {
  mockSession(userId);
  return { Authorization: `Bearer token-${userId}` };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.membershipRoleRows = [];
  state.permissionRows = [];
  state.moduleRows = [
    { id: 1, key: "performance", status: "active", defaultEnabled: false, requiredModuleKeys: [] },
  ];
  state.organizationModuleRows = [
    { id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true },
    { id: 2, organizationId: OTHER_ORG_ID, moduleId: 1, enabled: true },
  ];
  state.ratingScaleRows = [];
  state.templateRows = [];
  state.templateCompetencyRows = [];
  state.cycleRows = [];
  state.reviewRows = [];
  state.reviewCompetencyRows = [];
  state.employeeRows = [];
  state.departmentRows = [];
  state.positionRows = [];
  state.settingsRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  state.membershipRows = [
    { id: 100, applicationUserId: HR_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 101, applicationUserId: EMPLOYEE_USER_ID, organizationId: ORG_ID, status: "active" },
    { id: 102, applicationUserId: OTHER_ORG_USER_ID, organizationId: OTHER_ORG_ID, status: "active" },
  ];
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = [{ key: "performance.manage" }, { key: "performance.read.own" }];

  state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Standard 1-5", status: "active" }];
  state.templateRows = [
    { id: 1, organizationId: ORG_ID, name: "Annual Template", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", status: "active" },
  ];
  state.templateCompetencyRows = [
    { id: 1, templateId: 1, label: "Communication", description: null, weight: 100, sortOrder: 0 },
  ];

  state.employeeRows = [
    { id: 1, organizationId: ORG_ID, departmentId: 5, positionId: 7, reportingManagerId: 2, employmentStatus: "active" },
    { id: 2, organizationId: ORG_ID, departmentId: 5, positionId: 8, reportingManagerId: null, employmentStatus: "active" },
    { id: 3, organizationId: ORG_ID, departmentId: 6, positionId: 7, reportingManagerId: null, employmentStatus: "terminated" },
    { id: 4, organizationId: OTHER_ORG_ID, departmentId: null, positionId: null, reportingManagerId: null, employmentStatus: "active" },
  ];
  state.departmentRows = [{ id: 5, organizationId: ORG_ID, name: "Engineering" }, { id: 6, organizationId: ORG_ID, name: "Sales" }];
  state.positionRows = [{ id: 7, organizationId: ORG_ID, name: "Engineer" }];
});

function baseCyclePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "2026 Annual Cycle",
    cycleType: "annual",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    templateId: 1,
    ratingScaleId: 1,
    applicabilityScope: "all_active",
    ...overrides,
  };
}

describe("Performance Cycles — module gating and authorization", () => {
  it("denies when the performance module is disabled for the organization", async () => {
    state.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID));
    expect(res.status).toBe(403);
  });

  it("denies an ordinary employee without performance.manage", async () => {
    state.permissionRows = [{ key: "performance.read.own" }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(EMPLOYEE_USER_ID));
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/cycles`);
    expect(res.status).toBe(401);
  });

  it("allows performance.manage to list cycles", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("Performance Cycles — CRUD and date validation", () => {
  it("creates a cycle in draft status", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(state.auditRows.some((r) => r.eventType === "performance_cycle.created")).toBe(true);
  });

  it("rejects startDate after endDate", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ startDate: "2026-12-31", endDate: "2026-01-01" }));
    expect(res.status).toBe(400);
  });

  it("rejects a self-assessment window outside the cycle's own start/end range", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ selfAssessmentWindowStart: "2025-01-01", selfAssessmentWindowEnd: "2025-02-01" }));
    expect(res.status).toBe(400);
  });

  it("rejects a cross-organization template id", async () => {
    state.templateRows.push({ id: 99, organizationId: OTHER_ORG_ID, name: "Foreign", ratingScaleId: 1, goalsWeight: 100, competenciesWeight: 0, applicabilityScope: "all_active", status: "active" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload({ templateId: 99 }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-active (draft) template", async () => {
    state.templateRows[0].status = "draft";
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    expect(res.status).toBe(400);
  });

  it("rejects a 'department' scope cycle with no applicabilityDepartmentIds", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "department" }));
    expect(res.status).toBe(400);
  });

  it("denies reading another organization's cycle (tenant isolation)", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    state.membershipRows.push({ id: 103, applicationUserId: OTHER_ORG_USER_ID, organizationId: ORG_ID, status: "active" });
    // A membership scoped to ORG_ID reading a cycle created under ORG_ID succeeds; simulate the cross-org path via OTHER_ORG_ID's own route.
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/cycles/${create.body.id}`).set(auth(OTHER_ORG_USER_ID));
    expect(res.status).toBe(404);
  });

  it("blocks editing a cycle once it is no longer draft", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}`).set(auth(HR_USER_ID)).send({ name: "Renamed" });
    expect(res.status).toBe(409);
  });

  it("rejects an invalid status transition (draft cannot go straight to closed)", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}`).set(auth(HR_USER_ID)).send({ status: "closed" });
    expect(res.status).toBe(409);
  });

  it("allows draft -> archived to abandon an unused draft cycle", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}`).set(auth(HR_USER_ID)).send({ status: "archived" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });

  it("allows open -> closed after reviews have been generated", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}`).set(auth(HR_USER_ID)).send({ status: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
    expect(state.auditRows.some((r) => r.eventType === "performance_cycle.closed")).toBe(true);
  });
});

describe("Performance Cycles — generate-reviews (assignment)", () => {
  it("assigns only active, same-org employees for 'all_active' scope, snapshotting reviewer/department/position/weights and creating self_assessment-status reviews with competencies", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});

    expect(res.status).toBe(201);
    // Only employees 1 and 2 are active + same-org (3 is terminated, 4 is another org).
    expect(res.body.reviewsCreated).toBe(2);
    expect(res.body.cycle.status).toBe("open");

    const employee1Review = res.body.reviews.find((r: { employeeId: number }) => r.employeeId === 1);
    expect(employee1Review.status).toBe("self_assessment");
    expect(employee1Review.reviewerEmployeeId).toBe(2); // employees[0].reportingManagerId
    expect(employee1Review.departmentIdSnapshot).toBe(5);
    expect(employee1Review.positionIdSnapshot).toBe(7);
    expect(employee1Review.goalsWeight).toBe(60);
    expect(employee1Review.competenciesWeight).toBe(40);
    expect(employee1Review.acknowledgementRequiredSnapshot).toBe(true); // org-settings default

    const employee2Review = res.body.reviews.find((r: { employeeId: number }) => r.employeeId === 2);
    expect(employee2Review.reviewerEmployeeId).toBeNull(); // no manager

    expect(state.reviewCompetencyRows.filter((c) => c.reviewId === employee1Review.id)).toHaveLength(1);
    expect(state.auditRows.some((r) => r.eventType === "performance_cycle.opened")).toBe(true);
    expect(state.auditRows.filter((r) => r.eventType === "performance_review.assigned")).toHaveLength(2);
  });

  it("rejects generate-reviews on an already-open cycle (one-time action, controlled 409 not a raw constraint error)", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const second = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    expect(second.status).toBe(409);
  });

  it("filters to the named departments for 'department' scope", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "department", applicabilityDepartmentIds: [6] }));
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    // Department 6 only has employee 3, who is terminated — so zero eligible, not an error.
    expect(res.status).toBe(201);
    expect(res.body.reviewsCreated).toBe(0);
  });

  it("requires an explicit employeeIds list for 'manual' scope", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "manual" }));
    const res = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    expect(res.status).toBe(400);
  });

  it("rejects a manual employeeIds entry from another organization", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "manual" }));
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`)
      .set(auth(HR_USER_ID))
      .send({ employeeIds: [4] });
    expect(res.status).toBe(400);
  });

  it("rejects a manual employeeIds entry for an inactive employee", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "manual" }));
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`)
      .set(auth(HR_USER_ID))
      .send({ employeeIds: [3] });
    expect(res.status).toBe(400);
  });

  it("assigns exactly the named employees for 'manual' scope", async () => {
    const create = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles`)
      .set(auth(HR_USER_ID))
      .send(baseCyclePayload({ applicabilityScope: "manual" }));
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`)
      .set(auth(HR_USER_ID))
      .send({ employeeIds: [1] });
    expect(res.status).toBe(201);
    expect(res.body.reviewsCreated).toBe(1);
    expect(res.body.reviews[0].employeeId).toBe(1);
  });
});

describe("Performance Reviews — read, snapshot immutability, tenant isolation", () => {
  it("lists reviews filtered by cycleId", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews?cycleId=${create.body.id}`).set(auth(HR_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns a review with its snapshotted competencies", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const generated = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const reviewId = generated.body.reviews[0].id;
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId}`).set(auth(HR_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.review.id).toBe(reviewId);
    expect(res.body.competencies).toHaveLength(1);
    expect(res.body.competencies[0].label).toBe("Communication");
  });

  it("does not let a later template competency edit be visible on an already-created review snapshot (historical integrity)", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const generated = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const reviewId = generated.body.reviews[0].id;

    // Simulate a later, independent edit to the template's own competency row.
    state.templateCompetencyRows[0].label = "Renamed After The Fact";

    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/reviews/${reviewId}`).set(auth(HR_USER_ID));
    expect(res.body.competencies[0].label).toBe("Communication"); // unchanged — snapshot, not a live reference
  });

  it("denies reading a review through another organization's route", async () => {
    const create = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles`).set(auth(HR_USER_ID)).send(baseCyclePayload());
    const generated = await request(app).post(`/api/organizations/${ORG_ID}/performance/cycles/${create.body.id}/generate-reviews`).set(auth(HR_USER_ID)).send({});
    const reviewId = generated.body.reviews[0].id;
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/reviews/${reviewId}`).set(auth(OTHER_ORG_USER_ID));
    expect(res.status).toBe(404);
  });
});
