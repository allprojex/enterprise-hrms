/**
 * Integration tests for Phase 3H, W115 — Personnel File Registry & PIF
 * Linkage (lib/personnelFiles.ts, routes/personnelFiles.ts), exercising the
 * real requireAuth/requireMembership/requirePermission chain through
 * supertest with a real-where-filtering mocked @workspace/db (the
 * Cond-matching style established by learningEnrollments.test.ts), extended
 * with real `ilike`/`or`/`inArray` support (unlike employeeNumbering.test.ts,
 * which never needed them) since searchPersonnelRecords depends on all
 * three. Genuine concurrency (SELECT ... FOR UPDATE) is not exercised here
 * — real row-locking behavior is exercised only in live QA; `.for("update")`
 * is a chainable no-op passthrough. No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "ilike"; field: string; val: string }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "isNull") return row[cond.field] == null;
  if (cond.__op === "ilike") {
    const value = row[cond.field];
    const pattern = cond.val.replace(/%/g, "").toLowerCase();
    return typeof value === "string" && value.toLowerCase().includes(pattern);
  }
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  return true;
}

function colName(col: unknown): string {
  return typeof col === "string" ? col.split(".").pop()! : (col as string);
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  auditEventsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  personnelFilesTable,
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
      auditRows: [] as Record<string, unknown>[],
      organizationSettingsRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
      personnelFileRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    employeesTable: mockTable("employees", [
      "id", "organizationId", "branchId", "departmentId", "reportingManagerId",
      "employmentStatus", "employeeNumber", "firstName", "lastName", "preferredName",
    ]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "code"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "code"]),
    auditEventsTable: mockTable("audit_events", []),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    numberingSequencesTable: mockTable("numbering_sequences", ["id", "organizationId", "sequenceKey", "periodKey", "currentValue"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", [
      "id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo",
      "allocatedByMembershipId", "releasedByMembershipId",
    ]),
    personnelFilesTable: mockTable("personnel_files", [
      "id", "organizationId", "employeeId", "pifNumber", "allocationMethod", "allocatedByMembershipId",
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
  if (table === auditEventsTable) return fixtures.auditRows;
  if (table === organizationSettingsTable) return fixtures.organizationSettingsRows;
  if (table === numberingSequencesTable) return fixtures.numberingSequenceRows;
  if (table === employeeNumberAllocationsTable) return fixtures.employeeNumberAllocationRows;
  if (table === personnelFilesTable) return fixtures.personnelFileRows;
  return fixtures.sessionRows;
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table === employeesTable) fixtures.employeeRows = rows;
  else if (table === organizationSettingsTable) fixtures.organizationSettingsRows = rows;
  else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = rows;
  else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = rows;
  else if (table === auditEventsTable) fixtures.auditRows = rows;
  else if (table === personnelFilesTable) fixtures.personnelFileRows = rows;
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
        const row: Record<string, unknown> = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...v };
        const currentRows = rowsFor(table);
        // personnel_files' own unique constraints (employeeId; org+pifNumber)
        // must actually be enforced here — the collision/already-exists
        // tests depend on a real SQLSTATE 23505-shaped rejection, matching
        // the same isUniqueViolation()/dbErrors.ts pattern the production
        // code relies on, not a mock that always succeeds.
        if (table === personnelFilesTable) {
          const dup = currentRows.some((r) => r.employeeId === row.employeeId || (r.organizationId === row.organizationId && r.pifNumber === row.pifNumber));
          if (dup) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        }
        setRowsFor(table, [...currentRows, row]);
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
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  auditEventsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  personnelFilesTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __op: "eq", field: colName(col), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => {
    const filtered = conds.filter(Boolean);
    return filtered.length ? { __op: "or", conds: filtered } : undefined;
  },
  isNull: (col: unknown) => ({ __op: "isNull", field: colName(col) }),
  ilike: (col: unknown, val: string) => ({ __op: "ilike", field: colName(col), val }),
  inArray: (col: unknown, vals: unknown[]) => ({ __op: "inArray", field: colName(col), vals }),
  gt: () => undefined,
  desc: () => undefined,
  count: () => "count",
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
    preferredName: null,
    employmentStatus: "active",
    employeeNumber: null,
    branchId: null,
    departmentId: null,
    ...overrides,
  };
  fixtures.employeeRows = [...fixtures.employeeRows, employee];
  return employee;
}

function seedAllocation(overrides: Record<string, unknown>) {
  const allocation = { id: nextId(employeeNumberAllocationsTable), organizationId: ORG_ID, allocatedByMembershipId: null, releasedByMembershipId: null, allocationMethod: "manual", ...overrides };
  fixtures.employeeNumberAllocationRows = [...fixtures.employeeNumberAllocationRows, allocation];
  return allocation;
}

const MANAGE_PERMS = ["personnel_file.manage", "personnel_file.read", "employee.write"];
const READ_PERMS = ["personnel_file.read", "employee.write"];

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.departmentRows = [];
  fixtures.branchRows = [];
  fixtures.auditRows = [];
  fixtures.organizationSettingsRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.employeeNumberAllocationRows = [];
  fixtures.personnelFileRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/personnel-file", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/employees/1/personnel-file`).send({ mode: "generate" });
    expect(res.status).toBe(401);
  });

  it("returns 403 without personnel_file.manage", async () => {
    mockPermissions(["personnel_file.read"]);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(403);
  });

  it("generates PIF-001 by default", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(201);
    expect(res.body.pifNumber).toBe("PIF-001");
    expect(res.body.allocationMethod).toBe("generated");
    expect(res.body.employeeId).toBe(employee.id);
  });

  it("increments the PIF sequence across successive generated personnel files, independent from the employee-number sequence", async () => {
    mockPermissions(MANAGE_PERMS);
    const e1 = seedEmployee();
    const e2 = seedEmployee();
    const r1 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${e1.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const r2 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${e2.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    expect(r1.body.pifNumber).toBe("PIF-001");
    expect(r2.body.pifNumber).toBe("PIF-002");

    // The employee-number sequence (a completely different sequenceKey) must be untouched by PIF generation.
    const empSeq = fixtures.numberingSequenceRows.find((s) => s.sequenceKey === "employee_number");
    expect(empSeq).toBeUndefined();
    const pifSeq = fixtures.numberingSequenceRows.find((s) => s.sequenceKey === "pif_number");
    expect(pifSeq?.currentValue).toBe(2);
  });

  it("respects an organization's independent pifNumber config, distinct from its employeeNumber config", async () => {
    mockPermissions(MANAGE_PERMS);
    fixtures.organizationSettingsRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        namespace: "numbering",
        schemaVersion: 1,
        settings: {
          employeeNumber: { prefix: "EMP", separator: "-", sequenceLength: 4 },
          pifNumber: { prefix: "WWM/PIF", separator: "/", sequenceLength: 2, startingSequence: 1 },
        },
      },
    ];
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(201);
    expect(res.body.pifNumber).toBe("WWM/PIF/01");
  });

  it("accepts a manual PIF number", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", pifNumber: "PIF-LEGACY-001" });
    expect(res.status).toBe(201);
    expect(res.body.pifNumber).toBe("PIF-LEGACY-001");
    expect(res.body.allocationMethod).toBe("manual");
  });

  it("returns 400 when manual mode is sent with no pifNumber", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the employee already has a personnel file (the 1:1 rule)", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when a manual PIF number collides with an existing personnel file in this organization", async () => {
    mockPermissions(MANAGE_PERMS);
    const holder = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${holder.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-001" });

    const contender = seedEmployee();
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/${contender.id}/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "manual", pifNumber: "PIF-001" });
    expect(res.status).toBe(409);
  });

  it("allows the same PIF number string in a different organization (org-scoped uniqueness)", async () => {
    mockPermissions(MANAGE_PERMS);
    const employeeOrgA = seedEmployee();
    const r1 = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeOrgA.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-001" });
    expect(r1.status).toBe(201);

    mockActiveMembership(OTHER_ORG_ID, 6);
    const employeeOrgB = { id: nextId(employeesTable), organizationId: OTHER_ORG_ID, firstName: "Grace", lastName: "Hopper", preferredName: null, employmentStatus: "active", employeeNumber: null, branchId: null, departmentId: null };
    fixtures.employeeRows = [...fixtures.employeeRows, employeeOrgB];
    const r2 = await request(app).post(`/api/organizations/${OTHER_ORG_ID}/employees/${employeeOrgB.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-001" });
    expect(r2.status).toBe(201);
  });

  it("rejects cross-organization employee ids (tenant isolation)", async () => {
    mockPermissions(MANAGE_PERMS);
    fixtures.employeeRows = [{ id: 999, organizationId: OTHER_ORG_ID, firstName: "X", lastName: "Y", preferredName: null, employmentStatus: "active", employeeNumber: null }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/employees/999/personnel-file`)
      .set("Authorization", "Bearer valid-token")
      .send({ mode: "generate" });
    expect(res.status).toBe(404);
  });

  it("records a personnel_file.created audit event", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });
    const audit = fixtures.auditRows.find((r) => r.eventType === "personnel_file.created");
    expect(audit).toBeDefined();
    expect(audit!.targetId).toBe(String(employee.id));
  });
});

describe("GET personnel-file by employee / by id", () => {
  it("returns 404 when the employee has no personnel file yet", async () => {
    mockPermissions(READ_PERMS);
    const employee = seedEmployee();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns the personnel file once created", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    const created = await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "generate" });

    const byEmployee = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token");
    expect(byEmployee.status).toBe(200);
    expect(byEmployee.body.pifNumber).toBe("PIF-001");

    const byId = await request(app).get(`/api/organizations/${ORG_ID}/personnel-files/${created.body.id}`).set("Authorization", "Bearer valid-token");
    expect(byId.status).toBe(200);
    expect(byId.body.employeeId).toBe(employee.id);

    // WS-3 (Owner Decision #18): both routes above are sensitive-read
    // audited — a specific personnel file's own details are a deliberate,
    // higher-value read, unlike the routine search endpoint below.
    const viewedEvents = fixtures.auditRows.filter((r) => r.eventType === "personnel_file.viewed");
    expect(viewedEvents).toHaveLength(2);
    expect(viewedEvents[0]).toMatchObject({ targetType: "personnel_file", category: "documents" });
  });

  it("returns 403 without personnel_file.read", async () => {
    mockPermissions(["employee.write"]);
    const employee = seedEmployee();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/organizations/:organizationId/personnel-records/search", () => {
  it("returns 403 without personnel_file.read", async () => {
    mockPermissions(["employee.read"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=Ada`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("matches by employee name", async () => {
    mockPermissions(READ_PERMS);
    const employee = seedEmployee({ firstName: "Ada", lastName: "Lovelace" });
    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=Ada`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.some((r: { employeeId: number; matchType: string }) => r.employeeId === employee.id && r.matchType === "name")).toBe(true);
  });

  it("matches by PIF number, always resolving to exactly one employee", async () => {
    mockPermissions(MANAGE_PERMS);
    const employee = seedEmployee();
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employee.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-777" });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=PIF-777`).set("Authorization", "Bearer valid-token");
    const pifMatches = res.body.filter((r: { matchType: string }) => r.matchType === "pif_number");
    expect(pifMatches).toHaveLength(1);
    expect(pifMatches[0].employeeId).toBe(employee.id);
    expect(pifMatches[0].isCurrentHolder).toBe(true);
  });

  it("reused-staff-number search shows both the historical and current holder, never collapsed to one", async () => {
    mockPermissions(MANAGE_PERMS);
    const employeeA = seedEmployee({ firstName: "Former", lastName: "HolderA", employmentStatus: "terminated" });
    seedAllocation({ employeeId: employeeA.id, employeeNumber: "WWM/SN/001", validFrom: new Date("2020-01-01"), validTo: new Date("2025-01-01") });

    const employeeB = seedEmployee({ firstName: "Current", lastName: "HolderB", employmentStatus: "active", employeeNumber: "WWM/SN/001" });
    seedAllocation({ employeeId: employeeB.id, employeeNumber: "WWM/SN/001", validFrom: new Date("2025-01-01"), validTo: null });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=WWM%2FSN%2F001`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    const numberMatches = res.body.filter((r: { matchType: string }) => r.matchType === "employee_number");
    expect(numberMatches).toHaveLength(2);
    const historical = numberMatches.find((r: { employeeId: number }) => r.employeeId === employeeA.id);
    const current = numberMatches.find((r: { employeeId: number }) => r.employeeId === employeeB.id);
    expect(historical.isCurrentHolder).toBe(false);
    expect(current.isCurrentHolder).toBe(true);
  });

  it("PIF stays with its original holder even after their staff number is reused by someone else", async () => {
    mockPermissions(MANAGE_PERMS);
    const employeeA = seedEmployee({ firstName: "Former", lastName: "HolderA", employmentStatus: "terminated" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeA.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-A" });
    seedAllocation({ employeeId: employeeA.id, employeeNumber: "WWM/SN/002", validFrom: new Date("2020-01-01"), validTo: new Date("2025-01-01") });

    const employeeB = seedEmployee({ firstName: "Current", lastName: "HolderB", employmentStatus: "active", employeeNumber: "WWM/SN/002" });
    await request(app).post(`/api/organizations/${ORG_ID}/employees/${employeeB.id}/personnel-file`).set("Authorization", "Bearer valid-token").send({ mode: "manual", pifNumber: "PIF-B" });
    seedAllocation({ employeeId: employeeB.id, employeeNumber: "WWM/SN/002", validFrom: new Date("2025-01-01"), validTo: null });

    const pifA = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=PIF-A`).set("Authorization", "Bearer valid-token");
    expect(pifA.body.filter((r: { matchType: string }) => r.matchType === "pif_number")).toHaveLength(1);
    expect(pifA.body.find((r: { matchType: string }) => r.matchType === "pif_number").employeeId).toBe(employeeA.id);

    const pifB = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=PIF-B`).set("Authorization", "Bearer valid-token");
    expect(pifB.body.find((r: { matchType: string }) => r.matchType === "pif_number").employeeId).toBe(employeeB.id);

    const employeeAFile = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employeeA.id}/personnel-file`).set("Authorization", "Bearer valid-token");
    expect(employeeAFile.body.pifNumber).toBe("PIF-A");
    const employeeBFile = await request(app).get(`/api/organizations/${ORG_ID}/employees/${employeeB.id}/personnel-file`).set("Authorization", "Bearer valid-token");
    expect(employeeBFile.body.pifNumber).toBe("PIF-B");
  });

  it("does not leak cross-organization matches", async () => {
    mockPermissions(READ_PERMS);
    fixtures.employeeRows = [{ id: 501, organizationId: OTHER_ORG_ID, firstName: "OtherOrg", lastName: "Person", preferredName: null, employmentStatus: "active", employeeNumber: null }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=OtherOrg`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("returns an empty array for a blank search term", async () => {
    mockPermissions(READ_PERMS);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/search?search=`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
