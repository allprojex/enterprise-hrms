/**
 * WS-4 (Break-Glass Access Foundation, Owner Decision #31) — integration
 * tests, through supertest against the real app, of the actual elevation
 * mechanic: requireMembership's break-glass fallback, requireModuleEnabled's
 * and requirePermission's break-glass-aware resolution, tenant isolation,
 * expiry, immediate revocation, and sensitive-read audit enrichment. Reuses
 * WS-3's payroll banking route (requireMembership -> requireModuleEnabled
 * ("payroll") -> requirePermission("payroll.banking.read")) as the real,
 * already-existing sensitive-data route to elevate into, rather than
 * building a synthetic one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "gt"; field: string; val: unknown }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "gt") {
    const rowVal = row[cond.field] as Date;
    return rowVal instanceof Date && rowVal.getTime() > (cond.val as Date).getTime();
  }
  return true;
}
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
  employeesTable,
  employeeBankingDetailsTable,
  organizationModulesTable,
  modulesTable,
  breakGlassGrantsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  function mockTableInner(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as { session: Record<string, unknown>; user: Record<string, unknown> }[],
      membershipRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      employeeRows: [] as Record<string, unknown>[],
      bankingRows: [] as Record<string, unknown>[],
      moduleRows: [] as Record<string, unknown>[],
      orgModuleRows: [] as Record<string, unknown>[],
      grantRows: [] as Record<string, unknown>[],
      auditInserts: [] as Record<string, unknown>[],
    },
    usersTable: mockTableInner("users", ["id"]),
    sessionsTable: mockTableInner("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTableInner("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
      "expiresAt",
    ]),
    membershipRolesTable: mockTableInner("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTableInner("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTableInner("permissions", ["id", "key"]),
    employeesTable: mockTableInner("employees", ["id", "organizationId"]),
    employeeBankingDetailsTable: mockTableInner("employee_banking_details", ["organizationId", "employeeId", "validTo"]),
    organizationModulesTable: mockTableInner("organization_modules", ["organizationId", "moduleId"]),
    modulesTable: mockTableInner("modules", ["id", "key", "defaultEnabled"]),
    breakGlassGrantsTable: mockTableInner("break_glass_grants", [
      "id",
      "actorUserId",
      "targetOrganizationId",
      "status",
      "expiresAt",
    ]),
    auditEventsTable: mockTableInner("audit_events", []),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeBankingDetailsTable,
  organizationModulesTable,
  modulesTable,
  breakGlassGrantsTable,
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
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeBankingDetailsTable) rows = fixtures.bankingRows;
        else if (table === modulesTable) rows = fixtures.moduleRows;
        else if (table === organizationModulesTable) rows = fixtures.orgModuleRows;
        else if (table === breakGlassGrantsTable) rows = fixtures.grantRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => builder,
          limit: () => Promise.resolve(filtered),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }) as Cond,
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }) as Cond,
  or: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }) as Cond,
  gt: (col: string, val: unknown) => ({ __op: "gt", field: col.split(".").pop(), val }) as Cond,
  isNull: () => undefined,
  inArray: () => undefined,
  desc: () => undefined,
}));

const { default: app } = await import("../app");

const ACTOR_USER_ID = 1;
const ORG_A = 10;
const ORG_B = 20;

function mockSession() {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: ACTOR_USER_ID, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: ACTOR_USER_ID,
        email: "platform-actor@example.com",
        firstName: "Platform",
        lastName: "Actor",
        role: "super_admin",
        organizationId: ORG_A,
        disabledAt: null,
        createdAt: new Date(),
      },
    },
  ];
}

function activeGrant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    actorUserId: ACTOR_USER_ID,
    targetOrganizationId: ORG_A,
    targetInstallationId: null,
    reason: "support ticket #123",
    scope: ["payroll.banking.read"],
    requestedAt: new Date(),
    activatedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    revokedBy: null,
    status: "active",
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = []; // platform actor has NO real membership anywhere
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [{ id: 42, organizationId: ORG_A }];
  fixtures.bankingRows = [
    { id: 1, organizationId: ORG_A, employeeId: 42, bankCode: "GCB", accountNumber: "1234567890123", accountName: "Test Employee", branch: null, validFrom: new Date(), validTo: null },
  ];
  fixtures.moduleRows = [{ id: 1, key: "payroll", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.orgModuleRows = [
    { organizationId: ORG_A, moduleId: 1, enabled: true },
    { organizationId: ORG_B, moduleId: 1, enabled: true },
  ];
  fixtures.grantRows = [];
  fixtures.auditInserts = [];
  mockSession();
});

describe("break-glass elevation through requireMembership/requireModuleEnabled/requirePermission", () => {
  it("denies a platform actor with no membership and no grant (no standing customer-data access)", async () => {
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(fixtures.auditInserts).toHaveLength(0);
  });

  it("allows the request when an active grant for this exact organization is in scope", async () => {
    fixtures.grantRows = [activeGrant()];
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.accountNumber).toBe("*********0123");
  });

  it("tags the resulting sensitive-read audit event with the break-glass grant id, without duplicating it", async () => {
    fixtures.grantRows = [activeGrant()];
    await request(app).get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`).set("Authorization", "Bearer valid-token");
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "payroll_banking.read", breakGlassGrantId: 1 });
  });

  it("denies the same grant when used against a different organization (tenant isolation)", async () => {
    fixtures.grantRows = [activeGrant()]; // scoped to ORG_A only
    const res = await request(app)
      .get(`/api/organizations/${ORG_B}/employees/99/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("denies an expired grant", async () => {
    fixtures.grantRows = [activeGrant({ expiresAt: new Date(Date.now() - 1000) })];
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("denies a revoked grant immediately, with no session invalidation involved", async () => {
    fixtures.grantRows = [activeGrant({ status: "revoked", revokedAt: new Date(), revokedBy: 2 })];
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("denies when the grant's scope does not include the specific permission the route requires", async () => {
    fixtures.grantRows = [activeGrant({ scope: ["employee.read"] })]; // does not include payroll.banking.read
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("still enforces module gating under elevation (module disabled for the target org)", async () => {
    fixtures.grantRows = [activeGrant()];
    fixtures.orgModuleRows = [{ organizationId: ORG_A, moduleId: 1, enabled: false }];
    const res = await request(app)
      .get(`/api/organizations/${ORG_A}/employees/42/payroll/banking`)
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});
