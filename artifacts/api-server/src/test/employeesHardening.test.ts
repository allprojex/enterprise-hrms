/**
 * Employee backend hardening, Phase 1 (2026-10-08) — route-level proof through
 * the real requireAuth/requireMembership/requirePermission chain with
 * @workspace/db mocked (same harness shape as employees.test.ts):
 *
 *   - the generic PATCH can no longer terminate, reactivate or confirm;
 *   - a sensitive field needs employee.sensitive.write, a mixed body is
 *     refused whole and nothing is written;
 *   - notes need employee.notes.read;
 *   - format and merged-state date validation reject bad input before any write;
 *   - employee.updated / employee.created are recorded with masked values;
 *   - the directory search never matches personal email for a caller
 *     without employee.sensitive.read.
 *
 * Cycle detection, the advisory lock, identifier uniqueness and tenant
 * isolation need a real database and are proved in employeeHardeningLive.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  ilikeSpy,
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
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      departmentRows: [] as { organizationId: number }[],
      positionRows: [] as { organizationId: number }[],
      employeeRows: [] as Record<string, unknown>[],
      linkRows: [] as { employeeId: number; applicationUserId: number }[],
      inserted: [] as { table: string; values: Record<string, unknown> }[],
      updated: [] as { table: string; values: Record<string, unknown> }[],
      idCounters: new Map<string, number>(),
      organizationSettingsRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
      performanceReviewRows: [] as Record<string, unknown>[],
    },
    ilikeSpy: { calls: 0 },
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
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
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
      else rows = fixtures.sessionRows;
      const builder = {
        innerJoin: () => builder,
        where: () => builder,
        // Thenable at every step so `.limit(n)` can be awaited directly OR
        // chained into `.offset()` (the paginated directory query does both).
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
      fixtures.inserted.push({ table: table.__name, values: v });
      const row = { id: nextId(table), ...v };
      if (table === employeesTable) fixtures.employeeRows = [row];
      else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = [...fixtures.numberingSequenceRows, row];
      else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = [...fixtures.employeeNumberAllocationRows, row];
      const result = { returning: () => Promise.resolve([row]) };
      return { ...result, onConflictDoNothing: () => result };
    },
  }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
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
        const generic = { ...v, id: 1 };
        return { returning: () => Promise.resolve([generic]) };
      },
    }),
  }),
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock),
  // The advisory lock and the reporting-line CTE are raw statements; the
  // mock answers "no rows" — their real behaviour is proved live.
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
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  ne: () => "ne",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  ilike: () => {
    ilikeSpy.calls += 1;
    return "ilike";
  },
  inArray: () => "inArray",
  desc: () => "desc",
  count: () => "count",
  sql: Object.assign(() => "sql", { raw: () => "sql" }),
}));

const { default: app } = await import("../app");

const ORG = 10;
const AUTH = { Authorization: "Bearer valid-token" };

function mockSession() {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: 1, expiresAt: new Date(Date.now() + 100000) },
      user: { id: 1, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG, createdAt: new Date() },
    },
  ];
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId: ORG, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

function mockPermissions(keys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

function seedEmployee(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 42,
    organizationId: ORG,
    employeeNumber: "EMP-0042",
    firstName: "Ama",
    lastName: "Mensah",
    workEmail: "ama@example.test",
    phoneNumber: "+233200000001",
    nationalId: "GHA-000000000-1",
    employmentStatus: "active",
    hireDate: new Date("2026-01-15T00:00:00Z"),
    dateOfBirth: new Date("1990-05-04T00:00:00Z"),
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

const GENERAL = ["employee.read", "employee.write"];
const SENSITIVE = [...GENERAL, "employee.sensitive.read", "employee.sensitive.write", "employee.notes.read"];

function audits(eventType: string) {
  return fixtures.inserted.filter((i) => i.table === "audit_events" && i.values.eventType === eventType);
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
  fixtures.idCounters = new Map();
  fixtures.organizationSettingsRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.employeeNumberAllocationRows = [];
  ilikeSpy.calls = 0;
  mockSession();
});

describe("PATCH employees — lifecycle transitions are refused on the generic update", () => {
  it.each(["active", "probation", "on_leave", "suspended"] as const)("cannot terminate from %s (400, nothing written, points at separation)", async (from) => {
    mockPermissions(GENERAL);
    seedEmployee({ employmentStatus: from });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ employmentStatus: "terminated" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/separation action/);
    expect(fixtures.updated).toEqual([]);
    expect(audits("employee.status_changed")).toEqual([]);
  });

  it.each(["active", "probation", "on_leave", "suspended"] as const)("cannot reactivate a separated employee to %s (400, points at rehire)", async (to) => {
    mockPermissions(GENERAL);
    seedEmployee({ employmentStatus: "terminated", separationDate: new Date("2026-06-30T00:00:00Z") });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ employmentStatus: to });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rehire action/);
    expect(fixtures.updated).toEqual([]);
  });

  it("cannot move probation -> active (400, points at confirmation)", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ employmentStatus: "probation" });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ employmentStatus: "active" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmation action/);
    expect(fixtures.updated).toEqual([]);
  });

  it("still allows an administrative move (active -> on_leave) and records employee.status_changed only", async () => {
    mockPermissions(GENERAL);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ employmentStatus: "on_leave" });
    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("on_leave");
    expect(audits("employee.status_changed")).toHaveLength(1);
    expect(audits("employee.updated")).toHaveLength(0);
  });

  it("treats an unchanged status as a no-op (the Edit form always re-sends it), including for a separated employee", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ employmentStatus: "terminated", separationDate: new Date("2026-06-30T00:00:00Z") });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ employmentStatus: "terminated", lastName: "Mensah-Darko" });
    expect(res.status).toBe(200);
    expect(res.body.lastName).toBe("Mensah-Darko");
    expect(audits("employee.status_changed")).toHaveLength(0);
    expect(audits("employee.updated")).toHaveLength(1);
  });

  it("never lets a record be created already terminated", async () => {
    mockPermissions(SENSITIVE);
    const res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "A", lastName: "B", employmentStatus: "terminated" });
    expect(res.status).toBe(400);
    expect(fixtures.inserted.filter((i) => i.table === "employees")).toEqual([]);
  });
});

describe("sensitive-field write authorization", () => {
  it("refuses a sensitive field with employee.write alone (403, names the field, writes nothing)", async () => {
    mockPermissions(GENERAL);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ nationalId: "GHA-999999999-9" });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(["nationalId"]);
    expect(res.body.requiredPermission).toBe("employee.sensitive.write");
    expect(JSON.stringify(res.body)).not.toContain("GHA-999999999-9");
    expect(fixtures.updated).toEqual([]);
    expect(audits("employee.updated")).toEqual([]);
  });

  it("refuses a MIXED body as a whole — the permitted general field is not applied either", async () => {
    mockPermissions(GENERAL);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ lastName: "Darko", phoneNumber: "+233200000009" });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(["phoneNumber"]);
    expect(fixtures.updated).toEqual([]);
    expect((fixtures.employeeRows[0] as Record<string, unknown>).lastName).toBe("Mensah");
  });

  it("refuses clearing a stored sensitive value (explicit null) without the key", async () => {
    mockPermissions(GENERAL);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ dateOfBirth: null });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(["dateOfBirth"]);
    expect(fixtures.updated).toEqual([]);
  });

  it("does NOT require the key when a sensitive field is supplied but equals the persisted value (the Edit form re-sends it)", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ phoneNumber: "+233200000001", nationalId: "GHA-000000000-1", personalEmail: null });
    const res = await request(app)
      .patch(`/api/organizations/${ORG}/employees/42`)
      .set(AUTH)
      .send({ lastName: "Darko", phoneNumber: " +233200000001 ", nationalId: "GHA-000000000-1", personalEmail: "", employmentStatus: "active" });
    expect(res.status).toBe(200);
    expect(res.body.lastName).toBe("Darko");
    expect(fixtures.updated).toHaveLength(1);
    const [event] = audits("employee.updated");
    expect((event.values.metadata as { changedFields: string[] }).changedFields).toEqual(["lastName"]);
  });

  it("supplying null for an already-null sensitive field is not a write", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ personalEmail: null, alternatePhoneNumber: null });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ personalEmail: null, alternatePhoneNumber: null, workLocation: "Ho" });
    expect(res.status).toBe(200);
    expect(res.body.workLocation).toBe("Ho");
  });

  it("a mixed body with one CHANGED sensitive value among unchanged ones is refused whole, naming only the changed field", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ phoneNumber: "+233200000001", nationalId: "GHA-000000000-1" });
    const res = await request(app)
      .patch(`/api/organizations/${ORG}/employees/42`)
      .set(AUTH)
      .send({ lastName: "Darko", phoneNumber: "+233200000001", nationalId: "GHA-CHANGED" });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(["nationalId"]);
    expect(JSON.stringify(res.body)).not.toContain("GHA-CHANGED");
    expect(fixtures.updated).toEqual([]);
    expect((fixtures.employeeRows[0] as Record<string, unknown>).lastName).toBe("Mensah");
  });

  it("re-sending unchanged notes needs no notes permission; changing them does", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ notes: "private" });
    let res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ notes: "private", workLocation: "Ho" });
    expect(res.status).toBe(200);
    res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ notes: "changed" });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("employee.notes.read");
  });

  it("refuses notes without employee.notes.read even when the sensitive key is held", async () => {
    mockPermissions([...GENERAL, "employee.sensitive.write"]);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ notes: "confidential" });
    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("employee.notes.read");
    expect(fixtures.updated).toEqual([]);
  });

  it("applies a sensitive write for a holder of employee.sensitive.write and audits it masked", async () => {
    mockPermissions(SENSITIVE);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ nationalId: "GHA-999999999-9", lastName: "Darko" });
    expect(res.status).toBe(200);
    expect(res.body.nationalId).toBe("GHA-999999999-9");
    const [event] = audits("employee.updated");
    expect(event).toBeDefined();
    expect((event.values.metadata as { changedFields: string[] }).changedFields.sort()).toEqual(["lastName", "nationalId"]);
    expect((event.values.afterState as Record<string, unknown>).nationalId).toBe("***********99-9");
    expect((event.values.afterState as Record<string, unknown>).lastName).toBe("Darko");
    expect(JSON.stringify(event.values)).not.toContain("GHA-999999999-9");
  });

  it("applies the same rule on create: a sensitive field without the key is 403 and no row is inserted", async () => {
    mockPermissions(GENERAL);
    const res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "Kwame", lastName: "Boateng", personalEmail: "k@example.test" });
    expect(res.status).toBe(403);
    expect(res.body.fields).toEqual(["personalEmail"]);
    expect(fixtures.inserted.filter((i) => i.table === "employees")).toEqual([]);
  });

  it("creates with sensitive fields when the key is held and records employee.created with masked values", async () => {
    mockPermissions(SENSITIVE);
    const res = await request(app)
      .post(`/api/organizations/${ORG}/employees`)
      .set(AUTH)
      .send({ firstName: "Kwame", lastName: "Boateng", personalEmail: "k@example.test", nationalId: "GHA-123456789-0", hireDate: "2026-01-15" });
    expect(res.status).toBe(201);
    const [event] = audits("employee.created");
    expect(event).toBeDefined();
    expect(event.values.targetType).toBe("employee");
    const meta = event.values.metadata as { setFields: string[] };
    expect(meta.setFields).toEqual(expect.arrayContaining(["firstName", "lastName", "personalEmail", "nationalId", "hireDate"]));
    expect((event.values.afterState as Record<string, unknown>).nationalId).toBe("***********89-0");
    expect(JSON.stringify(event.values)).not.toContain("k@example.test");
    expect(JSON.stringify(event.values)).not.toContain("GHA-123456789-0");
  });
});

describe("field validation", () => {
  it("rejects a malformed work email and phone on create", async () => {
    mockPermissions(SENSITIVE);
    let res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "A", lastName: "B", workEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Work email/);
    res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "A", lastName: "B", phoneNumber: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Phone number/);
    expect(fixtures.inserted.filter((i) => i.table === "employees")).toEqual([]);
  });

  it("rejects a future date of birth and probation before hire on create", async () => {
    mockPermissions(SENSITIVE);
    let res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "A", lastName: "B", dateOfBirth: "2090-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/);
    res = await request(app).post(`/api/organizations/${ORG}/employees`).set(AUTH).send({ firstName: "A", lastName: "B", hireDate: "2030-01-01", probationEndDate: "2020-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Probation end/);
  });

  it("validates the MERGED record on a partial update: moving hireDate before the stored date of birth is refused", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ dateOfBirth: new Date("1990-05-04T00:00:00Z") });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ hireDate: "1980-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Hire date/);
    expect(fixtures.updated).toEqual([]);
  });

  it("does not let a stored legacy value block an unrelated edit", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ phoneNumber: "legacy-not-a-phone", workEmail: "legacy" });
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ workLocation: "Kumasi" });
    expect(res.status).toBe(200);
    expect(res.body.workLocation).toBe("Kumasi");
  });

  it("rejects a self-reference as reporting manager before touching the database", async () => {
    mockPermissions(GENERAL);
    seedEmployee();
    const res = await request(app).patch(`/api/organizations/${ORG}/employees/42`).set(AUTH).send({ reportingManagerId: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own reporting manager/);
    expect(fixtures.updated).toEqual([]);
  });

  it("rejects a separation dated before the hire date", async () => {
    mockPermissions(GENERAL);
    seedEmployee({ hireDate: new Date("2026-01-15T00:00:00Z") });
    const res = await request(app).post(`/api/organizations/${ORG}/employees/42/separate`).set(AUTH).send({ separationDate: "2020-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Separation date/);
    expect(fixtures.updated).toEqual([]);
  });
});

describe("directory search never matches redacted personal email", () => {
  it("searches five directory columns for a directory-only caller", async () => {
    mockPermissions(["employee.read"]);
    const res = await request(app).get(`/api/organizations/${ORG}/employees?search=kwame.personal`).set(AUTH);
    expect(res.status).toBe(200);
    expect(ilikeSpy.calls).toBe(5);
  });

  it("adds personal email for a caller holding employee.sensitive.read", async () => {
    mockPermissions(["employee.read", "employee.sensitive.read"]);
    const res = await request(app).get(`/api/organizations/${ORG}/employees?search=kwame.personal`).set(AUTH);
    expect(res.status).toBe(200);
    expect(ilikeSpy.calls).toBe(6);
  });
});
