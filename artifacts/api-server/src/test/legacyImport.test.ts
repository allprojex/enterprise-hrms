/**
 * Integration tests for Legacy Import (Phase 3H, W119), exercising the real
 * requireAuth/requireMembership/requirePermission chain plus real
 * validation/commit logic through supertest, multipart file uploads via
 * .attach(). Mock harness mirrors personnelReporting.test.ts's own
 * established pattern, extended with insert/transaction support (the
 * commit path writes). No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeNumberAllocationsTable,
  numberingSequencesTable,
  personnelFilesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  recordsLocationsTable,
  organizationSettingsTable,
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
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as Record<string, unknown>[],
      allocationRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      personnelFileRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      locationRows: [] as Record<string, unknown>[],
      settingsRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "middleName", "preferredName", "gender", "employmentStatus", "hireDate", "separationDate", "separationReason", "departmentId", "branchId", "positionId", "workEmail", "personalEmail", "phoneNumber", "employeeNumber", "createdBy", "updatedBy"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo", "allocatedByMembershipId", "releasedByMembershipId"]),
    numberingSequencesTable: mockTable("numbering_sequences", ["id", "organizationId", "sequenceKey", "periodKey", "currentValue"]),
    personnelFilesTable: mockTable("personnel_files", ["id", "organizationId", "employeeId", "pifNumber", "allocationMethod", "currentLocationId", "currentCustodyState", "allocatedByMembershipId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "code", "name"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "code", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title"]),
    recordsLocationsTable: mockTable("records_locations", ["id", "organizationId", "name", "status"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "settings"]),
    auditEventsTable: mockTable("audit_events", ["id", "eventType", "targetType", "targetId", "organizationId", "metadata"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

function nextId(tableName: string): number {
  const n = (fixtures.idCounters.get(tableName) ?? 0) + 1;
  fixtures.idCounters.set(tableName, n);
  return n;
}

const TABLE_STATE_KEY: Record<string, keyof typeof fixtures> = {
  employees: "employeeRows",
  employee_number_allocations: "allocationRows",
  numbering_sequences: "numberingSequenceRows",
  personnel_files: "personnelFileRows",
  departments: "departmentRows",
  branches: "branchRows",
  positions: "positionRows",
  records_locations: "locationRows",
  organization_settings: "settingsRows",
  audit_events: "auditRows",
};

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "organization_memberships") return fixtures.membershipRows;
  if (table.__name === "membership_roles") return fixtures.membershipRoleRows as Record<string, unknown>[];
  if (table.__name === "role_permissions") return fixtures.permissionRows as Record<string, unknown>[];
  const key = TABLE_STATE_KEY[table.__name];
  return key ? (fixtures[key] as Record<string, unknown>[]) : [];
}
function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  const key = TABLE_STATE_KEY[table.__name];
  if (key) (fixtures as never as Record<string, unknown>)[key] = rows;
}

function makeDb(): unknown {
  const client = {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const b = { innerJoin: () => b, where: () => b, limit: () => Promise.resolve(rows), then: (res: (v: unknown) => void) => Promise.resolve(rows).then(res) };
          return b;
        }
        if (table === membershipRolesTable || table === rolePermissionsTable) {
          const rows = rowsFor(table);
          const b = { innerJoin: () => b, where: () => b, limit: () => Promise.resolve(rows), orderBy: () => Promise.resolve(rows), then: (res: (v: unknown) => void) => Promise.resolve(rows).then(res) };
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
          };
        };
        return stage(rows);
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
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const db = makeDb();

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeNumberAllocationsTable,
  numberingSequencesTable,
  personnelFilesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  recordsLocationsTable,
  organizationSettingsTable,
  auditEventsTable,
  db,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  gt: () => undefined,
  or: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: () => undefined,
  ilike: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  ne: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  count: () => "count",
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const HR_ID = 1;

function mockSession(userId = HR_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}
function mockActiveMembership(membershipId = 5) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: HR_ID, organizationId: ORG_ID, status: "active" }];
}
function mockPermissions(keys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = keys.map((key) => ({ key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.allocationRows = [];
  fixtures.numberingSequenceRows = [];
  fixtures.personnelFileRows = [];
  fixtures.departmentRows = [{ id: 1, organizationId: ORG_ID, code: "ENG", name: "Engineering" }];
  fixtures.branchRows = [];
  fixtures.positionRows = [];
  fixtures.locationRows = [];
  fixtures.settingsRows = [];
  fixtures.auditRows = [];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  mockPermissions(["personnel_file.manage", "employee_number.allocate"]);
});

function csvBuffer(rows: string[][]): Buffer {
  return Buffer.from(rows.map((r) => r.join(",")).join("\n") + "\n", "utf-8");
}

function preview(buffer: Buffer) {
  return request(app).post(`/api/organizations/${ORG_ID}/personnel-records/import/preview`).set("Authorization", "Bearer valid-token").attach("file", buffer, { filename: "import.csv", contentType: "text/csv" });
}
function commit(buffer: Buffer) {
  return request(app).post(`/api/organizations/${ORG_ID}/personnel-records/import/commit`).set("Authorization", "Bearer valid-token").attach("file", buffer, { filename: "import.csv", contentType: "text/csv" });
}

const HEADER = ["firstName", "lastName", "middleName", "preferredName", "gender", "employmentStatus", "hireDate", "separationDate", "separationReason", "employeeNumber", "pifNumber", "departmentCode", "branchCode", "positionTitle", "workEmail", "personalEmail", "phoneNumber", "recordsLocationName"];

function row(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = { firstName: "Jane", lastName: "Doe" };
  const merged = { ...base, ...overrides };
  return HEADER.map((h) => merged[h] ?? "");
}

describe("Legacy Import — authorization", () => {
  it("denies a caller with only personnel_file.manage (missing employee_number.allocate)", async () => {
    mockPermissions(["personnel_file.manage"]);
    const res = await preview(csvBuffer([HEADER, row()]));
    expect(res.status).toBe(403);
  });

  it("denies a caller with only employee_number.allocate (missing personnel_file.manage)", async () => {
    mockPermissions(["employee_number.allocate"]);
    const res = await preview(csvBuffer([HEADER, row()]));
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/personnel-records/import/preview`).attach("file", csvBuffer([HEADER, row()]), { filename: "import.csv", contentType: "text/csv" });
    expect(res.status).toBe(401);
  });
});

describe("Legacy Import — preview (never writes)", () => {
  it("validates a well-formed file and writes nothing", async () => {
    const res = await preview(csvBuffer([HEADER, row({ firstName: "Jane", lastName: "Doe", employeeNumber: "WWM/SN/014" })]));
    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.validCount).toBe(1);
    expect(res.body.invalidCount).toBe(0);
    expect(fixtures.employeeRows).toHaveLength(0);
    expect(fixtures.allocationRows).toHaveLength(0);
  });

  it("rejects a malformed (empty) file", async () => {
    const res = await preview(Buffer.from(""));
    expect(res.status).toBe(400);
  });

  it("flags a row missing required firstName/lastName as invalid", async () => {
    const res = await preview(csvBuffer([HEADER, HEADER.map((h) => (h === "lastName" ? "" : h === "firstName" ? "OnlyFirst" : ""))]));
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("lastName"))).toBe(true);
  });

  it("flags duplicate rows in the same file as invalid", async () => {
    const r = row({ firstName: "Jane", lastName: "Doe" });
    const res = await preview(csvBuffer([HEADER, r, r]));
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[1].errors.some((e: string) => e.includes("duplicate"))).toBe(true);
  });

  it("flags a staff-number collision against an existing active allocation", async () => {
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 999, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date(), validTo: null }];
    const res = await preview(csvBuffer([HEADER, row({ employeeNumber: "EMP-0001" })]));
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("actively allocated"))).toBe(true);
  });

  it("flags a PIF collision against an existing personnel file", async () => {
    fixtures.personnelFileRows = [{ id: 1, organizationId: ORG_ID, employeeId: 999, pifNumber: "PIF-001", allocationMethod: "generated" }];
    const res = await preview(csvBuffer([HEADER, row({ pifNumber: "PIF-001" })]));
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("permanent and never reused"))).toBe(true);
  });

  it("flags a departmentCode that doesn't resolve in this organization (cross-org reference rejected)", async () => {
    const res = await preview(csvBuffer([HEADER, row({ departmentCode: "NOT-A-REAL-DEPT" })]));
    expect(res.status).toBe(200);
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("departmentCode"))).toBe(true);
  });

  it("flags an invalid ISO date", () => preview(csvBuffer([HEADER, row({ hireDate: "not-a-date" })])).then((res) => {
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("hireDate"))).toBe(true);
  }));

  it("flags an invalid employmentStatus value", () => preview(csvBuffer([HEADER, row({ employmentStatus: "not-a-status" })])).then((res) => {
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("employmentStatus"))).toBe(true);
  }));

  it("requires separationDate when employmentStatus is terminated", () => preview(csvBuffer([HEADER, row({ employmentStatus: "terminated" })])).then((res) => {
    expect(res.body.invalidCount).toBe(1);
    expect(res.body.rows[0].errors.some((e: string) => e.includes("separationDate"))).toBe(true);
  }));

  it("accepts a row with only the required fields — every optional value stays null", () => preview(csvBuffer([HEADER, row()])).then((res) => {
    expect(res.body.validCount).toBe(1);
  }));

  it("warns (not blocks) when a number has closed prior history — a genuine reuse", async () => {
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 999, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2021-01-01") }];
    const res = await preview(csvBuffer([HEADER, row({ employeeNumber: "EMP-0001" })]));
    expect(res.body.invalidCount).toBe(0);
    expect(res.body.warningCount).toBe(1);
    expect(res.body.rows[0].warnings.some((w: string) => w.includes("previously held"))).toBe(true);
  });
});

describe("Legacy Import — commit (atomic, preserves legacy identifiers)", () => {
  it("commits a valid file, preserving the supplied staff number and PIF number exactly", async () => {
    const res = await commit(csvBuffer([HEADER, row({ firstName: "Jane", lastName: "Doe", employeeNumber: "WWM/SN/014", pifNumber: "PIF-014" })]));
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);
    expect(res.body.created[0].employeeNumber).toBe("WWM/SN/014");
    expect(res.body.created[0].pifNumber).toBe("PIF-014");

    expect(fixtures.employeeRows).toHaveLength(1);
    expect(fixtures.allocationRows).toHaveLength(1);
    expect(fixtures.allocationRows[0].allocationMethod).toBe("migrated");
    expect(fixtures.personnelFileRows).toHaveLength(1);
    expect(fixtures.personnelFileRows[0].allocationMethod).toBe("migrated");
  });

  it("records an audit event on commit, without embedding row-level personal data", async () => {
    await commit(csvBuffer([HEADER, row({ firstName: "Jane", lastName: "Doe" })]));
    expect(fixtures.auditRows).toHaveLength(1);
    expect(fixtures.auditRows[0].eventType).toBe("personnel_records.import_committed");
    expect(JSON.stringify(fixtures.auditRows[0]).includes("Jane")).toBe(false);
  });

  it("is all-or-nothing — a file with one invalid row creates nothing at all", async () => {
    const good = row({ firstName: "Jane", lastName: "Doe" });
    const bad = row({ firstName: "", lastName: "NoFirstName" });
    const res = await commit(csvBuffer([HEADER, good, bad]));
    expect(res.status).toBe(400);
    expect(fixtures.employeeRows).toHaveLength(0);
    expect(fixtures.allocationRows).toHaveLength(0);
    expect(fixtures.personnelFileRows).toHaveLength(0);
  });

  it("re-validates at commit time rather than trusting a stale preview — a number that collided moments earlier is still rejected", async () => {
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 999, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date(), validTo: null }];
    const res = await commit(csvBuffer([HEADER, row({ employeeNumber: "EMP-0001" })]));
    expect(res.status).toBe(400);
    expect(fixtures.employeeRows).toHaveLength(0);
  });
});
