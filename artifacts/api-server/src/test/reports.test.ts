/**
 * Integration tests for the Reporting Foundation (W17): the report registry
 * catalog and running a report scoped to an organization. @workspace/db is
 * mocked with real eq/and predicate matching (same convention as
 * admin-endpoints.test.ts) so tenant-scoping and per-report permission
 * gating are actually exercised, not just assumed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { ROLE_PERMISSIONS } from "@workspace/db/seed/roles-permissions-definitions";

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
  reportsTable,
  employeesTable,
  branchesTable,
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
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      reportRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
      "expiresAt",
    ]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    reportsTable: mockTable("reports", ["key"]),
    employeesTable: mockTable("employees", ["organizationId", "branchId", "employmentStatus"]),
    branchesTable: mockTable("branches", ["organizationId", "id", "name"]),
    auditEventsTable: mockTable("audit_events", ["organizationId", "eventType"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  reportsTable,
  employeesTable,
  branchesTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;
        else if (table === reportsTable) rows = fixtures.reportRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === branchesTable) rows = fixtures.branchRows;
        else if (table === auditEventsTable) rows = fixtures.auditRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => builder,
          limit(n: number) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          offset(n: number) {
            filtered = filtered.slice(n);
            return builder;
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: col.split(".").pop() }),
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: col.split(".").pop(), vals }) as never,
}));

const { default: app } = await import("../app");

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User" },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = 10) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

const REPORT_ROWS = [
  { id: 1, key: "headcount", label: "Headcount", description: "By branch.", category: "workforce", requiredPermissionKey: "employee.read" },
  { id: 2, key: "workforce_status", label: "Workforce Status", description: "By status.", category: "workforce", requiredPermissionKey: "employee.read" },
  { id: 3, key: "audit_summary", label: "Audit Summary", description: "By event type.", category: "compliance", requiredPermissionKey: "audit.read" },
];

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.reportRows = [...REPORT_ROWS];
  fixtures.employeeRows = [];
  fixtures.branchRows = [];
  fixtures.auditRows = [];
});

describe("GET /api/reports", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/reports");
    expect(res.status).toBe(401);
  });

  it("returns the report catalog for any authenticated user", async () => {
    mockSession();
    const res = await request(app).get("/api/reports").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((r: { key: string }) => r.key)).toEqual(["headcount", "workforce_status", "audit_summary"]);
  });
});

describe("GET /api/organizations/:organizationId/reports/:reportKey/run", () => {
  it("returns 403 without an active membership (tenant isolation)", async () => {
    mockSession();
    const res = await request(app)
      .get("/api/organizations/10/reports/headcount/run")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown report key", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);

    const res = await request(app)
      .get("/api/organizations/10/reports/bogus/run")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the membership lacks the report's required permission", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);

    const res = await request(app)
      .get("/api/organizations/10/reports/headcount/run")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("runs the headcount report grouped by branch, scoped to the caller's organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.branchRows = [
      { id: 1, organizationId: 10, name: "HQ" },
      { id: 2, organizationId: 99, name: "Other Org Branch" },
    ];
    fixtures.employeeRows = [
      { organizationId: 10, branchId: 1, employmentStatus: "active" },
      { organizationId: 10, branchId: 1, employmentStatus: "active" },
      { organizationId: 10, branchId: null, employmentStatus: "active" },
      { organizationId: 99, branchId: 2, employmentStatus: "active" },
    ];

    const res = await request(app)
      .get("/api/organizations/10/reports/headcount/run")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("headcount");
    expect(res.body.rows).toEqual(
      expect.arrayContaining([
        { branch: "HQ", count: 2 },
        { branch: "Unassigned", count: 1 },
      ]),
    );
    expect(res.body.rows).toHaveLength(2);
  });

  it("runs the workforce_status report grouped by employment status", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { organizationId: 10, employmentStatus: "active" },
      { organizationId: 10, employmentStatus: "active" },
      { organizationId: 10, employmentStatus: "terminated" },
      { organizationId: 99, employmentStatus: "active" },
    ];

    const res = await request(app)
      .get("/api/organizations/10/reports/workforce_status/run")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([
      { status: "active", count: 2 },
      { status: "terminated", count: 1 },
    ]);
  });

  it("runs the audit_summary report grouped by event type, tenant-scoped", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { organizationId: 10, eventType: "employee.separated" },
      { organizationId: 10, eventType: "employee.separated" },
      { organizationId: 99, eventType: "employee.separated" },
    ];

    const res = await request(app)
      .get("/api/organizations/10/reports/audit_summary/run")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([{ eventType: "employee.separated", count: 2 }]);
  });

  it("returns CSV when format=csv is requested", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ organizationId: 10, employmentStatus: "active" }];

    const res = await request(app)
      .get("/api/organizations/10/reports/workforce_status/run?format=csv")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toBe("Status,Employees\nactive,1");
  });
});

/**
 * Authorization fix (2026-09-15). headcount and workforce_status aggregate the
 * whole organization, so they require employee.write, not the employee.read
 * directory grant every role holds. REPORT_ROWS above deliberately keeps the
 * STALE employee.read key an already-seeded database still stores (seed-reports
 * is insert-only): these tests prove the route authorizes from the code
 * registry, never from that row. Roles use the real seeded grant lists.
 */
describe("workforce aggregate reports: authorization from the code registry", () => {
  function seedOrganizationWorkforce() {
    fixtures.branchRows = [{ id: 1, organizationId: 10, name: "HQ" }];
    fixtures.employeeRows = [
      { organizationId: 10, branchId: 1, employmentStatus: "active" },
      { organizationId: 10, branchId: 1, employmentStatus: "probation" },
    ];
  }

  it("keeps the stale employee.read key in the database rows under test", () => {
    expect(REPORT_ROWS.find((r) => r.key === "headcount")?.requiredPermissionKey).toBe("employee.read");
    expect(REPORT_ROWS.find((r) => r.key === "workforce_status")?.requiredPermissionKey).toBe("employee.read");
    // The canonical employee role holds that stale key, so a row-based gate would admit it.
    expect(ROLE_PERMISSIONS.employee).toContain("employee.read");
    expect(ROLE_PERMISSIONS.employee).not.toContain("employee.write");
  });

  for (const reportKey of ["headcount", "workforce_status"]) {
    describe(reportKey, () => {
      const url = `/api/organizations/10/reports/${reportKey}/run`;

      it("denies an ordinary employee (canonical employee role) with 403", async () => {
        mockSession();
        mockActiveMembership();
        mockPermissions([...ROLE_PERMISSIONS.employee]);
        seedOrganizationWorkforce();

        const res = await request(app).get(url).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Forbidden" });
      });

      it("denies the CSV export to an ordinary employee with 403", async () => {
        mockSession();
        mockActiveMembership();
        mockPermissions([...ROLE_PERMISSIONS.employee]);
        seedOrganizationWorkforce();

        const res = await request(app).get(`${url}?format=csv`).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(res.text).not.toContain("Employees");
      });

      it("denies a department head who holds only the employee role with 403", async () => {
        // Department headship is organizational data (who heads a department,
        // who reports to whom), not a permission grant, and this built-in
        // runner has no team scope — so a head's effective keys are exactly
        // the employee role's, and the organization-wide figure stays closed.
        mockSession();
        mockActiveMembership();
        mockPermissions([...ROLE_PERMISSIONS.employee]);
        seedOrganizationWorkforce();

        const res = await request(app).get(url).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
      });

      it("allows the canonical HR role", async () => {
        mockSession();
        mockActiveMembership();
        mockPermissions([...ROLE_PERMISSIONS.hr]);
        seedOrganizationWorkforce();

        const res = await request(app).get(url).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.key).toBe(reportKey);
        expect(res.body.rows.length).toBeGreaterThan(0);
      });

      it("allows org_admin, which holds employee.write", async () => {
        mockSession();
        mockActiveMembership();
        mockPermissions([...ROLE_PERMISSIONS.org_admin]);
        seedOrganizationWorkforce();

        const res = await request(app).get(url).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
      });

      it("denies an HR caller whose membership belongs to a different organization with 403", async () => {
        mockSession();
        mockActiveMembership(5, 99);
        mockPermissions([...ROLE_PERMISSIONS.hr]);
        seedOrganizationWorkforce();

        const res = await request(app).get(url).set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(403);
        expect(res.body.rows).toBeUndefined();
      });
    });
  }

  it("fails closed with 403 for a stored report the code registry does not define", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([...ROLE_PERMISSIONS.hr]);
    fixtures.reportRows = [
      ...REPORT_ROWS,
      { id: 99, key: "unregistered_report", label: "Unregistered", description: "d", category: "workforce", requiredPermissionKey: "employee.read" },
    ];

    const res = await request(app)
      .get("/api/organizations/10/reports/unregistered_report/run")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});
