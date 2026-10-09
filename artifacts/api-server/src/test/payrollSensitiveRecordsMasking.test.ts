/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, Owner Decision #23) —
 * integration tests through supertest against the real app: banking and
 * statutory-identifier reads are masked by default, a distinct ?reveal=true
 * returns the full value, and each is recorded as a distinct audit
 * eventType (.read vs .revealed) via the real recordAuditEvent() path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  organizationModulesTable,
  modulesTable,
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
      statutoryRows: [] as Record<string, unknown>[],
      moduleRows: [] as Record<string, unknown>[],
      orgModuleRows: [] as Record<string, unknown>[],
      auditInserts: [] as Record<string, unknown>[],
    },
    usersTable: mockTableInner("users", ["id"]),
    sessionsTable: mockTableInner("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTableInner("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTableInner("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTableInner("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTableInner("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTableInner("permissions", ["id", "key"]),
    employeesTable: mockTableInner("employees", ["id", "organizationId"]),
    employeeBankingDetailsTable: mockTableInner("employee_banking_details", ["organizationId", "employeeId", "validTo"]),
    employeeStatutoryIdentifiersTable: mockTableInner("employee_statutory_identifiers", ["organizationId", "employeeId", "validTo"]),
    organizationModulesTable: mockTableInner("organization_modules", ["organizationId", "moduleId"]),
    modulesTable: mockTableInner("modules", ["id", "key", "defaultEnabled"]),
    auditEventsTable: mockTableInner("audit_events", []),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeBankingDetailsTable,
  employeeStatutoryIdentifiersTable,
  organizationModulesTable,
  modulesTable,
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
        else if (table === employeeStatutoryIdentifiersTable) rows = fixtures.statutoryRows;
        else if (table === modulesTable) rows = fixtures.moduleRows;
        else if (table === organizationModulesTable) rows = fixtures.orgModuleRows;

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
  isNull: () => undefined,
  gt: () => undefined,
  inArray: () => undefined,
  desc: () => undefined,
}));

const { default: app } = await import("../app");

function mockSession() {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: 1, expiresAt: new Date(Date.now() + 100000) },
      user: { id: 1, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: 10, disabledAt: null, createdAt: new Date() },
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId: 10, status: "active" }];
  fixtures.membershipRoleRows = [{ membershipId: 5, roleId: 1 }];
  fixtures.permissionRows = [{ roleId: 1, key: "payroll.banking.read" }, { roleId: 1, key: "payroll.statutory_identifiers.read" }];
  fixtures.employeeRows = [{ id: 42, organizationId: 10 }];
  fixtures.moduleRows = [{ id: 1, key: "payroll", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.orgModuleRows = [{ organizationId: 10, moduleId: 1, enabled: true }];
  fixtures.bankingRows = [{ id: 1, organizationId: 10, employeeId: 42, bankCode: "GCB", accountNumber: "1234567890123", accountName: "Test Employee", branch: null, validFrom: new Date(), validTo: null }];
  fixtures.statutoryRows = [{ id: 1, organizationId: 10, employeeId: 42, ssnitNumber: "SN123456789", tin: "C0012345678", validFrom: new Date(), validTo: null }];
  fixtures.auditInserts = [];
  mockSession();
});

describe("GET .../payroll/banking — masked by default, explicit reveal", () => {
  it("returns a masked account number by default", async () => {
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/banking")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.accountNumber).toBe("*********0123");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "payroll_banking.read" });
  });

  it("returns the full account number with ?reveal=true, and records a distinct .revealed audit event", async () => {
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/banking?reveal=true")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.accountNumber).toBe("1234567890123");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "payroll_banking.revealed" });
  });

  it("masks every row in the banking history list by default", async () => {
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/banking/history")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body[0].accountNumber).toBe("*********0123");
  });

  it("still requires payroll.banking.read — masking does not weaken the existing permission gate", async () => {
    fixtures.permissionRows = [{ roleId: 1, key: "employee.read" }];
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/banking")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
    expect(fixtures.auditInserts).toHaveLength(0);
  });
});

describe("GET .../payroll/statutory-identifiers — masked by default, explicit reveal", () => {
  it("masks both ssnitNumber and tin by default", async () => {
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/statutory-identifiers")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.ssnitNumber).toBe("*******6789");
    expect(res.body.tin).toBe("*******5678");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "payroll_statutory_identifier.read" });
  });

  it("reveals both full values with ?reveal=true and audits a .revealed event", async () => {
    const res = await request(app)
      .get("/api/organizations/10/employees/42/payroll/statutory-identifiers?reveal=true")
      .set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.ssnitNumber).toBe("SN123456789");
    expect(res.body.tin).toBe("C0012345678");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "payroll_statutory_identifier.revealed" });
  });

  it("a masked view is never mistakenly recorded as a .revealed event", async () => {
    await request(app).get("/api/organizations/10/employees/42/payroll/statutory-identifiers").set("Authorization", "Bearer valid-token");
    expect(fixtures.auditInserts.some((e) => e.eventType === "payroll_statutory_identifier.revealed")).toBe(false);
  });
});
