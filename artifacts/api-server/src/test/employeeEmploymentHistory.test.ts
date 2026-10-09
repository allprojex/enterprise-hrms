/**
 * Integration tests for GET /organizations/:organizationId/employees/:employeeId/employment-history
 * (Phase 3F, W105 — HR-side gap closure: Transfer/Promote/Confirm have
 * always written to employment_periods, but nothing ever rendered it back).
 * Mirrors employeeSkillsQualifications.test.ts's harness shape exactly.
 * @workspace/db is mocked — no real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  employmentPeriodsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as { id: number; organizationId: number }[],
      employmentPeriodRows: [] as Record<string, unknown>[],
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolesTable: { __name: "roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    employmentPeriodsTable: { __name: "employment_periods" },
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
  employmentPeriodsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employmentPeriodsTable) rows = fixtures.employmentPeriodRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  desc: () => "desc",
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

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.employeeRows = [];
  fixtures.employmentPeriodRows = [];
});

describe("GET /organizations/:organizationId/employees/:employeeId/employment-history", () => {
  it("returns 403 for a caller without employee.write (ordinary employee.read only)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10 }];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/employment-history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/employment-history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("legitimate HR (employee.write) sees the employee's employment history", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10 }];
    fixtures.employmentPeriodRows = [
      {
        id: 1,
        organizationId: 10,
        employeeId: 42,
        eventType: "transfer",
        effectiveDate: new Date("2026-03-01"),
        previousState: { departmentId: 1 },
        newState: { departmentId: 2 },
        createdAt: new Date("2026-03-01"),
      },
    ];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/employment-history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 1, eventType: "transfer" });
  });

  it("returns an empty array when the employee has no employment_periods rows", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10 }];
    fixtures.employmentPeriodRows = [];

    const res = await request(app)
      .get("/api/organizations/10/employees/42/employment-history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
