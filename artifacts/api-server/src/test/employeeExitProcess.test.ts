/**
 * Integration tests for Exit Management (Phase 2A, W29), exercising the
 * real requireAuth/requireMembership/requirePermission chain and route
 * handlers through supertest, mirroring employeeDisciplinaryRecords.test.ts's
 * harness shape. @workspace/db is mocked — no real database connection is
 * made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { ROLE_PERMISSIONS } from "@workspace/db/seed/roles-permissions-definitions";

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
  employeeExitProcessesTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as { id: number; organizationId: number; firstName: string; lastName: string; employmentStatus: string; separationDate?: Date | null }[],
      processRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolesTable: { __name: "roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    employeeExitProcessesTable: { __name: "employee_exit_processes" },
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
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  employeeExitProcessesTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeExitProcessesTable) rows = fixtures.processRows;
        else rows = fixtures.sessionRows;

        const builder = {
          innerJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v };
        if (table === employeeExitProcessesTable) fixtures.processRows = [...fixtures.processRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          const base = table === employeeExitProcessesTable ? fixtures.processRows[0] : undefined;
          return { returning: () => Promise.resolve(base ? [{ ...base, ...v }] : []) };
        },
      }),
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
  fixtures.processRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("GET /api/organizations/:organizationId/employees/:employeeId/exit-process", () => {
  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app).get("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("lists exit processes for the employee", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];
    fixtures.processRows = [
      {
        id: 1,
        organizationId: 10,
        employeeId: 42,
        separationDate: new Date("2026-01-01"),
        checklistCompleted: false,
        clearanceCompleted: false,
        exitInterviewCompleted: false,
      },
    ];

    const res = await request(app).get("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

/**
 * Authorization fix (2026-09-15): the read was gated by employee.read, the
 * directory grant every role holds, so any employee could read a colleague's
 * exit interview notes. It now requires employee.write, like its own
 * POST/PATCH. Roles use the real seeded grant lists.
 */
describe("GET exit-process: HR-only authorization", () => {
  const URL = "/api/organizations/10/employees/42/exit-process";
  const CONFIDENTIAL_NOTES = "Confidential: left after a complaint about their manager";

  beforeEach(() => {
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", departmentId: 3, reportingManagerId: 7 } as never,
    ];
    fixtures.processRows = [
      {
        id: 1,
        organizationId: 10,
        employeeId: 42,
        separationDate: new Date("2026-01-01"),
        separationBasis: "already_separated",
        checklistCompleted: true,
        clearanceCompleted: false,
        exitInterviewCompleted: true,
        exitInterviewNotes: CONFIDENTIAL_NOTES,
      },
    ];
  });

  it("denies an ordinary employee reading a colleague's exit process with 403", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([...ROLE_PERMISSIONS.employee]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(CONFIDENTIAL_NOTES);
  });

  it("denies a department head (employee role) reading their department member / direct report with 403", async () => {
    // Employee 42 sits in department 3 and reports to employee 7, the caller.
    // Neither relationship is an HR grant; the caller's keys are the employee role's.
    mockSession();
    mockActiveMembership();
    mockPermissions([...ROLE_PERMISSIONS.employee]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(CONFIDENTIAL_NOTES);
  });

  it("denies a caller holding only employee.read, even for their own record: there is no self-service tier", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows the canonical HR role and returns the full record", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([...ROLE_PERMISSIONS.hr]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].exitInterviewNotes).toBe(CONFIDENTIAL_NOTES);
  });

  it("allows org_admin, which holds employee.write", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([...ROLE_PERMISSIONS.org_admin]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("denies an HR caller with no active membership in the target organization (cross-organization) with 403", async () => {
    mockSession();
    // No membership row for organization 10: the caller's HR role belongs elsewhere.
    fixtures.membershipRows = [];
    mockPermissions([...ROLE_PERMISSIONS.hr]);

    const res = await request(app).get(URL).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(CONFIDENTIAL_NOTES);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/exit-process", () => {
  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", separationDate: new Date("2026-01-01") },
    ];

    const res = await request(app).post("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(403);
  });

  it("returns 400 when the employee is not currently separated", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app).post("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when an exit process already exists for the current separation", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    const separationDate = new Date("2026-01-01");
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", separationDate }];
    fixtures.processRows = [
      { id: 1, organizationId: 10, employeeId: 42, separationDate, checklistCompleted: false, clearanceCompleted: false, exitInterviewCompleted: false },
    ];

    const res = await request(app).post("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(400);
  });

  it("creates the exit process and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    const separationDate = new Date("2026-01-01");
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", separationDate }];

    const res = await request(app).post("/api/organizations/10/employees/42/exit-process").set("Authorization", "Bearer valid-token").send({});

    expect(res.status).toBe(201);
    expect(res.body.checklistCompleted).toBeFalsy();
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_exit_process.created");
  });
});

describe("PATCH /api/organizations/:organizationId/employees/:employeeId/exit-process/:exitProcessId", () => {
  it("returns 404 when the exit process does not exist in this employee's scope", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];
    fixtures.processRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/employees/42/exit-process/1")
      .set("Authorization", "Bearer valid-token")
      .send({ checklistCompleted: true });

    expect(res.status).toBe(404);
  });

  it("updates the exit process and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];
    fixtures.processRows = [
      {
        id: 1,
        organizationId: 10,
        employeeId: 42,
        separationDate: new Date("2026-01-01"),
        checklistCompleted: false,
        clearanceCompleted: false,
        exitInterviewCompleted: false,
      },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/employees/42/exit-process/1")
      .set("Authorization", "Bearer valid-token")
      .send({ checklistCompleted: true });

    expect(res.status).toBe(200);
    expect(res.body.checklistCompleted).toBe(true);
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect(auditInsert).toBeDefined();
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_exit_process.updated");
  });
});
