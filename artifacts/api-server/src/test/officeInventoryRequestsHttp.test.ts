/**
 * Office Inventory, Workstream 3 — HTTP authorization boundary for
 * requests/approval/delegation routes. Mirrors the established W1/W2
 * harness. Scoped deliberately to the AUTH CHAIN (401/403/module-disabled)
 * — full request-creation/approval business logic already has dedicated
 * mocked coverage (officeInventoryRequests.test.ts equivalents folded into
 * officeInventoryDelegations.test.ts/officeInventoryRequestsCore.test.ts)
 * and was additionally proven end-to-end against the real development
 * database (see PROJECT_STATUS.md's Workstream 3 entry) — mocking the full
 * multi-table request-creation happy path through HTTP here would mean
 * re-implementing employees/departments/items/numbering/config semantics a
 * third time for no additional real assurance. No real database connection
 * is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryApprovalDelegationsTable,
  departmentsTable,
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
      moduleRows: [] as Record<string, unknown>[],
      orgModuleRows: [] as Record<string, unknown>[],
      requestRows: [] as Record<string, unknown>[],
      requestLineRows: [] as Record<string, unknown>[],
      delegationRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "defaultEnabled", "requiredModuleKeys", "status"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    officeInventoryRequestsTable: mockTable("office_inventory_requests", ["id", "organizationId", "requestedByMembershipId", "forDepartmentId", "status"]),
    officeInventoryRequestLinesTable: mockTable("office_inventory_request_lines", ["id", "organizationId", "requestId", "approvalStatus"]),
    officeInventoryApprovalDelegationsTable: mockTable("office_inventory_approval_delegations", ["id", "organizationId", "departmentId", "delegatingHeadMembershipId", "delegateMembershipId", "validTo"]),
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationMembershipsTable) return fixtures.membershipRows;
  if (table === membershipRolesTable) return fixtures.membershipRoleRows as never;
  if (table === rolePermissionsTable) return fixtures.permissionRows as never;
  if (table === modulesTable) return fixtures.moduleRows;
  if (table === organizationModulesTable) return fixtures.orgModuleRows;
  if (table === officeInventoryRequestsTable) return fixtures.requestRows;
  if (table === officeInventoryRequestLinesTable) return fixtures.requestLineRows;
  if (table === officeInventoryApprovalDelegationsTable) return fixtures.delegationRows;
  if (table === departmentsTable) return fixtures.departmentRows;
  return fixtures.sessionRows;
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
    execute: () => Promise.resolve(undefined),
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
  modulesTable,
  organizationModulesTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryApprovalDelegationsTable,
  departmentsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
  gte: () => undefined,
  inArray: () => undefined,
  or: () => undefined,
  gt: () => undefined,
  sql: Object.assign((strings: TemplateStringsArray) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: () => Promise.resolve(undefined),
}));

vi.mock("../lib/departmentHeads", () => ({
  getCurrentDepartmentHead: () => Promise.resolve(null), // vacant by default in this HTTP-boundary suite
}));

const { default: app } = await import("../app");

const ORG_ID = 10;

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", role: "employee", organizationId: ORG_ID, avatarUrl: null, jobTitle: null, department: null, phoneNumber: null, createdAt: new Date() },
    },
  ];
}
function mockActiveMembership(organizationId = ORG_ID, membershipId = 5) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() }];
}
function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}
function setModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "office_inventory", defaultEnabled: false, requiredModuleKeys: [], status: "hidden" }];
  fixtures.orgModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.orgModuleRows = [];
  fixtures.requestRows = [];
  fixtures.requestLineRows = [];
  fixtures.delegationRows = [];
  fixtures.departmentRows = [{ id: 1, organizationId: ORG_ID }];
  fixtures.idCounters = new Map();
  mockSession();
  mockActiveMembership();
  setModuleEnabled(true);
});

describe("Requests — auth chain", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.request", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 when module disabled, even with the permission", async () => {
    setModuleEnabled(false);
    mockPermissions(["office_inventory.request"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("succeeds (empty list) for an explicitly authorized actor", async () => {
    mockPermissions(["office_inventory.request"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/requests`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("cancel: 403 without office_inventory.request", async () => {
    mockPermissions([]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/requests/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("Department approval queue / approval-context — office_inventory.approve + relationship", () => {
  it("403 without office_inventory.approve", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/departments/1/requests`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 with office_inventory.approve but NOT the department's Head/delegate (vacant department in this suite)", async () => {
    mockPermissions(["office_inventory.approve"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/departments/1/requests`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });
});

describe("Request line approve/reject — office_inventory.approve", () => {
  it("401 without auth", async () => {
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/1/approve`).send({ approvedQuantity: "1.00" });
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.approve", async () => {
    mockPermissions([]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/1/approve`)
      .set("Authorization", "Bearer valid-token")
      .send({ approvedQuantity: "1.00" });
    expect(res.status).toBe(403);
  });

  it("404 for an unknown line even with the permission", async () => {
    mockPermissions(["office_inventory.approve"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/9999/approve`)
      .set("Authorization", "Bearer valid-token")
      .send({ approvedQuantity: "1.00" });
    expect(res.status).toBe(404);
  });

  it("reject: 400 without a rejectionReason", async () => {
    mockPermissions(["office_inventory.approve"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/request-lines/1/reject`)
      .set("Authorization", "Bearer valid-token")
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("Delegations — office_inventory.delegate.manage + current-Head-only", () => {
  it("401 without auth", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/departments/1/delegations`);
    expect(res.status).toBe(401);
  });

  it("403 without office_inventory.delegate.manage", async () => {
    mockPermissions([]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/departments/1/delegations`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("403 with the permission but not the department's current Head (vacant department in this suite)", async () => {
    mockPermissions(["office_inventory.delegate.manage"]);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/office-inventory/departments/1/delegations`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("create: 404 for an unknown department", async () => {
    mockPermissions(["office_inventory.delegate.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/office-inventory/departments/9999/delegations`)
      .set("Authorization", "Bearer valid-token")
      .send({ delegateMembershipId: 5 });
    expect(res.status).toBe(404);
  });

  it("revoke: 404 for an unknown delegation", async () => {
    mockPermissions(["office_inventory.delegate.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/office-inventory/delegations/9999/revoke`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
