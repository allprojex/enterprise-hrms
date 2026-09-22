/**
 * Integration tests for Phase 3H, W114 — Numbering & Identifier History:
 * the organization-level numbering-format engine, employee/staff-number
 * allocation, release, and reuse lifecycle (lib/numbering.ts,
 * routes/employeeNumbering.ts), plus the closed generic-PATCH mutation gap
 * (routes/employees.ts). Exercises the real requireAuth/requireMembership/
 * requirePermission chain through supertest with a real-where-filtering
 * mocked @workspace/db (the Cond-matching style established by
 * learningEnrollments.test.ts/employeeConversion.test.ts) — genuine
 * concurrency (SELECT ... FOR UPDATE row locking) is not exercised here,
 * per this codebase's own established precedent ("real row-locking behavior
 * is exercised only in live QA, never in the mocked suite"); `.for("update")`
 * is a chainable no-op passthrough. No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "and"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "isNull") return row[cond.field] == null;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

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
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      linkRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      organizationSettingsRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "branchId", "departmentId", "reportingManagerId", "employmentStatus", "employeeNumber"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "code"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "code"]),
    positionsTable: mockTable("positions", ["id", "organizationId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "employeeId", "applicationUserId"]),
    auditEventsTable: mockTable("audit_events", []),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    numberingSequencesTable: mockTable("numbering_sequences", ["id", "organizationId", "sequenceKey", "periodKey", "currentValue"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", [
      "id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo",
      "allocatedByMembershipId", "releasedByMembershipId",
    ]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === employeesTable) return fixtures.employeeRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  if (table === branchesTable) return fixtures.branchRows;
  if (table === employeeUserLinksTable) return fixtures.linkRows;
  if (table === auditEventsTable) return fixtures.auditRows;
  if (table === organizationSettingsTable) return fixtures.organizationSettingsRows;
  if (table === numberingSequencesTable) return fixtures.numberingSequenceRows;
  if (table === employeeNumberAllocationsTable) return fixtures.employeeNumberAllocationRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === organizationSettingsTable) fixtures.organizationSettingsRows = rows;
  else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = rows;
  else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = rows;
  else if (table === auditEventsTable) fixtures.auditRows = rows;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
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
        if (table === membershipRolesTable || table === rolePermissionsTable) {
          const rows = rowsFor(table);
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }

        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            limit: (n: number) => stage(current.slice(0, n)),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        const defaults =
          table === employeeNumberAllocationsTable
            ? { validTo: null, releasedByMembershipId: null, allocatedByMembershipId: null, validFrom: new Date() }
            : {};
        const row = { id: nextId(table), createdAt: new Date(), ...defaults, ...v };
        setRowsFor(table, [...rowsFor(table), row]);
        // organizationConfig.ts's own first-write path chains
        // .onConflictDoNothing() — a plain passthrough here (this mock has no
        // real conflict detection to simulate; genuine race behavior is only
        // exercised in live QA).
        const result = { returning: () => Promise.resolve([row]) };
        return { ...result, onConflictDoNothing: () => result };
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
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const dbMock = makeQueryClient();

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
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gt: () => undefined,
  ilike: () => undefined,
  desc: () => undefined,
  count: () => "count",
  inArray: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "hr@example.com", firstName: "HR", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(organizationId = ORG_ID, membershipId = 5) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function seedEmployee(overrides: Record<string, unknown> = {}) {
  const employee = {
    id: nextId(employeesTable),
    organizationId: ORG_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    employmentStatus: "active",
    employeeNumber: null,
    branchId: null,
    departmentId: null,
    ...overrides,
  };
  fixtures.employeeRows = [...fixtures.employeeRows, employee];
  return employee;
}

const ALLOCATE_PERMS = ["employee_number.allocate", "employee.write", "employee.notes.read"];

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.departmentRows = [];
  fixtures.branchRows = [];
  fixtures.linkRows = [];
  fixtures.auditRows = [];
  fixtures.organizationSettingsRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.employeeNumberAllocationRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/number/allocate", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/1/number/allocate`).send({ mode: "generate" });
    expect(res.status).toBe(401);
  });

  it("returns 403 without employee_number.allocate", async () => {
    mockPermissions(["employee.write"]);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(403);
  });

  it("generates EMP-0001 by default (byte-for-byte the pre-W114 hardcoded format)", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(201);
    expect(res.body.employeeNumber).toBe("EMP-0001");
    expect(res.body.allocation.allocationMethod).toBe("generated");
    expect(res.body.allocation.validTo).toBeNull();
  });

  it("increments the sequence across successive generated allocations", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const e1 = seedEmployee();
    const e2 = seedEmployee();
    const r1 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${e1.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const r2 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${e2.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    expect(r1.body.employeeNumber).toBe("EMP-0001");
    expect(r2.body.employeeNumber).toBe("EMP-0002");
  });

  it("applies organization numbering configuration (prefix/separator/sequenceLength/startingSequence)", async () => {
    mockPermissions(ALLOCATE_PERMS);
    fixtures.organizationSettingsRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        namespace: "numbering",
        schemaVersion: 1,
        settings: { employeeNumber: { prefix: "WWM/SN", separator: "/", sequenceLength: 3, startingSequence: 1, resetPolicy: "never" } },
      },
    ];
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(201);
    expect(res.body.employeeNumber).toBe("WWM/SN/001");
  });

  it("keeps a second organization's sequence and configuration completely independent", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employeeOrgA = seedEmployee();
    const res1 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeOrgA.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    expect(res1.body.employeeNumber).toBe("EMP-0001");

    mockActiveMembership(OTHER_ORG_ID, 6);
    const employeeOrgB = { id: nextId(employeesTable), organizationId: OTHER_ORG_ID, firstName: "Grace", lastName: "Hopper", employmentStatus: "active", employeeNumber: null, branchId: null, departmentId: null };
    fixtures.employeeRows = [...fixtures.employeeRows, employeeOrgB];
    const res2 = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/employees/${employeeOrgB.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    expect(res2.body.employeeNumber).toBe("EMP-0001");
  });

  it("rejects cross-organization employee ids (tenant isolation)", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employeeOrgB = { id: 999, organizationId: OTHER_ORG_ID, firstName: "X", lastName: "Y", employmentStatus: "active", employeeNumber: null };
    fixtures.employeeRows = [employeeOrgB];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/999/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(404);
  });

  it("accepts a fresh manual override, recorded as allocationMethod manual", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", employeeNumber: "WWM/SN/099" });
    expect(res.status).toBe(201);
    expect(res.body.employeeNumber).toBe("WWM/SN/099");
    expect(res.body.allocation.allocationMethod).toBe("manual");
  });

  it("returns 400 when manual mode is sent with no employeeNumber", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when a manual number collides with another employee's active allocation", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const holder = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${holder.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "manual", employeeNumber: "WWM/SN/001" });

    const contender = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${contender.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", employeeNumber: "WWM/SN/001" });
    expect(res.status).toBe(409);
  });

  it("returns 400 when the employee already has an active allocation", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(400);
  });

  it("records an employee_number.allocated audit event", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const audit = fixtures.auditRows.find((r) => r.eventType === "employee_number.allocated");
    expect(audit).toBeDefined();
    expect(audit!.targetId).toBe(String(employee.id));
  });

  it("resolves branch/department/year/month tokens when configured", async () => {
    mockPermissions(ALLOCATE_PERMS);
    fixtures.branchRows = [{ id: 1, organizationId: ORG_ID, code: "ACC" }];
    fixtures.departmentRows = [{ id: 2, organizationId: ORG_ID, code: "HR" }];
    fixtures.organizationSettingsRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        namespace: "numbering",
        schemaVersion: 1,
        settings: {
          employeeNumber: {
            prefix: "EMP",
            separator: "-",
            sequenceLength: 3,
            startingSequence: 1,
            includeBranchToken: true,
            includeDepartmentToken: true,
            resetPolicy: "never",
          },
        },
      },
    ];
    const employee = seedEmployee({ branchId: 1, departmentId: 2 });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(201);
    expect(res.body.employeeNumber).toBe("EMP-ACC-HR-001");
  });

  it("returns 400 when a branch token is required but the employee has no branch", async () => {
    mockPermissions(ALLOCATE_PERMS);
    fixtures.organizationSettingsRows = [
      { id: 1, organizationId: ORG_ID, namespace: "numbering", schemaVersion: 1, settings: { employeeNumber: { includeBranchToken: true, resetPolicy: "never" } } },
    ];
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/number/release", () => {
  it("blocks release while the employee is still actively employed", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee({ employmentStatus: "active" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/release`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("releases a terminated employee's number, clearing the current-value cache and closing the allocation historically", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee({ employmentStatus: "active" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    fixtures.employeeRows = fixtures.employeeRows.map((e) => (e.id === employee.id ? { ...e, employmentStatus: "terminated" } : e));

    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/release`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.employeeNumber).toBeNull();
    expect(res.body.allocation.validTo).not.toBeNull();
    expect(res.body.allocation.employeeNumber).toBe("EMP-0001");

    const audit = fixtures.auditRows.find((r) => r.eventType === "employee_number.released");
    expect(audit).toBeDefined();
  });

  it("returns 400 when there is no active allocation to release", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employee = seedEmployee({ employmentStatus: "terminated" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/release`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });
});

describe("Staff-number reuse policy (Decision 2 — default disabled)", () => {
  async function releaseFor(employeeId: number) {
    fixtures.employeeRows = fixtures.employeeRows.map((e) => (e.id === employeeId ? { ...e, employmentStatus: "terminated" } : e));
    return request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeId}/number/release`).set("Authorization", "Bearer valid-token");
  }

  it("rejects reuse of a released number when the organization has not enabled it (the default)", async () => {
    mockPermissions(ALLOCATE_PERMS);
    const employeeA = seedEmployee({ employmentStatus: "active" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeA.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "manual", employeeNumber: "WWM/SN/001" });
    await releaseFor(employeeA.id);

    const employeeB = seedEmployee({ employmentStatus: "active" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employeeB.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", employeeNumber: "WWM/SN/001" });
    expect(res.status).toBe(400);
  });

  it("allows deliberate reuse once the organization enables it, preserving the original employee's history untouched", async () => {
    mockPermissions(ALLOCATE_PERMS);
    fixtures.organizationSettingsRows = [
      { id: 1, organizationId: ORG_ID, namespace: "numbering", schemaVersion: 1, settings: { employeeNumber: { reuseEnabled: true } } },
    ];
    const employeeA = seedEmployee({ employmentStatus: "active" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeA.id}/number/allocate`).set("Authorization", "Bearer valid-token").send({ mode: "manual", employeeNumber: "WWM/SN/001" });
    await releaseFor(employeeA.id);

    const employeeB = seedEmployee({ employmentStatus: "active" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employeeB.id}/number/allocate`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", employeeNumber: "WWM/SN/001" });
    expect(res.status).toBe(201);
    expect(res.body.allocation.allocationMethod).toBe("reused");

    // The reuse-ambiguity-safe view (frozen plan §10): both A's closed
    // allocation and B's active one must remain visible, clearly distinct.
    const history = await request(app).get(`/api/organizations/${ORG_ID}/employee-numbers/WWM%2FSN%2F001/history`).set("Authorization", "Bearer valid-token");
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0]).toMatchObject({ employeeId: employeeA.id, validTo: expect.anything() });
    expect(history.body[1]).toMatchObject({ employeeId: employeeB.id, validTo: null });

    // Employee A's own history must show exactly their own closed allocation — never B's.
    const aHistory = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employeeA.id}/number/history`).set("Authorization", "Bearer valid-token");
    expect(aHistory.body).toHaveLength(1);
    expect(aHistory.body[0].employeeId).toBe(employeeA.id);
  });
});

describe("Generic employee PATCH no longer accepts employeeNumber (mutation hardening)", () => {
  it("silently ignores an employeeNumber field in the PATCH body — never mutates the cache outside the allocation engine", async () => {
    mockPermissions(["employee.write", "employee.notes.read"]);
    const employee = seedEmployee({ employeeNumber: "EMP-0001" });

    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/employees/${employee.id}`)
      .set("Authorization", "Bearer valid-token")
      .send({ employeeNumber: "HACKED-0001", firstName: "Updated" });

    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe("Updated");
    expect(res.body.employeeNumber).toBe("EMP-0001");
  });
});

describe("Numbering configuration engine — partial-update safety (deep merge)", () => {
  it("preserves sibling employeeNumber fields when a patch only touches one nested key", async () => {
    mockPermissions(["organization.read", "organization.update"]);

    const full = await request(app)
      .patch(`/api/organizations/${ORG_ID}/config/numbering`)
      .set("Authorization", "Bearer valid-token")
      .send({ data: { employeeNumber: { prefix: "WWM/SN", separator: "/", sequenceLength: 3, startingSequence: 1, resetPolicy: "never" } } });
    expect(full.status).toBe(200);
    expect(full.body.data.employeeNumber).toMatchObject({ prefix: "WWM/SN", separator: "/", sequenceLength: 3 });

    // A partial patch touching ONLY reuseEnabled must not silently wipe prefix/separator/sequenceLength.
    const partial = await request(app)
      .patch(`/api/organizations/${ORG_ID}/config/numbering`)
      .set("Authorization", "Bearer valid-token")
      .send({ data: { employeeNumber: { reuseEnabled: true } } });
    expect(partial.status).toBe(200);
    expect(partial.body.data.employeeNumber).toMatchObject({
      prefix: "WWM/SN",
      separator: "/",
      sequenceLength: 3,
      reuseEnabled: true,
    });

    const read = await request(app).get(`/api/organizations/${ORG_ID}/config/numbering`).set("Authorization", "Bearer valid-token");
    expect(read.body.data.employeeNumber).toMatchObject({ prefix: "WWM/SN", separator: "/", sequenceLength: 3, reuseEnabled: true });
  });

  it("records a numbering_config.updated audit event, unlike other config namespaces", async () => {
    mockPermissions(["organization.read", "organization.update"]);
    await request(app)
      .patch(`/api/organizations/${ORG_ID}/config/numbering`)
      .set("Authorization", "Bearer valid-token")
      .send({ data: { employeeNumber: { prefix: "EMP" } } });
    const audit = fixtures.auditRows.find((r) => r.eventType === "numbering_config.updated");
    expect(audit).toBeDefined();
  });
});

describe("GET .../number/history and .../employee-numbers/:employeeNumber/history authorization", () => {
  it("returns 403 without employee.write", async () => {
    mockPermissions(["employee.read"]);
    const employee = seedEmployee();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employee.id}/number/history`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent employee", async () => {
    mockPermissions(["employee.write"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/employees/9999/number/history`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
