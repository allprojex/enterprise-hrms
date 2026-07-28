/**
 * Integration tests for Leave Types & Policies (Phase 2B, W32), exercising
 * the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest, mirroring
 * employeeDisciplinaryRecords.test.ts's harness shape plus
 * moduleGating.test.ts's module-enablement fixtures. @workspace/db is
 * mocked — no real database connection is made.
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
  modulesTable,
  organizationModulesTable,
  leaveTypesTable,
  leavePoliciesTable,
  branchesTable,
  departmentsTable,
  positionsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      leaveTypeRows: [] as Record<string, unknown>[],
      leavePolicyRows: [] as Record<string, unknown>[],
      branchRows: [] as { organizationId: number }[],
      departmentRows: [] as { organizationId: number }[],
      positionRows: [] as { organizationId: number }[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    modulesTable: { __name: "modules" },
    organizationModulesTable: { __name: "organization_modules" },
    leaveTypesTable: { __name: "leave_types" },
    leavePoliciesTable: { __name: "leave_policies" },
    branchesTable: { __name: "branches" },
    departmentsTable: { __name: "departments" },
    positionsTable: { __name: "positions" },
    auditEventsTable: { __name: "audit_events" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  leaveTypesTable,
  leavePoliciesTable,
  branchesTable,
  departmentsTable,
  positionsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === modulesTable) rows = fixtures.moduleRows;
        else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === leaveTypesTable) rows = fixtures.leaveTypeRows;
        else if (table === leavePoliciesTable) rows = fixtures.leavePolicyRows;
        else if (table === branchesTable) rows = fixtures.branchRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === positionsTable) rows = fixtures.positionRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "active", ...v };
        if (table === leaveTypesTable) {
          const codeTaken = fixtures.leaveTypeRows.some((r) => (r as Record<string, unknown>).code === v.code);
          if (codeTaken) return { returning: () => Promise.reject({ code: "23505" }) };
          fixtures.leaveTypeRows = [...fixtures.leaveTypeRows, row];
        }
        if (table === leavePoliciesTable) fixtures.leavePolicyRows = [...fixtures.leavePolicyRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          const base =
            table === leaveTypesTable ? fixtures.leaveTypeRows[0] : table === leavePoliciesTable ? fixtures.leavePolicyRows[0] : undefined;
          return { returning: () => Promise.resolve(base ? [{ ...base, ...v }] : []) };
        },
      }),
    }),
  },
}));

vi.mock("../lib/dbErrors", () => ({
  isUniqueViolation: (err: unknown) => !!err && typeof err === "object" && (err as { code?: string }).code === "23505",
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  inArray: () => "inArray",
}));

const { default: app } = await import("../app");

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: 10,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = 10) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockLeaveModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "leave", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }] : [];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.leaveTypeRows = [];
  fixtures.leavePolicyRows = [];
  fixtures.branchRows = [];
  fixtures.departmentRows = [];
  fixtures.positionRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("GET /api/organizations/:organizationId/leave-types", () => {
  it("returns 403 when the leave module is not enabled for the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.read"]);
    mockLeaveModuleEnabled(false);

    const res = await request(app).get("/api/organizations/10/leave-types").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller lacks leave_type.read even with the module enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);
    mockLeaveModuleEnabled(true);

    const res = await request(app).get("/api/organizations/10/leave-types").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("lists leave types when module-enabled and permitted", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.read"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];

    const res = await request(app).get("/api/organizations/10/leave-types").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe("POST /api/organizations/:organizationId/leave-types", () => {
  it("creates a leave type and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);

    const res = await request(app)
      .post("/api/organizations/10/leave-types")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Annual Leave", code: "ANNUAL" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("ANNUAL");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_type.created");
  });

  it("returns 409 when the code already exists in the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/leave-types")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Annual Leave (dup)", code: "ANNUAL" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/organizations/:organizationId/leave-types/:id/archive|reactivate", () => {
  it("archives and reactivates a leave type", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];

    const archiveRes = await request(app).post("/api/organizations/10/leave-types/1/archive").set("Authorization", "Bearer valid-token");
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.status).toBe("inactive");

    const reactivateRes = await request(app).post("/api/organizations/10/leave-types/1/reactivate").set("Authorization", "Bearer valid-token");
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.status).toBe("active");
  });

  it("returns 404 when the leave type does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [];

    const res = await request(app).post("/api/organizations/10/leave-types/99/archive").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/leave-types/:leaveTypeId/policies", () => {
  const validPolicyBody = {
    name: "Full-time policy",
    annualEntitlementDays: 21,
    effectiveFrom: "2026-01-01",
  };

  it("creates a leave policy and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies")
      .set("Authorization", "Bearer valid-token")
      .send(validPolicyBody);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Full-time policy");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("leave_policy.created");
  });

  it("returns 400 when the leave type does not belong to this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies")
      .set("Authorization", "Bearer valid-token")
      .send(validPolicyBody);

    expect(res.status).toBe(400);
  });

  it("returns 400 when a referenced branch belongs to a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];
    fixtures.branchRows = [{ organizationId: 999 }];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies")
      .set("Authorization", "Bearer valid-token")
      .send({ ...validPolicyBody, branchId: 5 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when carryForwardAllowed is true but maxCarryForwardDays is missing", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies")
      .set("Authorization", "Bearer valid-token")
      .send({ ...validPolicyBody, carryForwardAllowed: true });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId/archive", () => {
  it("archives a leave policy independently of the parent leave type", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];
    fixtures.leavePolicyRows = [
      { id: 1, organizationId: 10, leaveTypeId: 1, name: "Full-time policy", status: "active" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies/1/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inactive");
  });

  it("returns 404 when the policy does not exist for this leave type", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["leave_type.manage"]);
    mockLeaveModuleEnabled(true);
    fixtures.leaveTypeRows = [{ id: 1, organizationId: 10, name: "Annual", code: "ANNUAL", status: "active" }];
    fixtures.leavePolicyRows = [];

    const res = await request(app)
      .post("/api/organizations/10/leave-types/1/policies/99/archive")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });
});
