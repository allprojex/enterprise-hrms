/**
 * Integration tests for Recruitment Configuration (Phase 3A, W44):
 * recruitment-settings, recruitment-workflows, and nested stages. Mirrors
 * leaveApprovals.test.ts's harness style (real field-based filtering,
 * a db.transaction mock, and simulated unique-constraint violations),
 * exercising the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. No real database connection
 * is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  recruitmentSettingsTable,
  recruitmentWorkflowsTable,
  recruitmentStagesTable,
  auditEventsTable,
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
      recruitmentSettingsRows: [] as Record<string, unknown>[],
      recruitmentWorkflowRows: [] as Record<string, unknown>[],
      recruitmentStageRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    recruitmentSettingsTable: mockTable("recruitment_settings", [
      "id",
      "organizationId",
      "enabled",
      "internalRecruitmentEnabled",
      "externalRecruitmentEnabled",
      "requireCandidateAccount",
      "defaultWorkflowId",
      "candidateDataRetentionMonths",
      "reapplicationWaitingDays",
      "duplicateCandidatePolicy",
      "defaultOfferExpiryDays",
      "defaultDocumentRequirements",
      "applicationLimitPerCandidate",
    ]),
    recruitmentWorkflowsTable: mockTable("recruitment_workflows", [
      "id",
      "organizationId",
      "name",
      "description",
      "isActive",
      "isDefault",
      "displayOrder",
    ]),
    recruitmentStagesTable: mockTable("recruitment_stages", [
      "id",
      "organizationId",
      "workflowId",
      "name",
      "category",
      "displayOrder",
      "isActive",
      "isTerminal",
    ]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === recruitmentSettingsTable) return fixtures.recruitmentSettingsRows;
  if (table === recruitmentWorkflowsTable) return fixtures.recruitmentWorkflowRows;
  if (table === recruitmentStagesTable) return fixtures.recruitmentStageRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === organizationModulesTable) fixtures.organizationModuleRows = rows;
  else if (table === recruitmentSettingsTable) fixtures.recruitmentSettingsRows = rows;
  else if (table === recruitmentWorkflowsTable) fixtures.recruitmentWorkflowRows = rows;
  else if (table === recruitmentStagesTable) fixtures.recruitmentStageRows = rows;
}

function selectBuilder(table: { __name: string }) {
  if (table === sessionsTable) {
    const rows = fixtures.sessionRows;
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return b;
  }

  const unfiltered =
    table === organizationMembershipsTable
      ? fixtures.membershipRows
      : table === membershipRolesTable
        ? fixtures.membershipRoleRows
        : table === rolePermissionsTable
          ? fixtures.permissionRows
          : table === modulesTable
            ? fixtures.moduleRows
            : undefined;
  if (unfiltered !== undefined) {
    const rows = unfiltered as unknown[];
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return b;
  }

  const rows = getRowsFor(table);
  let filtered = rows;
  const builder = {
    innerJoin: () => builder,
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
    orderBy: () => Promise.resolve(filtered),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
  };
  return builder;
}

function insertRow(table: { __name: string }, v: Record<string, unknown>) {
  if (table === recruitmentWorkflowsTable) {
    const duplicate = fixtures.recruitmentWorkflowRows.some(
      (r) => r.organizationId === v.organizationId && r.name === v.name,
    );
    if (duplicate) return { returning: () => Promise.reject({ code: "23505" }) };
  }
  if (table === recruitmentStagesTable) {
    const duplicate = fixtures.recruitmentStageRows.some(
      (r) => r.workflowId === v.workflowId && (r.name === v.name || r.displayOrder === v.displayOrder),
    );
    if (duplicate) return { returning: () => Promise.reject({ code: "23505" }) };
  }
  if (table === recruitmentSettingsTable) {
    const duplicate = fixtures.recruitmentSettingsRows.some((r) => r.organizationId === v.organizationId);
    if (duplicate) return { returning: () => Promise.resolve([]) }; // onConflictDoNothing shape
  }

  const defaults: Record<string, unknown> =
    table === recruitmentWorkflowsTable
      ? { isActive: true, isDefault: false, description: null, displayOrder: 0 }
      : table === recruitmentStagesTable
        ? { isActive: true, isTerminal: false, color: null, icon: null, isRequired: false }
        : {};
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
  if (table === recruitmentWorkflowsTable) fixtures.recruitmentWorkflowRows = [...fixtures.recruitmentWorkflowRows, row];
  if (table === recruitmentStagesTable) fixtures.recruitmentStageRows = [...fixtures.recruitmentStageRows, row];
  if (table === recruitmentSettingsTable) fixtures.recruitmentSettingsRows = [...fixtures.recruitmentSettingsRows, row];
  return { returning: () => Promise.resolve([row]), onConflictDoNothing: () => ({ returning: () => Promise.resolve([row]) }) };
}

function updateRow(table: { __name: string }, cond: Cond, v: Record<string, unknown>) {
  const rows = getRowsFor(table);
  const idx = rows.findIndex((r) => matches(r, cond));
  if (idx === -1) return Promise.resolve([]);

  if (table === recruitmentWorkflowsTable && v.name !== undefined) {
    const duplicate = rows.some((r, i) => i !== idx && r.organizationId === rows[idx].organizationId && r.name === v.name);
    if (duplicate) return Promise.reject({ code: "23505" });
  }
  if (table === recruitmentStagesTable && (v.name !== undefined || v.displayOrder !== undefined)) {
    const duplicate = rows.some(
      (r, i) =>
        i !== idx &&
        r.workflowId === rows[idx].workflowId &&
        ((v.name !== undefined && r.name === v.name) || (v.displayOrder !== undefined && r.displayOrder === v.displayOrder)),
    );
    if (duplicate) return Promise.reject({ code: "23505" });
  }

  const updated = { ...rows[idx], ...v };
  setRowsFor(
    table,
    rows.map((r, i) => (i === idx ? updated : r)),
  );
  return Promise.resolve([updated]);
}

// For setDefaultRecruitmentWorkflow's bulk "unset all defaults" update — a
// where clause matching multiple rows, applied to every match.
function updateManyRows(table: { __name: string }, cond: Cond, v: Record<string, unknown>) {
  const rows = getRowsFor(table);
  const updatedRows = rows.map((r) => (matches(r, cond) ? { ...r, ...v } : r));
  setRowsFor(table, updatedRows);
  return Promise.resolve(updatedRows.filter((r) => matches(r, cond)));
}

// Drizzle's real update-builder executes on await even without a chained
// .returning() call — a thenable, not just a `{returning}` object. Both
// update wrappers below mirror that, since setDefaultRecruitmentWorkflow's
// first statement (unset the previous default) never calls .returning().
function thenableResult(resultPromise: Promise<unknown>) {
  return {
    returning: () => resultPromise,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resultPromise.then(resolve, reject),
  };
}

function makeQueryClient() {
  return {
    select: () => ({ from: (table: { __name: string }) => selectBuilder(table) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown>) => insertRow(table, v) }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => thenableResult(updateRow(table, cond, v)),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  recruitmentSettingsTable,
  recruitmentWorkflowsTable,
  recruitmentStagesTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ...makeQueryClient(),
        update: (table: { __name: string }) => ({
          set: (v: Record<string, unknown>) => ({
            where: (cond: Cond) => thenableResult(Promise.resolve(updateManyRows(table, cond, v))),
          }),
        }),
      };
      return cb(tx);
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockRecruitmentModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.recruitmentSettingsRows = [];
  fixtures.recruitmentWorkflowRows = [];
  fixtures.recruitmentStageRows = [];
  fixtures.idCounters = new Map();
});

describe("GET/PATCH /api/organizations/:organizationId/recruitment-settings", () => {
  it("returns 403 when the recruitment module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.read"]);
    mockRecruitmentModuleEnabled(false);

    const res = await request(app).get("/api/organizations/10/recruitment-settings").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 403 without recruitment_settings.read even with the module enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app).get("/api/organizations/10/recruitment-settings").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns safe defaults when nothing has been saved yet", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.read"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app).get("/api/organizations/10/recruitment-settings").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.updatedAt).toBeNull();
  });

  it("rejects updates without recruitment_settings.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.read"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .patch("/api/organizations/10/recruitment-settings")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it("persists a valid settings update", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .patch("/api/organizations/10/recruitment-settings")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true, reapplicationWaitingDays: 30 });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.reapplicationWaitingDays).toBe(30);
  });

  it("rejects a negative reapplicationWaitingDays", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .patch("/api/organizations/10/recruitment-settings")
      .set("Authorization", "Bearer valid-token")
      .send({ reapplicationWaitingDays: -1 });
    expect(res.status).toBe(400);
  });

  it("rejects a defaultWorkflowId belonging to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.recruitmentWorkflowRows = [{ id: 1, organizationId: OTHER_ORG_ID, name: "Standard", isActive: true, isDefault: false, displayOrder: 0 }];

    const res = await request(app)
      .patch("/api/organizations/10/recruitment-settings")
      .set("Authorization", "Bearer valid-token")
      .send({ defaultWorkflowId: 1 });
    expect(res.status).toBe(400);
  });
});

describe("GET/POST/PATCH /api/organizations/:organizationId/recruitment-workflows", () => {
  it("creates a workflow", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Standard Hiring" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Standard Hiring");
    expect(res.body.isActive).toBe(true);
    expect(res.body.isDefault).toBe(false);
  });

  it("rejects a duplicate workflow name within the same organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.recruitmentWorkflowRows = [{ id: 1, organizationId: ORG_ID, name: "Standard Hiring", isActive: true, isDefault: false, displayOrder: 0 }];

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Standard Hiring" });
    expect(res.status).toBe(409);
  });

  it("does not leak another organization's workflows into the list", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.read"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.recruitmentWorkflowRows = [
      { id: 1, organizationId: ORG_ID, name: "Mine", isActive: true, isDefault: false, displayOrder: 0 },
      { id: 2, organizationId: OTHER_ORG_ID, name: "Theirs", isActive: true, isDefault: false, displayOrder: 0 },
    ];

    const res = await request(app).get("/api/organizations/10/recruitment-workflows").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Mine");
  });

  it("returns 404 when archiving a workflow that belongs to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.recruitmentWorkflowRows = [{ id: 1, organizationId: OTHER_ORG_ID, name: "Theirs", isActive: true, isDefault: false, displayOrder: 0 }];

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows/1/archive")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("set-default atomically unsets the previous default and sets the new one", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    fixtures.recruitmentWorkflowRows = [
      { id: 1, organizationId: ORG_ID, name: "Old Default", isActive: true, isDefault: true, displayOrder: 0 },
      { id: 2, organizationId: ORG_ID, name: "New Default", isActive: true, isDefault: false, displayOrder: 1 },
    ];

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows/2/set-default")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(fixtures.recruitmentWorkflowRows.find((r) => r.id === 1)!.isDefault).toBe(false);
    expect(fixtures.recruitmentWorkflowRows.find((r) => r.id === 2)!.isDefault).toBe(true);
  });
});

describe("GET/POST/PATCH /api/organizations/:organizationId/recruitment-workflows/:workflowId/stages", () => {
  function mockWorkflow(organizationId = ORG_ID) {
    fixtures.recruitmentWorkflowRows = [{ id: 1, organizationId, name: "Standard Hiring", isActive: true, isDefault: false, displayOrder: 0 }];
  }

  it("creates a stage and derives isTerminal from category", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    mockWorkflow();

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows/1/stages")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Hired", category: "hired", displayOrder: 5 });

    expect(res.status).toBe(201);
    expect(res.body.category).toBe("hired");
    expect(res.body.isTerminal).toBe(true);
  });

  it("a non-terminal category is not marked terminal", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    mockWorkflow();

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows/1/stages")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Applied", category: "applied", displayOrder: 0 });

    expect(res.status).toBe(201);
    expect(res.body.isTerminal).toBe(false);
  });

  it("rejects a duplicate display order within the same workflow", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.manage"]);
    mockRecruitmentModuleEnabled(true);
    mockWorkflow();
    fixtures.recruitmentStageRows = [
      { id: 1, organizationId: ORG_ID, workflowId: 1, name: "Applied", category: "applied", displayOrder: 0, isActive: true, isTerminal: false },
    ];

    const res = await request(app)
      .post("/api/organizations/10/recruitment-workflows/1/stages")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Screening", category: "screening", displayOrder: 0 });

    expect(res.status).toBe(409);
  });

  it("returns 404 for stages of a workflow that does not belong to this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["recruitment_settings.read"]);
    mockRecruitmentModuleEnabled(true);
    mockWorkflow(OTHER_ORG_ID);

    const res = await request(app).get("/api/organizations/10/recruitment-workflows/1/stages").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
