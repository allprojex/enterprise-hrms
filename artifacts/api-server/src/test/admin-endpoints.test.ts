/**
 * Integration tests for the small admin-facing endpoints added alongside
 * membership management: role/permission catalogs, Primary HR, organization
 * settings, and audit event listing. @workspace/db is mocked — no real
 * database connection is made. Focuses on auth/permission gating plus one
 * happy path per endpoint, matching the depth already used for
 * branches/departments/positions in this suite.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  rolesTable,
  primaryHrAssignmentsTable,
  organizationSettingsTable,
  auditEventsTable,
  modulesTable,
  organizationModulesTable,
  masterDataDomainsTable,
  masterDataItemsTable,
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
      roleRows: [] as {
        id: number;
        key: string;
        label: string;
        isSystemRole: boolean;
        organizationId?: number | null;
        description?: string | null;
      }[],
      permissionCatalogRows: [] as { id: number; key: string }[],
      primaryHrRows: [] as Record<string, unknown>[],
      settingsRows: [] as Record<string, unknown>[],
      auditRows: [] as Record<string, unknown>[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      masterDataDomainRows: [] as Record<string, unknown>[],
      masterDataItemRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
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
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "label", "description", "isSystemRole"]),
    primaryHrAssignmentsTable: mockTable("primary_hr_assignments", ["organizationId", "membershipId", "revokedAt"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    auditEventsTable: mockTable("audit_events", ["organizationId", "eventType", "targetType", "targetId", "actorApplicationUserId"]),
    modulesTable: mockTable("modules", ["id", "key", "name", "status"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    masterDataDomainsTable: mockTable("master_data_domains", ["id", "key", "label", "classification"]),
    masterDataItemsTable: mockTable("master_data_items", ["id", "domain", "organizationId", "code", "label", "sortOrder", "status"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "in"; field: string; vals: unknown[] }
  | { __op: "and"; conds: Cond[] }
  | { __op: "or"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "or") return cond.conds.some((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

const dbMock = {
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
        else if (table === rolesTable) rows = fixtures.roleRows as never;
        else if (table === permissionsTable) rows = fixtures.permissionCatalogRows as never;
        else if (table === primaryHrAssignmentsTable) rows = fixtures.primaryHrRows;
        else if (table === organizationSettingsTable) rows = fixtures.settingsRows;
        else if (table === auditEventsTable) rows = fixtures.auditRows;
        else if (table === modulesTable) rows = fixtures.moduleRows;
        else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;
        else if (table === masterDataDomainsTable) rows = fixtures.masterDataDomainRows;
        else if (table === masterDataItemsTable) rows = fixtures.masterDataItemRows;

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
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === masterDataItemsTable) {
          const conflict = fixtures.masterDataItemRows.find(
            (r) => r.domain === v.domain && r.organizationId === v.organizationId && r.code === v.code,
          );
          if (conflict) {
            return {
              returning: () => Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" })),
            };
          }
        }
        if (table === rolesTable) {
          const conflict = fixtures.roleRows.find(
            (r) => r.key === v.key && (r.organizationId ?? null) === (v.organizationId ?? null),
          );
          if (conflict) {
            return {
              returning: () => Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" })),
            };
          }
        }
        fixtures.inserted.push({ table: table.__name, values: v });
        return {
          returning: () => Promise.resolve([{ id: nextId(table), ...v }]),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([{ id: nextId(table), ...v }]),
          }),
        };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            fixtures.inserted.push({ table: table.__name, values: v });
            const base =
              table === primaryHrAssignmentsTable
                ? fixtures.primaryHrRows[0]
                : table === organizationModulesTable
                  ? fixtures.organizationModuleRows[0]
                  : fixtures.settingsRows[0];
            return Promise.resolve(base ? [{ ...base, ...v }] : []);
          },
        }),
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.inserted.push({ table: table.__name, values: "delete" });
        return Promise.resolve(undefined);
      },
    }),
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock),
};

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  rolesTable,
  primaryHrAssignmentsTable,
  organizationSettingsTable,
  auditEventsTable,
  modulesTable,
  organizationModulesTable,
  masterDataDomainsTable,
  masterDataItemsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: (...conds: Cond[]) => ({ __op: "or", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: col.split(".").pop() }),
  gt: () => undefined,
  desc: () => undefined,
  count: () => "count",
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: col.split(".").pop(), vals }),
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
    { id: membershipId, applicationUserId: 1, organizationId, status: "active" },
  ];
}

function mockPermissions(permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.roleRows = [];
  fixtures.permissionCatalogRows = [];
  fixtures.primaryHrRows = [];
  fixtures.settingsRows = [];
  fixtures.auditRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.masterDataDomainRows = [];
  fixtures.masterDataItemRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("GET /api/roles", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/roles");
    expect(res.status).toBe(401);
  });

  it("returns the role catalog for any authenticated user", async () => {
    mockSession();
    fixtures.roleRows = [{ id: 1, key: "org_admin", label: "Organization Admin", isSystemRole: true }];

    const res = await request(app).get("/api/roles").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("org_admin");
  });
});

describe("GET /api/permissions", () => {
  it("returns the permission catalog for any authenticated user", async () => {
    mockSession();
    fixtures.permissionCatalogRows = [{ id: 1, key: "employee.read" }];

    const res = await request(app).get("/api/permissions").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body[0].key).toBe("employee.read");
  });
});

describe("GET /api/modules", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/modules");
    expect(res.status).toBe(401);
  });

  it("returns the module registry for any authenticated user, not org-scoped", async () => {
    mockSession();
    fixtures.moduleRows = [
      {
        id: 1,
        key: "recruitment",
        name: "Recruitment",
        description: "Job requisitions and hiring workflows.",
        category: "hr-operations",
        version: "1.0.0",
        status: "hidden",
        defaultEnabled: false,
        requiredModuleKeys: [],
        optionalModuleKeys: [],
      },
    ];

    const res = await request(app).get("/api/modules").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("recruitment");
    expect(res.body[0].status).toBe("hidden");
  });
});

describe("GET /api/organizations/:organizationId/modules", () => {
  it("returns 403 without organization.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app).get("/api/organizations/10/modules").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("merges the registry with organization overrides, falling back to defaultEnabled when there's no override", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.moduleRows = [
      {
        id: 1,
        key: "recruitment",
        name: "Recruitment",
        description: "d",
        category: "hr-operations",
        version: "1.0.0",
        status: "active",
        defaultEnabled: false,
        requiredModuleKeys: [],
        optionalModuleKeys: [],
      },
      {
        id: 2,
        key: "attendance",
        name: "Attendance",
        description: "d",
        category: "hr-operations",
        version: "1.0.0",
        status: "hidden",
        defaultEnabled: true,
        requiredModuleKeys: [],
        optionalModuleKeys: [],
      },
    ];
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }];

    const res = await request(app).get("/api/organizations/10/modules").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.find((m: { key: string }) => m.key === "recruitment").enabled).toBe(true);
    expect(res.body.find((m: { key: string }) => m.key === "attendance").enabled).toBe(true);
  });
});

describe("PATCH /api/organizations/:organizationId/modules/:moduleKey", () => {
  const recruitment = {
    id: 1,
    key: "recruitment",
    name: "Recruitment",
    description: "d",
    category: "hr-operations",
    version: "1.0.0",
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  };
  const attendanceHidden = {
    id: 2,
    key: "attendance",
    name: "Attendance",
    description: "d",
    category: "hr-operations",
    version: "1.0.0",
    status: "hidden",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  };
  const leaveRequiresRecruitment = {
    id: 3,
    key: "leave",
    name: "Leave",
    description: "d",
    category: "hr-operations",
    version: "1.0.0",
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: ["recruitment"],
    optionalModuleKeys: [],
  };

  it("returns 403 without module.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.moduleRows = [recruitment];

    const res = await request(app)
      .patch("/api/organizations/10/modules/recruitment")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown module key", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [recruitment];

    const res = await request(app)
      .patch("/api/organizations/10/modules/bogus")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });

    expect(res.status).toBe(404);
  });

  it("rejects enabling a module whose registry status is hidden", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [attendanceHidden];

    const res = await request(app)
      .patch("/api/organizations/10/modules/attendance")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hidden/);
  });

  it("rejects enabling a module whose required module is not enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [recruitment, leaveRequiresRecruitment];
    fixtures.organizationModuleRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/modules/leave")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/recruitment/);
  });

  it("enables a module once its required module is already enabled", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [recruitment, leaveRequiresRecruitment];
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }];

    const res = await request(app)
      .patch("/api/organizations/10/modules/leave")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it("rejects disabling a module still required by another enabled module", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [recruitment, leaveRequiresRecruitment];
    fixtures.organizationModuleRows = [
      { id: 1, organizationId: 10, moduleId: 1, enabled: true },
      { id: 2, organizationId: 10, moduleId: 3, enabled: true },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/modules/recruitment")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leave/);
  });

  it("disables a module with no dependents", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["module.manage"]);
    fixtures.moduleRows = [recruitment];
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }];

    const res = await request(app)
      .patch("/api/organizations/10/modules/recruitment")
      .set("Authorization", "Bearer valid-token")
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });
});

describe("GET /api/master-data/domains", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/master-data/domains");
    expect(res.status).toBe(401);
  });

  it("returns the domain registry for any authenticated user, not org-scoped", async () => {
    mockSession();
    fixtures.masterDataDomainRows = [{ id: 1, key: "gender", label: "Gender", classification: "system-defined" }];

    const res = await request(app).get("/api/master-data/domains").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: "gender", label: "Gender", classification: "system-defined" }]);
  });
});

describe("GET /api/organizations/:organizationId/master-data/:domain", () => {
  it("returns 403 without organization.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app)
      .get("/api/organizations/10/master-data/gender")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown domain", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);

    const res = await request(app)
      .get("/api/organizations/10/master-data/bogus")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("merges system items with this organization's own items, and excludes another organization's items", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.masterDataDomainRows = [{ id: 1, key: "gender", label: "Gender", classification: "system-defined" }];
    fixtures.masterDataItemRows = [
      { id: 1, domain: "gender", organizationId: null, code: "male", label: "Male", sortOrder: 2, status: "active" },
      { id: 2, domain: "gender", organizationId: 10, code: "nonbinary", label: "Non-binary", sortOrder: 1, status: "active" },
      { id: 3, domain: "gender", organizationId: 99, code: "other-org", label: "Other Org Item", sortOrder: 0, status: "active" },
    ];

    const res = await request(app)
      .get("/api/organizations/10/master-data/gender")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.map((i: { code: string }) => i.code)).toEqual(["nonbinary", "male"]);
  });
});

describe("POST /api/organizations/:organizationId/master-data/:domain", () => {
  it("returns 403 without master_data.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);

    const res = await request(app)
      .post("/api/organizations/10/master-data/employment_type")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "contractor", label: "Contractor" });

    expect(res.status).toBe(403);
  });

  it("rejects adding an item to a system-defined domain", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["master_data.manage"]);
    fixtures.masterDataDomainRows = [{ id: 1, key: "gender", label: "Gender", classification: "system-defined" }];

    const res = await request(app)
      .post("/api/organizations/10/master-data/gender")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "custom", label: "Custom" });

    expect(res.status).toBe(400);
  });

  it("creates an organization item for an overridable domain", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["master_data.manage"]);
    fixtures.masterDataDomainRows = [
      { id: 2, key: "employment_type", label: "Employment Type", classification: "organization-overridable" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/master-data/employment_type")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "contractor", label: "Contractor" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe("contractor");
    expect(res.body.organizationId).toBe(10);
  });

  it("returns 409 when the code already exists for this organization and domain", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["master_data.manage"]);
    fixtures.masterDataDomainRows = [
      { id: 2, key: "employment_type", label: "Employment Type", classification: "organization-overridable" },
    ];
    fixtures.masterDataItemRows = [
      { id: 1, domain: "employment_type", organizationId: 10, code: "contractor", label: "Contractor", sortOrder: 0, status: "active" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/master-data/employment_type")
      .set("Authorization", "Bearer valid-token")
      .send({ code: "contractor", label: "Contractor Again" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/organizations/:organizationId/roles", () => {
  it("returns 403 without membership.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app).get("/api/organizations/10/roles").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  // WWM Employee Access Remediation (2026-09-07): organization.read (held by
  // every employee) no longer unlocks the role/permission catalogue.
  it("returns 403 to an ordinary employee holding organization.read but not membership.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read", "employee.read"]);
    fixtures.roleRows = [{ id: 1, key: "org_admin", label: "Organization Admin", isSystemRole: true, organizationId: null }];

    const res = await request(app).get("/api/organizations/10/roles").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("org_admin");
  });

  it("merges system templates with this organization's own roles, excluding another organization's", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["membership.read"]);
    fixtures.roleRows = [
      { id: 1, key: "org_admin", label: "Organization Admin", isSystemRole: true, organizationId: null },
      { id: 2, key: "hr_manager_custom", label: "Custom HR Manager", isSystemRole: false, organizationId: 10 },
      { id: 3, key: "other_org_role", label: "Other Org Role", isSystemRole: false, organizationId: 99 },
    ];

    const res = await request(app).get("/api/organizations/10/roles").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.map((r: { key: string }) => r.key).sort()).toEqual(["hr_manager_custom", "org_admin"]);
  });
});

describe("POST /api/organizations/:organizationId/roles", () => {
  it("returns 403 without role.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.roleRows = [{ id: 1, key: "hr", label: "HR", isSystemRole: true, organizationId: null }];

    const res = await request(app)
      .post("/api/organizations/10/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ templateRoleId: 1, key: "hr_manager_custom", label: "Custom HR Manager" });

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown template", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [];

    const res = await request(app)
      .post("/api/organizations/10/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ templateRoleId: 999, key: "custom", label: "Custom" });

    expect(res.status).toBe(404);
  });

  it("copies the template's permissions into the new organization role", async () => {
    mockSession();
    mockActiveMembership();
    // Caller's own grant uses roleId 99 so it doesn't collide with the
    // template role (id 1) whose permission rows this test also seeds.
    mockPermissions(["role.manage"], 5, 99);
    fixtures.roleRows = [{ id: 1, key: "hr", label: "HR", isSystemRole: true, organizationId: null }];
    fixtures.permissionRows.push(
      { roleId: 1, key: "employee.read" },
      { roleId: 1, key: "employee.write" },
    );
    fixtures.permissionCatalogRows = [
      { id: 10, key: "employee.read" },
      { id: 11, key: "employee.write" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ templateRoleId: 1, key: "hr_manager_custom", label: "Custom HR Manager" });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(10);
    expect(res.body.isSystemRole).toBe(false);
    const copiedPermissions = fixtures.inserted.filter(
      (i) => i.table === "role_permissions" && (i.values as { roleId: number }).roleId === res.body.id,
    );
    expect(copiedPermissions).toHaveLength(2);
  });

  it("returns 409 when the key is already used in the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [
      { id: 1, key: "hr", label: "HR", isSystemRole: true, organizationId: null },
      { id: 2, key: "taken", label: "Taken", isSystemRole: false, organizationId: 10 },
    ];

    const res = await request(app)
      .post("/api/organizations/10/roles")
      .set("Authorization", "Bearer valid-token")
      .send({ templateRoleId: 1, key: "taken", label: "Taken Again" });

    expect(res.status).toBe(409);
  });
});

describe("POST/DELETE .../roles/:roleId/permissions", () => {
  it("rejects granting a permission to a system role template", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [{ id: 1, key: "hr", label: "HR", isSystemRole: true, organizationId: null }];

    const res = await request(app)
      .post("/api/organizations/10/roles/1/permissions")
      .set("Authorization", "Bearer valid-token")
      .send({ permissionId: 10 });

    expect(res.status).toBe(400);
  });

  it("grants a permission to the organization's own role", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [{ id: 2, key: "custom", label: "Custom", isSystemRole: false, organizationId: 10 }];
    fixtures.permissionCatalogRows = [{ id: 10, key: "employee.read" }];

    const res = await request(app)
      .post("/api/organizations/10/roles/2/permissions")
      .set("Authorization", "Bearer valid-token")
      .send({ permissionId: 10 });

    expect(res.status).toBe(204);
  });

  it("rejects revoking a permission from a system role template", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [{ id: 1, key: "hr", label: "HR", isSystemRole: true, organizationId: null }];

    const res = await request(app)
      .delete("/api/organizations/10/roles/1/permissions/10")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(400);
  });

  it("revokes a permission from the organization's own role", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["role.manage"]);
    fixtures.roleRows = [{ id: 2, key: "custom", label: "Custom", isSystemRole: false, organizationId: 10 }];

    const res = await request(app)
      .delete("/api/organizations/10/roles/2/permissions/10")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(204);
  });
});

describe("GET/POST /api/organizations/:organizationId/primary-hr", () => {
  it("returns 403 without primary_hr.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app)
      .get("/api/organizations/10/primary-hr")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns null when no Primary HR is set", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["primary_hr.manage"]);
    fixtures.primaryHrRows = [];

    const res = await request(app)
      .get("/api/organizations/10/primary-hr")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("rejects appointing a membership from a different organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["primary_hr.manage"]);
    // Only the caller's own membership (org 10) exists in the fixture rows —
    // membershipId 77 (claimed to be org 10) simply isn't among them.

    const res = await request(app)
      .post("/api/organizations/10/primary-hr")
      .set("Authorization", "Bearer valid-token")
      .send({ membershipId: 77 });

    expect(res.status).toBe(400);
  });

  it("appoints Primary HR when the target membership belongs to the organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["primary_hr.manage"]);
    fixtures.membershipRows.push({ id: 6, applicationUserId: 2, organizationId: 10, status: "active" });

    const res = await request(app)
      .post("/api/organizations/10/primary-hr")
      .set("Authorization", "Bearer valid-token")
      .send({ membershipId: 6 });

    expect(res.status).toBe(200);
    expect(res.body.membershipId).toBe(6);
  });
});

describe("GET/PATCH /api/organizations/:organizationId/config/:namespace", () => {
  it("returns 403 without organization.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app)
      .get("/api/organizations/10/config/general")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 for a namespace the Configuration Engine doesn't know", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);

    const res = await request(app)
      .get("/api/organizations/10/config/bogus")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("returns safe defaults, without creating a row, when nothing has been saved yet", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.settingsRows = [];

    const res = await request(app)
      .get("/api/organizations/10/config/terminology")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.namespace).toBe("terminology");
    expect(res.body.data.employeeLabel).toBe("Employee");
    expect(res.body.updatedAt).toBeNull();
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("reads a legacy row (no namespace column set at write time) as the general namespace", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.settingsRows = [
      { id: 1, organizationId: 10, namespace: "general", schemaVersion: 1, settings: { theme: "dark" } },
    ];

    const res = await request(app)
      .get("/api/organizations/10/config/general")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ theme: "dark" });
  });

  it("rejects updates without organization.update", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);

    const res = await request(app)
      .patch("/api/organizations/10/config/general")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { theme: "dark" } });

    expect(res.status).toBe(403);
  });

  // Tenant identity hardening (Phase 6): feature flags / controlled extensions
  // are a platform-managed namespace — readable by the organization, never
  // writable through its own config route, even with organization.update.
  it("lets the organization read its feature_flags namespace (default: nothing enabled)", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.settingsRows = [];

    const res = await request(app)
      .get("/api/organizations/10/config/feature_flags")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ flags: {} });
  });

  it("refuses self-service writes to the platform-managed feature_flags namespace", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    fixtures.settingsRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/config/feature_flags")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { flags: { "anything.at_all": true } } });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/managed by the platform/);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("rejects a merged config that fails the namespace's schema", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    fixtures.settingsRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/config/general")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { contactEmail: "not-an-email" } });

    expect(res.status).toBe(400);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("merges the patch into existing data and persists the namespace's current schema version", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    fixtures.settingsRows = [
      { id: 1, organizationId: 10, namespace: "terminology", schemaVersion: 1, settings: { employeeLabel: "Worker" } },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/config/terminology")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { branchLabel: "Site" } });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ employeeLabel: "Worker", branchLabel: "Site" });
    expect(res.body.schemaVersion).toBe(1);
  });

  // W38 — Attendance Configuration. Reuses this same config engine/route;
  // "attendance" is the only namespace gated behind a module (general and
  // terminology predate Module Management and stay ungated, per the tests
  // above).
  function mockAttendanceModuleEnabled(enabled: boolean) {
    fixtures.moduleRows = [
      { id: 1, key: "attendance", status: "hidden", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
    ];
    fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }] : [];
  }

  it("returns 403 for the attendance namespace when the attendance module is disabled, even with organization.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    mockAttendanceModuleEnabled(false);

    const res = await request(app)
      .get("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("does not require any module for the general namespace even when no module rows exist", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];

    const res = await request(app)
      .get("/api/organizations/10/config/general")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("returns attendance defaults when the module is enabled and nothing has been saved yet", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.read"]);
    mockAttendanceModuleEnabled(true);
    fixtures.settingsRows = [];

    const res = await request(app)
      .get("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      workStartTime: "09:00",
      workEndTime: "17:00",
      gracePeriodMinutes: 0,
      workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    });
  });

  it("rejects an attendance update when the module is disabled, even with organization.update", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    mockAttendanceModuleEnabled(false);

    const res = await request(app)
      .patch("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { gracePeriodMinutes: 10 } });

    expect(res.status).toBe(403);
  });

  it("rejects an attendance update where workStartTime is not earlier than workEndTime", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    mockAttendanceModuleEnabled(true);
    fixtures.settingsRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { workStartTime: "17:00", workEndTime: "09:00" } });

    expect(res.status).toBe(400);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("rejects an attendance update with a malformed time", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    mockAttendanceModuleEnabled(true);
    fixtures.settingsRows = [];

    const res = await request(app)
      .patch("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { workStartTime: "9:00" } });

    expect(res.status).toBe(400);
  });

  it("persists a valid attendance update, merged with existing saved data", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["organization.update"]);
    mockAttendanceModuleEnabled(true);
    fixtures.settingsRows = [
      {
        id: 1,
        organizationId: 10,
        namespace: "attendance",
        schemaVersion: 1,
        settings: {
          workStartTime: "09:00",
          workEndTime: "17:00",
          gracePeriodMinutes: 0,
          workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
      },
    ];

    const res = await request(app)
      .patch("/api/organizations/10/config/attendance")
      .set("Authorization", "Bearer valid-token")
      .send({ data: { gracePeriodMinutes: 15, workDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] } });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      workStartTime: "09:00",
      workEndTime: "17:00",
      gracePeriodMinutes: 15,
      workDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    });
  });
});

describe("GET /api/organizations/:organizationId/audit-events", () => {
  it("returns 403 without audit.read", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions([]);

    const res = await request(app)
      .get("/api/organizations/10/audit-events")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns a paginated list when authorized", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { id: 1, organizationId: 10, eventType: "organization.onboarded", targetType: "organization", occurredAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.page).toBe(1);
  });

  it("includes beforeState/afterState/metadata in the response", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      {
        id: 1,
        organizationId: 10,
        eventType: "employee.separated",
        targetType: "employee",
        targetId: "42",
        occurredAt: new Date(),
        beforeState: { employmentStatus: "active" },
        afterState: { employmentStatus: "terminated" },
        metadata: { note: "reorg" },
      },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items[0].beforeState).toEqual({ employmentStatus: "active" });
    expect(res.body.items[0].afterState).toEqual({ employmentStatus: "terminated" });
  });

  it("filters by eventType", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { id: 1, organizationId: 10, eventType: "employee.separated", targetType: "employee", occurredAt: new Date() },
      { id: 2, organizationId: 10, eventType: "employee.rehired", targetType: "employee", occurredAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events?eventType=employee.rehired")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(2);
  });

  it("filters by targetType and targetId", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { id: 1, organizationId: 10, eventType: "employee.separated", targetType: "employee", targetId: "42", occurredAt: new Date() },
      { id: 2, organizationId: 10, eventType: "branch.archived", targetType: "branch", targetId: "7", occurredAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events?targetType=employee&targetId=42")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(1);
  });

  it("filters by actorApplicationUserId", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { id: 1, organizationId: 10, eventType: "employee.separated", targetType: "employee", actorApplicationUserId: 5, occurredAt: new Date() },
      { id: 2, organizationId: 10, eventType: "employee.rehired", targetType: "employee", actorApplicationUserId: 9, occurredAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events?actorApplicationUserId=9")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(2);
  });

  it("never returns another organization's audit events regardless of filters", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["audit.read"]);
    fixtures.auditRows = [
      { id: 1, organizationId: 10, eventType: "employee.separated", targetType: "employee", occurredAt: new Date() },
      { id: 2, organizationId: 99, eventType: "employee.separated", targetType: "employee", occurredAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/organizations/10/audit-events?eventType=employee.separated")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(1);
  });
});
