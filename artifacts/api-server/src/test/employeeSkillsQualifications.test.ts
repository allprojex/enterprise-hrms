/**
 * Integration tests for Skills & Qualifications (Phase 2A, W24), exercising
 * the real requireAuth/requireMembership/requirePermission chain and route
 * handlers through supertest, mirroring employeeDocuments.test.ts's harness
 * shape. @workspace/db is mocked — no real database connection is made.
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
  employeeSkillsTable,
  employeeQualificationsTable,
  employeeCertificationsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      employeeRows: [] as { id: number; organizationId: number; firstName: string; lastName: string }[],
      skillRows: [] as Record<string, unknown>[],
      qualificationRows: [] as Record<string, unknown>[],
      certificationRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      deleted: [] as { table: string }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    employeeSkillsTable: { __name: "employee_skills" },
    employeeQualificationsTable: { __name: "employee_qualifications" },
    employeeCertificationsTable: { __name: "employee_certifications" },
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
  employeesTable,
  employeeSkillsTable,
  employeeQualificationsTable,
  employeeCertificationsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        let rows: unknown[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeSkillsTable) rows = fixtures.skillRows;
        else if (table === employeeQualificationsTable) rows = fixtures.qualificationRows;
        else if (table === employeeCertificationsTable) rows = fixtures.certificationRows;
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
        return { returning: () => Promise.resolve([{ id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v }]) };
      },
    }),
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.deleted.push({ table: table.__name });
        return Promise.resolve(undefined);
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          fixtures.inserted.push({ table: table.__name, values: v });
          const base =
            table === employeeSkillsTable
              ? fixtures.skillRows[0]
              : table === employeeQualificationsTable
                ? fixtures.qualificationRows[0]
                : fixtures.certificationRows[0];
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
  fixtures.skillRows = [];
  fixtures.qualificationRows = [];
  fixtures.certificationRows = [];
  fixtures.inserted = [];
  fixtures.deleted = [];
  fixtures.idCounters = new Map();
});

describe("Employee Skills", () => {
  it("returns 403 when the membership's role lacks employee.write on add", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/skills")
      .set("Authorization", "Bearer valid-token")
      .send({ skillCode: "javascript" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted.find((i) => i.table === "employee_skills")).toBeUndefined();
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [];

    const res = await request(app).get("/api/organizations/10/employees/42/skills").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("adds a skill and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/skills")
      .set("Authorization", "Bearer valid-token")
      .send({ skillCode: "javascript", proficiencyLevel: "Advanced" });

    expect(res.status).toBe(201);
    expect(res.body.skillCode).toBe("javascript");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_skill.added");
  });

  it("lists skills for the employee", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.skillRows = [{ id: 1, organizationId: 10, employeeId: 42, skillCode: "javascript", proficiencyLevel: null }];

    const res = await request(app).get("/api/organizations/10/employees/42/skills").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 404 when removing a skill that isn't in this employee's scope", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.skillRows = [];

    const res = await request(app).delete("/api/organizations/10/employees/42/skills/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("removes a skill and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.skillRows = [{ id: 1, organizationId: 10, employeeId: 42, skillCode: "javascript" }];

    const res = await request(app).delete("/api/organizations/10/employees/42/skills/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.find((d) => d.table === "employee_skills")).toBeDefined();
  });
});

describe("Employee Qualifications", () => {
  it("adds a qualification and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/qualifications")
      .set("Authorization", "Bearer valid-token")
      .send({ qualificationTypeCode: "bachelors", institution: "University of Ghana" });

    expect(res.status).toBe(201);
    expect(res.body.qualificationTypeCode).toBe("bachelors");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_qualification.added");
  });

  it("returns 404 when removing a qualification that isn't in this employee's scope", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.qualificationRows = [];

    const res = await request(app).delete("/api/organizations/10/employees/42/qualifications/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("removes a qualification and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.qualificationRows = [{ id: 1, organizationId: 10, employeeId: 42, qualificationTypeCode: "bachelors" }];

    const res = await request(app).delete("/api/organizations/10/employees/42/qualifications/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.find((d) => d.table === "employee_qualifications")).toBeDefined();
  });
});

describe("Employee Certifications", () => {
  it("adds a certification and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/certifications")
      .set("Authorization", "Bearer valid-token")
      .send({ certificationTypeCode: "pmp", issuingOrganization: "PMI" });

    expect(res.status).toBe(201);
    expect(res.body.certificationTypeCode).toBe("pmp");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employee_certification.added");
  });

  it("returns 404 when removing a certification that isn't in this employee's scope", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.certificationRows = [];

    const res = await request(app).delete("/api/organizations/10/employees/42/certifications/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("removes a certification and records an audit event", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace" }];
    fixtures.certificationRows = [{ id: 1, organizationId: 10, employeeId: 42, certificationTypeCode: "pmp" }];

    const res = await request(app).delete("/api/organizations/10/employees/42/certifications/1").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.find((d) => d.table === "employee_certifications")).toBeDefined();
  });
});
