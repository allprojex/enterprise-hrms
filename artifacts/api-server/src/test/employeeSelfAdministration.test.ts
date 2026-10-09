/**
 * Self-administration boundary (owner policy, 2026-10-09) — route-level proof
 * through the real middleware chain with @workspace/db mocked (same harness
 * shape as employeesHardening.test.ts). The acting user is identified ONLY
 * through employee_user_links; every assertion below flips on that one row.
 *
 *   - an HR user linked to employee 42 is refused every category-A mutation
 *     on 42 with a stable 403 body, nothing written, a "denied" audit row;
 *   - the same user is permitted the same mutations on employee 43;
 *   - an HR user with no link keeps every existing capability;
 *   - more permissions (org_admin-shaped set) change nothing;
 *   - linking one's own login is refused; linking a colleague is not;
 *   - employee self-service that merely carries an employeeId (HR-originated
 *     data-change request about oneself) is NOT blocked.
 *
 * Nested-resource resolvers, WS-13 approve/apply and the audit rows are
 * proved live in employeeSelfAdministrationLive.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  employmentPeriodsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  performanceReviewsTable,
  performanceCyclesTable,
  employeeDocumentsTable,
  breakGlassGrantsTable,
} = vi.hoisted(() => ({
  fixtures: {
    sessionRows: [] as unknown[],
    membershipRows: [] as unknown[],
    breakGlassGrantRows: [] as Record<string, unknown>[],
    failAuditInsert: false,
    membershipRoleRows: [] as { roleId: number }[],
    permissionRows: [] as { key: string }[],
    departmentRows: [] as Record<string, unknown>[],
    positionRows: [] as Record<string, unknown>[],
    employeeRows: [] as Record<string, unknown>[],
    linkRows: [] as { employeeId: number; applicationUserId: number }[],
    inserted: [] as { table: string; values: Record<string, unknown> }[],
    updated: [] as { table: string; values: Record<string, unknown> }[],
    deleted: [] as { table: string }[],
    idCounters: new Map<string, number>(),
    organizationSettingsRows: [] as Record<string, unknown>[],
    numberingSequenceRows: [] as Record<string, unknown>[],
    employeeNumberAllocationRows: [] as Record<string, unknown>[],
    performanceReviewRows: [] as Record<string, unknown>[],
  },
  usersTable: { __name: "users" },
  sessionsTable: { __name: "sessions" },
  organizationMembershipsTable: { __name: "organization_memberships" },
  membershipRolesTable: { __name: "membership_roles" },
  rolesTable: { __name: "roles" },
  rolePermissionsTable: { __name: "role_permissions" },
  permissionsTable: { __name: "permissions" },
  employeesTable: { __name: "employees" },
  departmentsTable: { __name: "departments" },
  branchesTable: { __name: "branches" },
  positionsTable: { __name: "positions" },
  employeeUserLinksTable: { __name: "employee_user_links" },
  auditEventsTable: { __name: "audit_events" },
  employmentPeriodsTable: { __name: "employment_periods" },
  organizationSettingsTable: { __name: "organization_settings" },
  numberingSequencesTable: { __name: "numbering_sequences" },
  employeeNumberAllocationsTable: { __name: "employee_number_allocations" },
  performanceReviewsTable: { __name: "performance_reviews" },
  performanceCyclesTable: { __name: "performance_cycles" },
  employeeDocumentsTable: { __name: "employee_documents" },
  breakGlassGrantsTable: { __name: "break_glass_grants" },
}));

function nextId(table: { __name: string }): number {
  const id = (fixtures.idCounters.get(table.__name) ?? 0) + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

const dbMock: Record<string, unknown> = {
  select: () => ({
    from(table: { __name: string }) {
      let rows: unknown[] = [];
      if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
      else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
      else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
      else if (table === departmentsTable) rows = fixtures.departmentRows;
      else if (table === positionsTable) rows = fixtures.positionRows;
      else if (table === employeesTable) rows = fixtures.employeeRows;
      else if (table === employeeUserLinksTable) rows = fixtures.linkRows;
      else if (table === organizationSettingsTable) rows = fixtures.organizationSettingsRows;
      else if (table === numberingSequencesTable) rows = fixtures.numberingSequenceRows;
      else if (table === employeeNumberAllocationsTable) rows = fixtures.employeeNumberAllocationRows;
      else if (table === performanceReviewsTable) rows = fixtures.performanceReviewRows;
      else if (table === employeeDocumentsTable) rows = [];
      else if (table === breakGlassGrantsTable) rows = fixtures.breakGlassGrantRows;
      else rows = fixtures.sessionRows;
      const builder = {
        innerJoin: () => builder,
        where: () => builder,
        limit: () => builder,
        orderBy: () => builder,
        offset: () => builder,
        for: () => builder,
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    },
  }),
  insert: (table: { __name: string }) => ({
    values: (v: Record<string, unknown>) => {
      if (table === auditEventsTable && fixtures.failAuditInsert) throw new Error("audit store unavailable");
      fixtures.inserted.push({ table: table.__name, values: v });
      const row = { id: nextId(table), ...v };
      if (table === employeesTable) fixtures.employeeRows = [row];
      else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = [...fixtures.numberingSequenceRows, row];
      else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = [...fixtures.employeeNumberAllocationRows, row];
      const result = { returning: () => Promise.resolve([row]) };
      return { ...result, onConflictDoNothing: () => result };
    },
  }),
  delete: (table: { __name: string }) => ({
    where: () => {
      fixtures.deleted.push({ table: table.__name });
      return Promise.resolve(undefined);
    },
  }),
  update: (table: { __name: string }) => ({
    set: (v: Record<string, unknown>) => ({
      where: () => {
        fixtures.updated.push({ table: table.__name, values: v });
        if (table === employeesTable) {
          const current = (fixtures.employeeRows[0] as Record<string, unknown>) ?? {};
          const updated = { ...current, ...v };
          fixtures.employeeRows = [updated];
          return { returning: () => Promise.resolve([updated]) };
        }
        return { returning: () => Promise.resolve([{ ...v, id: 1 }]) };
      },
    }),
  }),
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock),
  execute: async () => ({ rows: [] }),
};

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  employmentPeriodsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  performanceReviewsTable,
  performanceCyclesTable,
  employeeDocumentsTable,
  breakGlassGrantsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  ne: () => "ne",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  ilike: () => "ilike",
  inArray: () => "inArray",
  desc: () => "desc",
  count: () => "count",
  sql: Object.assign(() => "sql", { raw: () => "sql" }),
}));

const { default: app } = await import("../app");

const ORG = 10;
const ACTOR_USER = 1;
const AUTH = { Authorization: "Bearer valid-token" };
const HR = ["employee.read", "employee.write", "employee.sensitive.read", "employee.sensitive.write", "employee.notes.read"];
const ORG_ADMIN_SHAPED = [...HR, "membership.manage", "organization.update", "role.manage", "employee_number.allocate", "employment_lifecycle.manage"];

function mockSession() {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: ACTOR_USER, expiresAt: new Date(Date.now() + 100000) },
      user: { id: ACTOR_USER, email: "hr@example.com", firstName: "Hilda", lastName: "Human", role: "employee", organizationId: ORG, createdAt: new Date() },
    },
  ];
  fixtures.membershipRows = [{ id: 5, applicationUserId: ACTOR_USER, organizationId: ORG, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

function mockPermissions(keys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

function seedEmployee(id: number, overrides: Record<string, unknown> = {}) {
  const row = {
    id,
    organizationId: ORG,
    employeeNumber: `EMP-00${id}`,
    firstName: "Target",
    lastName: `Employee${id}`,
    workEmail: `e${id}@example.test`,
    employmentStatus: "active",
    hireDate: new Date("2026-01-15T00:00:00Z"),
    dateOfBirth: null,
    probationEndDate: null,
    separationDate: null,
    separationReason: null,
    departmentId: null,
    branchId: null,
    positionId: null,
    reportingManagerId: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  fixtures.employeeRows = [row];
  return row;
}

/** The actor's login is linked to employee `employeeId` — the one fact the policy turns on. */
function linkActorTo(employeeId: number) {
  fixtures.linkRows = [{ employeeId, applicationUserId: ACTOR_USER }];
}

function deniedAudits() {
  return fixtures.inserted.filter((i) => i.table === "audit_events" && i.values.eventType === "employee.self_administration_denied");
}

function expectSelfAdminRefusal(res: request.Response, employeeId: number) {
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("self_administration_forbidden");
  expect(res.body.employeeId).toBe(employeeId);
  expect(res.body.error).toMatch(/your own employee record/);
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.employeeRows = [];
  fixtures.linkRows = [];
  fixtures.inserted = [];
  fixtures.updated = [];
  fixtures.deleted = [];
  fixtures.idCounters = new Map();
  fixtures.organizationSettingsRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.employeeNumberAllocationRows = [];
  fixtures.breakGlassGrantRows = [];
  fixtures.failAuditInsert = false;
  mockSession();
});

const OWN = 42;

const ADMIN_MUTATIONS: Array<[string, string, Record<string, unknown> | undefined, string]> = [
  ["patch", `/api/organizations/${ORG}/employees/${OWN}`, { workLocation: "Kumasi" }, "profile update"],
  ["patch", `/api/organizations/${ORG}/employees/${OWN}`, { phoneNumber: "+233200000099" }, "sensitive update"],
  ["patch", `/api/organizations/${ORG}/employees/${OWN}`, { employmentStatus: "on_leave" }, "status change"],
  ["patch", `/api/organizations/${ORG}/employees/${OWN}`, { reportingManagerId: 43 }, "reporting-manager change"],
  ["post", `/api/organizations/${ORG}/employees/${OWN}/transfer`, { effectiveDate: "2026-10-01", departmentId: 7 }, "transfer"],
  ["post", `/api/organizations/${ORG}/employees/${OWN}/promote`, { positionId: 9, effectiveDate: "2026-10-01" }, "promotion"],
  ["post", `/api/organizations/${ORG}/employees/${OWN}/confirm`, { effectiveDate: "2026-10-01" }, "confirmation"],
  ["post", `/api/organizations/${ORG}/employees/${OWN}/separate`, { separationDate: "2026-10-01" }, "separation"],
  ["post", `/api/organizations/${ORG}/employees/${OWN}/rehire`, undefined, "rehire"],
  ["delete", `/api/organizations/${ORG}/employees/${OWN}/link-user`, undefined, "unlink"],
  ["delete", `/api/organizations/${ORG}/employees/${OWN}/profile-picture`, undefined, "profile-picture removal"],
  ["delete", `/api/organizations/${ORG}/employees/${OWN}/documents/1`, undefined, "document removal"],
];

describe("category-A mutations on the actor's OWN record are refused regardless of role", () => {
  it.each(ADMIN_MUTATIONS)("%s %s (%s) -> 403 self_administration_forbidden, nothing written, denial audited", async (method, path, body, _label) => {
    mockPermissions(HR);
    seedEmployee(OWN, { employmentStatus: path.endsWith("/rehire") ? "terminated" : path.endsWith("/confirm") ? "probation" : "active" });
    linkActorTo(OWN);
    const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
    let req = agent[method](path).set(AUTH);
    if (body) req = req.send(body);
    const res = await req;
    expectSelfAdminRefusal(res, OWN);
    expect(fixtures.updated).toEqual([]);
    expect(fixtures.deleted).toEqual([]);
    expect(fixtures.inserted.filter((i) => i.table !== "audit_events")).toEqual([]);
    const denied = deniedAudits();
    expect(denied).toHaveLength(1);
    expect(denied[0].values.outcome).toBe("denied");
    expect(denied[0].values.targetId).toBe(String(OWN));
  });

  it("holding an organisation-administrator-shaped permission set changes nothing", async () => {
    mockPermissions(ORG_ADMIN_SHAPED);
    seedEmployee(OWN);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ workLocation: "Kumasi" });
    expectSelfAdminRefusal(res, OWN);
    expect(fixtures.updated).toEqual([]);
  });

  it("staff-number allocation on the actor's own record is refused", async () => {
    mockPermissions([...HR, "employee_number.allocate"]);
    seedEmployee(OWN, { employeeNumber: null });
    linkActorTo(OWN);
    const res = await request(app).post(`/api/organizations/${ORG}/employees/${OWN}/number/allocate`).set(AUTH).send({ mode: "manual", employeeNumber: "ME-0001" });
    expectSelfAdminRefusal(res, OWN);
    expect(fixtures.inserted.filter((i) => i.table === "employee_number_allocations")).toEqual([]);
  });

  it("the refusal is decided before validation: even an invalid body on the own record answers 403, not 400", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ workEmail: "not-an-email" });
    expectSelfAdminRefusal(res, OWN);
  });
});

describe("the same actor keeps every capability on OTHER records, and an unlinked actor keeps everything", () => {
  it("HR linked to 42 updates 43 normally", async () => {
    mockPermissions(HR);
    seedEmployee(43);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/43`).set(AUTH).send({ workLocation: "Kumasi", phoneNumber: "+233200000001" });
    expect(res.status).toBe(200);
    expect(res.body.workLocation).toBe("Kumasi");
    expect(deniedAudits()).toEqual([]);
  });

  it("HR linked to 42 separates 43 normally", async () => {
    mockPermissions(HR);
    seedEmployee(43);
    linkActorTo(OWN);
    const res = await request(app).post(`/api/organizations/${ORG}/employees/43/separate`).set(AUTH).send({ separationDate: "2026-10-01" });
    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("terminated");
  });

  it("an HR user with NO employee link administers 42 exactly as before", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    fixtures.linkRows = [];
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ workLocation: "Kumasi" });
    expect(res.status).toBe(200);
    expect(deniedAudits()).toEqual([]);
  });

  it("an ordinary employee still cannot modify a colleague (permission gate unchanged)", async () => {
    mockPermissions(["employee.read"]);
    seedEmployee(43);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/43`).set(AUTH).send({ workLocation: "Kumasi" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
  });
});

describe("account linking", () => {
  it("refuses linking one's OWN login to an employee record", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    const res = await request(app).post(`/api/organizations/${ORG}/employees/${OWN}/link-user`).set(AUTH).send({ applicationUserId: ACTOR_USER });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("self_administration_forbidden");
    expect(res.body.employeeId).toBe(OWN);
    expect(res.body.error).toMatch(/your own login account/);
    expect(fixtures.inserted.filter((i) => i.table === "employee_user_links")).toEqual([]);
    expect(deniedAudits()).toHaveLength(1);
  });

  it("linking a colleague's login is unaffected", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    fixtures.membershipRows = [
      ...fixtures.membershipRows,
      { id: 6, applicationUserId: 7, organizationId: ORG, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    const res = await request(app).post(`/api/organizations/${ORG}/employees/${OWN}/link-user`).set(AUTH).send({ applicationUserId: 7 });
    expect(res.status).toBe(200);
  });
});

describe("governed self-service is preserved for an HR user", () => {
  it("reading one's own record is unaffected", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    linkActorTo(OWN);
    const res = await request(app).get(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.sensitiveFieldsRedacted).toBe(false);
  });
});

/**
 * Release gate (2026-10-10): a platform super_admin with NO membership in the
 * organization, acting under an active break-glass grant. Before the fix the
 * directory, detail, create and update handlers crashed on a membership
 * dereference (500). Now they resolve the organization and the actor's keys
 * from the grant — and the grant must still name every key, exactly as
 * requirePermission demands, so nothing is widened.
 */
describe("break-glass elevation on the changed employee routes", () => {
  function mockElevatedPlatformActor(scope: string[]) {
    fixtures.sessionRows = [
      {
        session: { id: 1, token: "valid-token", userId: ACTOR_USER, expiresAt: new Date(Date.now() + 100000) },
        user: { id: ACTOR_USER, email: "platform@example.com", firstName: "Plat", lastName: "Form", role: "super_admin", organizationId: 1, createdAt: new Date() },
      },
    ];
    fixtures.membershipRows = []; // no membership in ORG
    fixtures.breakGlassGrantRows = [{ id: 9, actorUserId: ACTOR_USER, targetOrganizationId: ORG, scope, status: "active", expiresAt: new Date(Date.now() + 3600_000) }];
  }

  it("lists and reads employees under a grant naming employee.read (no 500), redacting what the grant does not name", async () => {
    mockElevatedPlatformActor(["employee.read"]);
    seedEmployee(43, { nationalId: "GHA-SECRET-1" });
    const list = await request(app).get(`/api/organizations/${ORG}/employees`).set(AUTH);
    expect(list.status).toBe(200);
    const detail = await request(app).get(`/api/organizations/${ORG}/employees/43`).set(AUTH);
    expect(detail.status).toBe(200);
    expect(detail.body.sensitiveFieldsRedacted).toBe(true);
    expect(detail.body.nationalId).toBeNull();
  });

  it("updates a general field under a grant naming employee.write, attributing the audit to the user with a null membership", async () => {
    mockElevatedPlatformActor(["employee.read", "employee.write"]);
    seedEmployee(43);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/43`).set(AUTH).send({ workLocation: "Elevated" });
    expect(res.status).toBe(200);
    const [event] = fixtures.inserted.filter((i) => i.table === "audit_events" && i.values.eventType === "employee.updated");
    expect(event.values.actorApplicationUserId).toBe(ACTOR_USER);
    expect(event.values.actorMembershipId).toBeNull();
  });

  it("still refuses a sensitive field the grant does not name (403, nothing written)", async () => {
    mockElevatedPlatformActor(["employee.read", "employee.write"]);
    seedEmployee(43);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/43`).set(AUTH).send({ phoneNumber: "+233200000001" });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("employee.sensitive.write");
    expect(fixtures.updated).toEqual([]);
  });

  it("refuses a key the grant does not include at the permission gate (403, not 500)", async () => {
    mockElevatedPlatformActor(["employee.read"]);
    seedEmployee(43);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/43`).set(AUTH).send({ workLocation: "Elevated" });
    expect(res.status).toBe(403);
  });

  it("the self-administration rule still applies to a platform actor linked to the target record", async () => {
    mockElevatedPlatformActor(["employee.read", "employee.write"]);
    seedEmployee(OWN);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ workLocation: "Elevated" });
    expectSelfAdminRefusal(res, OWN);
    expect(fixtures.updated).toEqual([]);
  });

  it("creates an employee under a grant naming employee.write", async () => {
    mockElevatedPlatformActor(["employee.read", "employee.write"]);
    const res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "Grant", lastName: "Made" });
    expect(res.status).toBe(201);
  });
});

/**
 * Release gate: denial is decided and audited BEFORE any write. If the audit
 * store itself fails, the request fails — it never falls through to the write.
 * And a denial row carries the action name only, never a field value.
 */
describe("denial audit behaviour", () => {
  it("an audit-store failure during a denial never lets the write through", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    linkActorTo(OWN);
    fixtures.failAuditInsert = true;
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ workLocation: "Kumasi", nationalId: "GHA-NEVER" });
    expect(res.status).toBe(500);
    expect(fixtures.updated).toEqual([]);
    expect((fixtures.employeeRows[0] as Record<string, unknown>).workLocation).toBeUndefined();
  });

  it("a denial row names the action and the record, never the submitted values", async () => {
    mockPermissions(HR);
    seedEmployee(OWN);
    linkActorTo(OWN);
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/${OWN}`).set(AUTH).send({ nationalId: "GHA-NEVER-2", notes: "private words" });
    expectSelfAdminRefusal(res, OWN);
    const [denied] = deniedAudits();
    const serialised = JSON.stringify(denied.values);
    expect(serialised).toContain('"action":"employee.update"');
    expect(serialised).not.toContain("GHA-NEVER-2");
    expect(serialised).not.toContain("private words");
    expect(denied.values.beforeState ?? null).toBeNull();
    expect(denied.values.afterState ?? null).toBeNull();
  });
});
