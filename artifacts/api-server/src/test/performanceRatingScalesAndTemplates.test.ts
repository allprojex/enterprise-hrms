/**
 * Integration tests for Performance Rating Scales & Review Templates
 * (Phase 3C, W74), exercising the real requireAuth/requireMembership/
 * requireModuleEnabled/requirePermission chain plus real field-based
 * filtering through supertest. @workspace/db is mocked with a generic
 * select/insert/update/delete/transaction harness driven by a real
 * eq/and Cond tree (mirrors attendanceRegister.test.ts's own pattern,
 * extended with mutation support since these routes write). No real
 * database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

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
  performanceRatingScalesTable,
  performanceRatingScaleLevelsTable,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  performanceReviewsTable,
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
    performanceRatingScalesTable: mockTable("performance_rating_scales", ["id", "organizationId", "name", "description", "status"]),
    performanceRatingScaleLevelsTable: mockTable("performance_rating_scale_levels", ["id", "ratingScaleId", "value", "label", "description", "sortOrder"]),
    performanceReviewTemplatesTable: mockTable("performance_review_templates", [
      "id",
      "organizationId",
      "name",
      "description",
      "ratingScaleId",
      "goalsWeight",
      "competenciesWeight",
      "applicabilityScope",
      "status",
    ]),
    performanceTemplateCompetenciesTable: mockTable("performance_template_competencies", ["id", "templateId", "label", "description", "weight", "sortOrder"]),
    performanceReviewsTable: mockTable("performance_reviews", ["id", "organizationId", "ratingScaleId"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      ratingScaleRows: [] as Record<string, unknown>[],
      ratingScaleLevelRows: [] as Record<string, unknown>[],
      templateRows: [] as Record<string, unknown>[],
      templateCompetencyRows: [] as Record<string, unknown>[],
      reviewRows: [] as Record<string, unknown>[],
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
    case "performance_rating_scales":
      return state.ratingScaleRows;
    case "performance_rating_scale_levels":
      return state.ratingScaleLevelRows;
    case "performance_review_templates":
      return state.templateRows;
    case "performance_template_competencies":
      return state.templateCompetencyRows;
    case "performance_reviews":
      return state.reviewRows;
    case "audit_events":
      return state.auditRows;
    default:
      return [];
  }
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  switch (table.__name) {
    case "performance_rating_scales":
      state.ratingScaleRows = rows;
      return;
    case "performance_rating_scale_levels":
      state.ratingScaleLevelRows = rows;
      return;
    case "performance_review_templates":
      state.templateRows = rows;
      return;
    case "performance_template_competencies":
      state.templateCompetencyRows = rows;
      return;
    case "performance_reviews":
      state.reviewRows = rows;
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
        // membership_roles/role_permissions/modules get a naive passthrough
        // (where()/innerJoin() are no-ops, always the full fixture array) —
        // mirrors attendanceRegister.test.ts's own established convention;
        // only one membership's role/permission fixture is ever seeded per
        // test, so real filtering isn't needed for these three tables.
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
          status: table.__name === "performance_review_templates" ? "draft" : "active",
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
  performanceRatingScalesTable,
  performanceRatingScaleLevelsTable,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  performanceReviewsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "and", conds: [] }),
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
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: ORG_ID,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
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
    { id: membershipId, applicationUserId: userId, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  state.membershipRoleRows = [{ roleId: 1 }];
  state.permissionRows = [...state.permissionRows, ...permissionKeys.map((key) => ({ key }))];
}

function mockPerformanceModuleEnabled(organizationId = ORG_ID) {
  state.moduleRows = [{ id: 1, key: "performance", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
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
  state.ratingScaleRows = [];
  state.ratingScaleLevelRows = [];
  state.templateRows = [];
  state.templateCompetencyRows = [];
  state.reviewRows = [];
  state.auditRows = [];
  state.nextIds = new Map();

  mockMembership(HR_USER_ID, ORG_ID, 100);
  mockMembership(EMPLOYEE_USER_ID, ORG_ID, 101);
  mockMembership(OTHER_ORG_USER_ID, OTHER_ORG_ID, 102);
  mockPerformanceModuleEnabled(ORG_ID);
  mockPerformanceModuleEnabled(OTHER_ORG_ID);
});

// Both HR and employee roles get a fresh session per request via a shared
// membershipRoleRows/permissionRows fixture keyed loosely (mirrors every
// other Cond-matcher test file's simplification: one permission set active
// per test, established by calling mockPermissions with the right keys
// before issuing requests as that user).
function hrHeaders() {
  mockSession(HR_USER_ID);
  mockPermissions(["performance.read.own", "performance.manage"]);
  return { Authorization: `Bearer ${tokenFor(HR_USER_ID)}` };
}
function employeeHeaders() {
  mockSession(EMPLOYEE_USER_ID);
  state.permissionRows = [];
  mockPermissions(["performance.read.own"]);
  return { Authorization: `Bearer ${tokenFor(EMPLOYEE_USER_ID)}` };
}
function otherOrgHrHeaders() {
  mockSession(OTHER_ORG_USER_ID);
  state.permissionRows = [];
  mockPermissions(["performance.read.own", "performance.manage"]);
  return { Authorization: `Bearer ${tokenFor(OTHER_ORG_USER_ID)}` };
}

describe("Performance Rating Scales", () => {
  it("denies access when the Performance module is not enabled", async () => {
    state.organizationModuleRows = [];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/rating-scales`).set(hrHeaders());
    expect(res.status).toBe(403);
  });

  it("denies scale creation to an employee without performance.manage", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/rating-scales`)
      .set(employeeHeaders())
      .send({ name: "5-Point Scale" });
    expect(res.status).toBe(403);
  });

  it("allows HR to create a rating scale", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/rating-scales`)
      .set(hrHeaders())
      .send({ name: "5-Point Scale", description: "Standard scale" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("5-Point Scale");
    expect(res.body.organizationId).toBe(ORG_ID);
  });

  it("allows a plain employee (broad read) to list scales in their own org", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/rating-scales`).set(employeeHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("reads a single own-org scale with its levels", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    state.ratingScaleLevelRows = [{ id: 1, ratingScaleId: 1, value: "5.00", label: "Excellent", description: null, sortOrder: 0 }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders());
    expect(res.status).toBe(200);
    expect(res.body.scale.id).toBe(1);
    expect(res.body.levels).toHaveLength(1);
  });

  it("updates an unused scale's name", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Old Name", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders()).send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
  });

  it("replaces levels with a valid set", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1/levels`)
      .set(hrHeaders())
      .send({
        levels: [
          { value: 1, label: "Poor", sortOrder: 0 },
          { value: 5, label: "Excellent", sortOrder: 1 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("rejects an empty level set", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1/levels`).set(hrHeaders()).send({ levels: [] });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate level values", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1/levels`)
      .set(hrHeaders())
      .send({ levels: [{ value: 3, label: "A", sortOrder: 0 }, { value: 3, label: "B", sortOrder: 1 }] });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate level sortOrder", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1/levels`)
      .set(hrHeaders())
      .send({ levels: [{ value: 3, label: "A", sortOrder: 0 }, { value: 4, label: "B", sortOrder: 0 }] });
    expect(res.status).toBe(400);
  });

  it("denies reading another organization's scale (404, not distinguishing existence)", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/rating-scales/1`).set(otherOrgHrHeaders());
    expect(res.status).toBe(404);
  });

  it("denies updating another organization's scale (404)", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    const res = await request(app)
      .patch(`/api/organizations/${OTHER_ORG_ID}/performance/rating-scales/1`)
      .set(otherOrgHrHeaders())
      .send({ name: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("blocks structural level mutation once the scale has been used by a review (409)", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    state.reviewRows = [{ id: 1, organizationId: ORG_ID, ratingScaleId: 1 }];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1/levels`)
      .set(hrHeaders())
      .send({ levels: [{ value: 9, label: "New", sortOrder: 0 }] });
    expect(res.status).toBe(409);
  });

  it("still allows archiving a used scale (only levels are locked, not status)", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    state.reviewRows = [{ id: 1, organizationId: ORG_ID, ratingScaleId: 1 }];
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders()).send({ status: "archived" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });

  it("audits scale creation but not a name update (frozen §22 has no .updated event for scales)", async () => {
    await request(app).post(`/api/organizations/${ORG_ID}/performance/rating-scales`).set(hrHeaders()).send({ name: "Scale A" });
    expect(state.auditRows.some((r) => r.eventType === "performance_rating_scale.created")).toBe(true);

    state.auditRows = [];
    await request(app).patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders()).send({ name: "Renamed" });
    expect(state.auditRows).toHaveLength(0);
  });

  it("audits archiving a scale", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    await request(app).patch(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders()).send({ status: "archived" });
    expect(state.auditRows.some((r) => r.eventType === "performance_rating_scale.archived")).toBe(true);
  });

  it("GET/list generates no audit noise", async () => {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/rating-scales`).set(hrHeaders());
    await request(app).get(`/api/organizations/${ORG_ID}/performance/rating-scales/1`).set(hrHeaders());
    expect(state.auditRows).toHaveLength(0);
  });
});

describe("Performance Review Templates", () => {
  function seedScale() {
    state.ratingScaleRows = [{ id: 1, organizationId: ORG_ID, name: "Scale A", description: null, status: "active", createdAt: new Date() }];
  }

  it("denies template creation to an employee without performance.manage", async () => {
    seedScale();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/templates`)
      .set(employeeHeaders())
      .send({ name: "Annual Review", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active" });
    expect(res.status).toBe(403);
  });

  it("creates a template with a same-org rating scale", async () => {
    seedScale();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/templates`)
      .set(hrHeaders())
      .send({ name: "Annual Review", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active" });
    expect(res.status).toBe(201);
    expect(res.body.ratingScaleId).toBe(1);
  });

  it("rejects a cross-org ratingScaleId at template creation", async () => {
    seedScale(); // scale belongs to ORG_ID
    const res = await request(app)
      .post(`/api/organizations/${OTHER_ORG_ID}/performance/templates`)
      .set(otherOrgHrHeaders())
      .send({ name: "Annual Review", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active" });
    expect(res.status).toBe(400);
  });

  it("rejects template weights that do not sum to 100", async () => {
    seedScale();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/templates`)
      .set(hrHeaders())
      .send({ name: "Bad Template", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 30, applicabilityScope: "all_active" });
    expect(res.status).toBe(400);
  });

  it("lists and reads own-org templates", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const list = await request(app).get(`/api/organizations/${ORG_ID}/performance/templates`).set(employeeHeaders());
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const read = await request(app).get(`/api/organizations/${ORG_ID}/performance/templates/1`).set(employeeHeaders());
    expect(read.status).toBe(200);
    expect(read.body.template.id).toBe(1);
    expect(read.body.competencies).toEqual([]);
  });

  it("updates a template's fields", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ name: "T1 Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("T1 Renamed");
  });

  it("archives a template, then blocks further edits until reactivated", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const archive = await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ status: "archived" });
    expect(archive.status).toBe(200);
    expect(archive.body.status).toBe("archived");

    const blockedEdit = await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ name: "Nope" });
    expect(blockedEdit.status).toBe(409);

    const reactivate = await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ status: "active" });
    expect(reactivate.status).toBe(200);
  });

  it("template edits never mutate performance_reviews rows", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    state.reviewRows = [{ id: 1, organizationId: ORG_ID, ratingScaleId: 1, templateId: 1, snapshotName: "Original" } as unknown as Record<string, unknown>];
    const before = JSON.stringify(state.reviewRows);
    await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ name: "Changed" });
    expect(JSON.stringify(state.reviewRows)).toBe(before);
  });

  it("denies cross-org template access (404)", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/performance/templates/1`).set(otherOrgHrHeaders());
    expect(res.status).toBe(404);
  });

  it("replaces a template's competency set with valid weights", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/templates/1/competencies`)
      .set(hrHeaders())
      .send({ competencies: [{ label: "Communication", weight: 50, sortOrder: 0 }, { label: "Teamwork", weight: 50, sortOrder: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("rejects competency weights that do not sum to 100", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/templates/1/competencies`)
      .set(hrHeaders())
      .send({ competencies: [{ label: "Communication", weight: 50, sortOrder: 0 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a nonempty competency set when the template's competenciesWeight is 0", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 100, competenciesWeight: 0, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/performance/templates/1/competencies`)
      .set(hrHeaders())
      .send({ competencies: [{ label: "X", weight: 100, sortOrder: 0 }] });
    expect(res.status).toBe(400);
  });

  it("audits template creation and update", async () => {
    seedScale();
    await request(app)
      .post(`/api/organizations/${ORG_ID}/performance/templates`)
      .set(hrHeaders())
      .send({ name: "T1", ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active" });
    expect(state.auditRows.some((r) => r.eventType === "performance_review_template.created")).toBe(true);

    state.auditRows = [];
    await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ name: "T1 Renamed" });
    expect(state.auditRows.some((r) => r.eventType === "performance_review_template.updated")).toBe(true);
  });

  it("audits template archiving distinctly from a routine update", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    await request(app).patch(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders()).send({ status: "archived" });
    expect(state.auditRows.some((r) => r.eventType === "performance_review_template.archived")).toBe(true);
    expect(state.auditRows.some((r) => r.eventType === "performance_review_template.updated")).toBe(false);
  });

  it("GET/list generates no audit noise", async () => {
    seedScale();
    state.templateRows = [
      { id: 1, organizationId: ORG_ID, name: "T1", description: null, ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40, applicabilityScope: "all_active", applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: "draft", createdAt: new Date(), updatedAt: new Date() },
    ];
    await request(app).get(`/api/organizations/${ORG_ID}/performance/templates`).set(hrHeaders());
    await request(app).get(`/api/organizations/${ORG_ID}/performance/templates/1`).set(hrHeaders());
    expect(state.auditRows).toHaveLength(0);
  });
});
