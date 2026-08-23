/**
 * Integration tests for Personnel Records Reporting (Phase 3H, W119),
 * exercising the real requireAuth/requireMembership/requirePermission chain
 * through supertest. Mock harness mirrors assetReporting.test.ts's own
 * established field-based-filtering pattern. No real database connection is
 * made.
 *
 * The mock's innerJoin() is a no-op passthrough (it never actually merges
 * columns across tables, matching every other dedicated-route reporting
 * test file's own documented limitation) — resolveActorNames' own
 * organization_memberships/users join is therefore exercised by seeding
 * flat, pre-joined membership rows that already carry firstName/lastName
 * directly, the same workaround convention established in employees.test.ts
 * (W117) for an identical mock limitation.
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
  personnelFilesTable,
  personnelFileVolumesTable,
  personnelFileMovementsTable,
  recordsLocationsTable,
  departmentsTable,
  positionsTable,
  reportsTable,
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
      personnelFileRows: [] as Record<string, unknown>[],
      volumeRows: [] as Record<string, unknown>[],
      movementRows: [] as Record<string, unknown>[],
      locationRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      reportRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "firstName", "lastName"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status", "firstName", "lastName"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    employeesTable: mockTable("employees", ["id", "organizationId", "firstName", "lastName", "employmentStatus", "departmentId", "positionId", "employeeNumber", "separationDate", "separationReason"]),
    employeeNumberAllocationsTable: mockTable("employee_number_allocations", ["id", "organizationId", "employeeId", "employeeNumber", "allocationMethod", "validFrom", "validTo", "allocatedByMembershipId", "releasedByMembershipId"]),
    personnelFilesTable: mockTable("personnel_files", ["id", "organizationId", "employeeId", "pifNumber", "allocationMethod", "currentLocationId", "currentCustodyState"]),
    personnelFileVolumesTable: mockTable("personnel_file_volumes", ["id", "organizationId", "personnelFileId", "volumeNumber", "currentLocationId", "currentCustodyState"]),
    personnelFileMovementsTable: mockTable("personnel_file_movements", ["id", "organizationId", "personnelFileId", "volumeId", "eventType", "destination", "expectedReturnDate", "occurredAt"]),
    recordsLocationsTable: mockTable("records_locations", ["id", "organizationId", "parentId", "name", "status"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title"]),
    reportsTable: mockTable("reports", ["key", "label", "description", "category", "requiredPermissionKey"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "ne"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "ne") return row[cond.field] !== cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

function tableRows(table: { __name: string }): Record<string, unknown>[] {
  switch (table.__name) {
    case "organization_memberships":
      return fixtures.membershipRows;
    case "employees":
      return fixtures.employeeRows;
    case "employee_number_allocations":
      return fixtures.allocationRows;
    case "personnel_files":
      return fixtures.personnelFileRows;
    case "personnel_file_volumes":
      return fixtures.volumeRows;
    case "personnel_file_movements":
      return fixtures.movementRows;
    case "records_locations":
      return fixtures.locationRows;
    case "departments":
      return fixtures.departmentRows;
    case "positions":
      return fixtures.positionRows;
    case "reports":
      return fixtures.reportRows;
    default:
      return [];
  }
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeNumberAllocationsTable,
  personnelFilesTable,
  personnelFileVolumesTable,
  personnelFileMovementsTable,
  recordsLocationsTable,
  departmentsTable,
  positionsTable,
  reportsTable,
  db: {
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
          const rows = table === membershipRolesTable ? fixtures.membershipRoleRows : fixtures.permissionRows;
          const b = {
            innerJoin: () => b,
            where: () => b,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return b;
        }

        const rows = tableRows(table);
        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  ne: (col: string, val: unknown) => ({ __op: "ne", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  gt: () => undefined,
  or: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: () => undefined,
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const HR_ID = 1;
const EMPLOYEE_ID = 2;

function mockSession(userId = HR_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}
function mockActiveMembership(membershipId = 5, organizationId = ORG_ID, applicationUserId = HR_ID) {
  // membershipId duplicates id — the mock's select() ignores column
  // projection/aliasing entirely (returns raw rows unchanged), so
  // resolveActorNames' own `{ membershipId: organizationMembershipsTable.id, ... }`
  // selection needs the row to already carry a field literally named
  // membershipId, not just id.
  fixtures.membershipRows = [...fixtures.membershipRows.filter((m) => m.id !== membershipId), { id: membershipId, membershipId, applicationUserId, organizationId, status: "active", firstName: "Hana", lastName: "Hr" }];
}
function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}
function mockReportDefinitions() {
  fixtures.reportRows = [
    { key: "personnel_current_staff_number_allocations", label: "Current Staff-Number Allocations", description: "d", category: "personnel_records", requiredPermissionKey: "personnel_file.read" },
    { key: "personnel_historical_staff_number_allocations", label: "Historical Staff-Number Allocations", description: "d", category: "personnel_records", requiredPermissionKey: "personnel_file.read" },
    { key: "personnel_files_by_location", label: "Personnel Files by Physical Location", description: "d", category: "personnel_records", requiredPermissionKey: "personnel_file.read" },
    { key: "personnel_checked_out_overdue_files", label: "Checked-Out / Overdue Personnel Files", description: "d", category: "personnel_records", requiredPermissionKey: "personnel_file.read" },
    { key: "personnel_separated_unreleased_numbers", label: "Separated Employees with Unreleased Staff Numbers", description: "d", category: "personnel_records", requiredPermissionKey: "personnel_file.read" },
    { key: "headcount", label: "Headcount", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.allocationRows = [];
  fixtures.personnelFileRows = [];
  fixtures.volumeRows = [];
  fixtures.movementRows = [];
  fixtures.locationRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.reportRows = [];
  mockReportDefinitions();
  mockSession();
  mockActiveMembership();
  mockPermissions(["personnel_file.read"]);
});

function run(reportKey: string, query = "") {
  return request(app).get(`/api/organizations/${ORG_ID}/personnel-records/reports/${reportKey}${query}`).set("Authorization", "Bearer valid-token");
}

describe("Personnel Reporting — authorization", () => {
  it("denies an ordinary employee without personnel_file.read", async () => {
    mockPermissions([]);
    const res = await run("personnel_current_staff_number_allocations");
    expect(res.status).toBe(403);
  });

  it("denies unauthenticated requests", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/personnel-records/reports/personnel_current_staff_number_allocations`);
    expect(res.status).toBe(401);
  });

  it("404s a report key from a different category (never reachable cross-category)", async () => {
    const res = await run("headcount");
    expect(res.status).toBe(404);
  });

  it("404s an unknown report key entirely", async () => {
    const res = await run("not_a_real_report");
    expect(res.status).toBe(404);
  });
});

describe("Personnel Reporting — Report 1: Current Staff-Number Allocations (CURRENT)", () => {
  it("returns only currently-open allocations, never a released one", async () => {
    fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Boateng", employmentStatus: "active", departmentId: null, positionId: null }];
    fixtures.allocationRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2026-01-01"), validTo: null },
      { id: 2, organizationId: ORG_ID, employeeId: 99, employeeNumber: "EMP-0000", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2021-01-01") },
    ];
    const res = await run("personnel_current_staff_number_allocations");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].staffNumber).toBe("EMP-0001");
    expect(res.body.rows[0].employee).toBe("Ama Boateng");
  });
});

describe("Personnel Reporting — Report 2: Historical Staff-Number Allocations (HISTORICAL, reuse-safe)", () => {
  it("shows a reused number as two separate, clearly-labeled rows — never collapsed", async () => {
    fixtures.employeeRows = [
      { id: 1, organizationId: ORG_ID, firstName: "W119QA", lastName: "Former", employmentStatus: "terminated" },
      { id: 2, organizationId: ORG_ID, firstName: "W119QA", lastName: "Current", employmentStatus: "active" },
    ];
    fixtures.allocationRows = [
      { id: 1, organizationId: ORG_ID, employeeId: 1, employeeNumber: "EMP-0007", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2021-01-01"), releasedByMembershipId: 5 },
      { id: 2, organizationId: ORG_ID, employeeId: 2, employeeNumber: "EMP-0007", allocationMethod: "manual", validFrom: new Date("2022-01-01"), validTo: null, allocatedByMembershipId: 5 },
    ];
    const res = await run("personnel_historical_staff_number_allocations");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    const former = res.body.rows.find((r: { employee: string }) => r.employee === "W119QA Former");
    const current = res.body.rows.find((r: { employee: string }) => r.employee === "W119QA Current");
    expect(former.isCurrent).toBe("No");
    expect(current.isCurrent).toBe("Yes");
    expect(former.staffNumber).toBe("EMP-0007");
    expect(current.staffNumber).toBe("EMP-0007");
    expect(former.releasedBy).toBe("Hana Hr");
    expect(current.allocatedBy).toBe("Hana Hr");
  });
});

describe("Personnel Reporting — Report 3: Personnel Files by Location (CURRENT)", () => {
  it("resolves the current location's own hierarchical path", async () => {
    fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Boateng", employeeNumber: "EMP-0001" }];
    fixtures.locationRows = [
      { id: 1, organizationId: ORG_ID, parentId: null, name: "HR Office", status: "active" },
      { id: 2, organizationId: ORG_ID, parentId: 1, name: "Cabinet 2", status: "active" },
    ];
    fixtures.personnelFileRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, pifNumber: "PIF-001", currentLocationId: 2, currentCustodyState: "in_registry" }];
    const res = await run("personnel_files_by_location");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].location).toBe("HR Office > Cabinet 2");
    expect(res.body.rows[0].staffNumber).toBe("EMP-0001");
  });
});

describe("Personnel Reporting — Report 4: Checked-Out / Overdue Personnel Files (overdue live-derived)", () => {
  it("distinguishes checked-out-not-overdue from checked-out-overdue, and excludes returned files", async () => {
    fixtures.employeeRows = [
      { id: 1, organizationId: ORG_ID, firstName: "A", lastName: "One" },
      { id: 2, organizationId: ORG_ID, firstName: "B", lastName: "Two" },
      { id: 3, organizationId: ORG_ID, firstName: "C", lastName: "Three" },
    ];
    const future = new Date(Date.now() + 30 * 86400000);
    const past = new Date(Date.now() - 30 * 86400000);
    fixtures.personnelFileRows = [
      { id: 1, organizationId: ORG_ID, employeeId: 1, pifNumber: "PIF-001", currentCustodyState: "checked_out", currentLocationId: null },
      { id: 2, organizationId: ORG_ID, employeeId: 2, pifNumber: "PIF-002", currentCustodyState: "checked_out", currentLocationId: null },
      { id: 3, organizationId: ORG_ID, employeeId: 3, pifNumber: "PIF-003", currentCustodyState: "in_registry", currentLocationId: null },
    ];
    fixtures.movementRows = [
      { id: 1, organizationId: ORG_ID, personnelFileId: 1, volumeId: null, eventType: "checked_out", destination: "Jane (HR)", expectedReturnDate: future, occurredAt: new Date("2026-01-01") },
      { id: 2, organizationId: ORG_ID, personnelFileId: 2, volumeId: null, eventType: "checked_out", destination: "John (Audit)", expectedReturnDate: past, occurredAt: new Date("2026-01-01") },
    ];
    const res = await run("personnel_checked_out_overdue_files");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2); // file 3 (in_registry) is excluded entirely
    const notOverdue = res.body.rows.find((r: { pifNumber: string }) => r.pifNumber === "PIF-001");
    const overdue = res.body.rows.find((r: { pifNumber: string }) => r.pifNumber === "PIF-002");
    expect(notOverdue.overdue).toBe("No");
    expect(overdue.overdue).toBe("Yes");
  });

  it("includes a missing file with overdue always No (missing is its own state, not an overdue checkout)", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: ORG_ID, firstName: "A", lastName: "One" }];
    fixtures.personnelFileRows = [{ id: 1, organizationId: ORG_ID, employeeId: 1, pifNumber: "PIF-001", currentCustodyState: "missing", currentLocationId: null }];
    const res = await run("personnel_checked_out_overdue_files");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].custodyState).toBe("missing");
    expect(res.body.rows[0].overdue).toBe("No");
  });
});

describe("Personnel Reporting — Report 5: Separated Employees with Unreleased Staff Numbers (informational only)", () => {
  it("includes a separated employee who still holds an open allocation", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: ORG_ID, firstName: "A", lastName: "One", employmentStatus: "terminated", separationDate: new Date("2026-01-01"), separationReason: "resigned" }];
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 1, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: null }];
    const res = await run("personnel_separated_unreleased_numbers");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].staffNumber).toBe("EMP-0001");
  });

  it("excludes a separated employee whose number was already released", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: ORG_ID, firstName: "A", lastName: "One", employmentStatus: "terminated", separationDate: new Date("2026-01-01") }];
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 1, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: new Date("2026-01-02") }];
    const res = await run("personnel_separated_unreleased_numbers");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it("excludes a currently-active employee even with an open allocation", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: ORG_ID, firstName: "A", lastName: "One", employmentStatus: "active" }];
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: 1, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2020-01-01"), validTo: null }];
    const res = await run("personnel_separated_unreleased_numbers");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });
});

describe("Personnel Reporting — CSV export", () => {
  it("returns the same row count as JSON for the same filters", async () => {
    fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId: ORG_ID, firstName: "Ama", lastName: "Boateng" }];
    fixtures.allocationRows = [{ id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, employeeNumber: "EMP-0001", allocationMethod: "generated", validFrom: new Date("2026-01-01"), validTo: null }];
    const json = await run("personnel_current_staff_number_allocations");
    const csv = await run("personnel_current_staff_number_allocations", "?format=csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const csvLines = csv.text.trim().split("\n");
    expect(csvLines.length - 1).toBe(json.body.rows.length); // -1 for the header row
  });
});
