/**
 * Integration tests for the employee directory routes, exercising the real
 * requireAuth/requireMembership/requirePermission chain and route handlers
 * through supertest. @workspace/db is mocked — no real database connection
 * is made. Covers the security-critical paths: unauthenticated, no active
 * membership (tenant isolation), a role without the required permission,
 * a successful create, and a cross-organization reference being rejected
 * (the same class of bug already found and fixed on GET /organizations/:id).
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
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  employmentPeriodsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  performanceReviewsTable,
  performanceCyclesTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      departmentRows: [] as { organizationId: number }[],
      positionRows: [] as { organizationId: number }[],
      employeeRows: [] as Record<string, unknown>[],
      linkRows: [] as { employeeId: number; applicationUserId: number }[],
      inserted: [] as { table: string; values: unknown }[],
      deleted: [] as { table: string }[],
      idCounters: new Map<string, number>(),
      // Phase 3H, W114 — always empty for this file's tests, which exercises
      // getNamespaceConfig's own "no saved row" default path (the numbering
      // engine's defaults reproduce the pre-W114 hardcoded EMP-0001 format
      // byte-for-byte, so the pre-existing test assertion needs no change).
      organizationSettingsRows: [] as Record<string, unknown>[],
      numberingSequenceRows: [] as Record<string, unknown>[],
      employeeNumberAllocationRows: [] as Record<string, unknown>[],
      // Phase 3H, W117 — flat, pre-joined rows: this mock's innerJoin() is a
      // no-op passthrough (see the from() builder below), so a row must
      // already carry both employeeId and cycleType for confirmEmployee's
      // probationReviewId validation query to see the shape it expects.
      performanceReviewRows: [] as Record<string, unknown>[],
    },
    usersTable: { __name: "users" },
    sessionsTable: { __name: "sessions" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    membershipRolesTable: { __name: "membership_roles" },
    rolesTable: { __name: "roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
    employeesTable: { __name: "employees" },
    departmentsTable: { __name: "departments" },
    branchesTable: { __name: "branches" },
    positionsTable: { __name: "positions" },
    employeeUserLinksTable: { __name: "employee_user_links" },
    auditEventsTable: { __name: "audit_events" },
    employmentPeriodsTable: { __name: "employment_periods" },
    organizationSettingsTable: { __name: "organization_settings" },
    numberingSequencesTable: { __name: "numbering_sequences" },
    employeeNumberAllocationsTable: { __name: "employee_number_allocations" },
    performanceReviewsTable: { __name: "performance_reviews" },
    performanceCyclesTable: { __name: "performance_cycles" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

const dbMock: Record<string, unknown> = {
  select: () => ({
    from(table: { __name: string }) {
      let rows: unknown[] = [];
      if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
      else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows;
      else if (table === rolePermissionsTable) rows = fixtures.permissionRows;
      else if (table === departmentsTable) rows = fixtures.departmentRows;
      else if (table === positionsTable) rows = fixtures.positionRows;
      else if (table === employeesTable) rows = fixtures.employeeRows;
      else if (table === employeeUserLinksTable) rows = fixtures.linkRows;
      else if (table === organizationSettingsTable) rows = fixtures.organizationSettingsRows;
      else if (table === numberingSequencesTable) rows = fixtures.numberingSequenceRows;
      else if (table === employeeNumberAllocationsTable) rows = fixtures.employeeNumberAllocationRows;
      else if (table === performanceReviewsTable) rows = fixtures.performanceReviewRows;
      else if (table === performanceCyclesTable) rows = fixtures.performanceReviewRows;
      else rows = fixtures.sessionRows;

      const builder = {
        innerJoin: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(rows),
        orderBy: () => builder,
        offset: () => Promise.resolve(rows),
        for: () => builder,
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return builder;
    },
  }),
  insert: (table: { __name: string }) => ({
    values: (v: Record<string, unknown>) => {
      fixtures.inserted.push({ table: table.__name, values: v });
      const row = { id: nextId(table), ...v };
      // Phase 3H, W114: unlike the flat `inserted` log above (assertion-only),
      // employeesTable/numbering tables' own per-table fixture arrays must
      // actually reflect the insert — createEmployee's new transactional flow
      // immediately re-selects (`.for("update")`) the just-inserted employee
      // row and appends to the allocation-history table, which the older,
      // simpler mock this file previously used never needed to support.
      if (table === employeesTable) fixtures.employeeRows = [row];
      else if (table === numberingSequencesTable) fixtures.numberingSequenceRows = [...fixtures.numberingSequenceRows, row];
      else if (table === employeeNumberAllocationsTable) fixtures.employeeNumberAllocationRows = [...fixtures.employeeNumberAllocationRows, row];
      const result = { returning: () => Promise.resolve([row]) };
      // The numbering helper's first-allocation insert chains
      // .onConflictDoNothing() — a plain passthrough here, as in
      // employeeNumbering.test.ts (real conflict behavior is proved live in
      // numberingSequencesLive.test.ts).
      return { ...result, onConflictDoNothing: () => result };
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
        if (table === employeesTable) {
          const current = (fixtures.employeeRows[0] as Record<string, unknown>) ?? {};
          const updated = { ...current, ...v };
          fixtures.employeeRows = [updated];
          return { returning: () => Promise.resolve([updated]) };
        }
        if (table === numberingSequencesTable) {
          const current = (fixtures.numberingSequenceRows[0] as Record<string, unknown>) ?? {};
          const updated = { ...current, ...v };
          fixtures.numberingSequenceRows = [updated];
          return { returning: () => Promise.resolve([updated]) };
        }
        if (table === employeeNumberAllocationsTable) {
          const current = (fixtures.employeeNumberAllocationRows[0] as Record<string, unknown>) ?? {};
          const updated = { ...current, ...v };
          fixtures.employeeNumberAllocationRows = [updated];
          return { returning: () => Promise.resolve([updated]) };
        }
        return { returning: () => Promise.resolve([]) };
      },
    }),
  }),
  // Phase 3H, W114: numbering.ts's allocation functions call
  // `client.transaction(...)` (nested savepoints in real Postgres) — this
  // mock just invokes the callback with the same client, matching
  // learningEnrollments.test.ts's own established "no real transaction
  // semantics needed here; real atomicity is verified in live QA" precedent.
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock),
};

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  employmentPeriodsTable,
  organizationSettingsTable,
  numberingSequencesTable,
  employeeNumberAllocationsTable,
  performanceReviewsTable,
  performanceCyclesTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  gt: () => "gt",
  ilike: () => "ilike",
  inArray: () => "inArray",
  desc: () => "desc",
  count: () => "count",
}));

const { default: app } = await import("../app");

function mockSession(user: { id: number }) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: user.id, expiresAt: new Date(Date.now() + 100000) },
      user: {
        id: user.id,
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

function mockActiveMembership(membership: { id: number; organizationId: number }) {
  fixtures.membershipRows = [
    {
      id: membership.id,
      applicationUserId: 1,
      organizationId: membership.organizationId,
      status: "active",
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

describe("POST /api/organizations/:organizationId/employees", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.departmentRows = [];
    fixtures.inserted = [];
    fixtures.idCounters = new Map();
  });

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app)
      .post("/api/organizations/10/employees")
      .send({ firstName: "Ada", lastName: "Lovelace" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no active membership in the organization (tenant isolation)", async () => {
    mockSession({ id: 1 });
    fixtures.membershipRows = [];

    const res = await request(app)
      .post("/api/organizations/99/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(403);
    expect(fixtures.inserted).toHaveLength(0);
  });

  it("creates an employee with an auto-generated employee number when authorized", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace" });

    expect(res.status).toBe(201);
    expect(res.body.firstName).toBe("Ada");
    expect(res.body.employeeNumber).toBe("EMP-0001");
    const employeeInsert = fixtures.inserted.find((i) => i.table === "employees");
    expect(employeeInsert).toBeDefined();
    expect((employeeInsert!.values as Record<string, unknown>).organizationId).toBe(10);
  });

  it("rejects a department reference that belongs to a different organization", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.departmentRows = [{ organizationId: 999 }];

    const res = await request(app)
      .post("/api/organizations/10/employees")
      .set("Authorization", "Bearer valid-token")
      .send({ firstName: "Ada", lastName: "Lovelace", departmentId: 3 });

    expect(res.status).toBe(400);
    expect(fixtures.inserted.find((i) => i.table === "employees")).toBeUndefined();
  });
});

describe("GET /api/organizations/:organizationId/employees/:employeeId (link status)", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.linkRows = [];
  });

  it("returns linkedApplicationUserId null when the employee has no link", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [];

    const res = await request(app)
      .get("/api/organizations/10/employees/42")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.linkedApplicationUserId).toBeNull();
  });

  it("returns linkedApplicationUserId when the employee is linked", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .get("/api/organizations/10/employees/42")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.linkedApplicationUserId).toBe(7);
  });
});

/**
 * WWM Employee Access Remediation (2026-09-07): employee.read is the
 * directory grant every role holds; a colleague's personal identity fields
 * are withheld unless the caller holds employee.sensitive.read or is
 * reading their own record. Same-tenant privacy, distinct from the
 * cross-tenant 403s above.
 */
describe("GET /api/organizations/:organizationId/employees/:employeeId (sensitive-field redaction)", () => {
  const SENSITIVE_ROW = {
    id: 42,
    organizationId: 10,
    firstName: "Grace",
    lastName: "Mensah",
    employmentStatus: "active",
    gender: "female",
    dateOfBirth: new Date("1990-05-01T00:00:00Z"),
    maritalStatus: "married",
    nationality: "Ghanaian",
    nationalId: "GHA-123456789-0",
    passportNumber: "G1234567",
    personalEmail: "grace.personal@example.com",
    workEmail: "grace@example.org",
    phoneNumber: "+233200000000",
    alternatePhoneNumber: "+233200000001",
    residentialAddress: { line1: "1 Ridge Road", city: "Accra" },
    emergencyContacts: [{ name: "Kwame Mensah", relationship: "spouse", phoneNumber: "+233200000002" }],
    separationReason: "relocation",
    notes: "HR-only note",
  };
  const SENSITIVE_KEYS = [
    "gender",
    "dateOfBirth",
    "maritalStatus",
    "nationality",
    "nationalId",
    "passportNumber",
    "personalEmail",
    // 2026-09-15 owner decision: the field can hold a personal mobile.
    "phoneNumber",
    "alternatePhoneNumber",
    "residentialAddress",
    "emergencyContacts",
    "separationReason",
  ];

  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [{ ...SENSITIVE_ROW }];
    fixtures.linkRows = [];
  });

  it("withholds a colleague's personal identity fields from a directory-only caller (employee.read alone)", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);

    const res = await request(app).get("/api/organizations/10/employees/42").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.sensitiveFieldsRedacted).toBe(true);
    for (const key of SENSITIVE_KEYS) expect(res.body[key], key).toBeNull();
    expect(res.body.notes).toBeNull();
    // Directory identity stays visible — that is what employee.read is for.
    expect(res.body.firstName).toBe("Grace");
    expect(res.body.workEmail).toBe("grace@example.org");
    // phoneNumber is NOT directory data (2026-09-15): withheld like alternatePhoneNumber.
    expect(res.body.phoneNumber).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("+233200000000");
    expect(JSON.stringify(res.body)).not.toContain("GHA-123456789-0");
    expect(JSON.stringify(res.body)).not.toContain("Ridge Road");
  });

  it("reveals the fields to a caller holding employee.sensitive.read (HR)", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read", "employee.sensitive.read"]);

    const res = await request(app).get("/api/organizations/10/employees/42").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.sensitiveFieldsRedacted).toBe(false);
    expect(res.body.nationalId).toBe("GHA-123456789-0");
    expect(res.body.phoneNumber).toBe("+233200000000");
    expect(res.body.dateOfBirth).toBe("1990-05-01T00:00:00.000Z");
    expect(res.body.residentialAddress).toEqual({ line1: "1 Ridge Road", city: "Accra" });
    expect(res.body.emergencyContacts).toHaveLength(1);
    // notes keep their own, separate gate.
    expect(res.body.notes).toBeNull();
  });

  it("reveals the fields on the caller's OWN record without any extra permission (server-resolved link)", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 1 }];

    const res = await request(app).get("/api/organizations/10/employees/42").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.sensitiveFieldsRedacted).toBe(false);
    expect(res.body.nationalId).toBe("GHA-123456789-0");
    expect(res.body.passportNumber).toBe("G1234567");
    expect(res.body.phoneNumber).toBe("+233200000000");
  });

  it("withholds phoneNumber from a department head (canonical employee role) reading a direct report", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions([...ROLE_PERMISSIONS.employee]);
    // Employee 42 sits in department 3 and reports to employee 7 (the
    // department head). Neither relationship is a sensitive-data grant. The
    // caller's own link is left unset: this file's db mock ignores WHERE, so a
    // linked caller would resolve to row 42 itself (the own-record case above).
    fixtures.employeeRows = [{ ...SENSITIVE_ROW, departmentId: 3, reportingManagerId: 7 }];
    fixtures.linkRows = [];

    const res = await request(app).get("/api/organizations/10/employees/42").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.sensitiveFieldsRedacted).toBe(true);
    expect(res.body.phoneNumber).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("+233200000000");
  });

  // The directory listing shares formatEmployee/resolveEmployeeVisibility
  // with the detail route above, so the same redaction applies per row; this
  // file's db mock cannot serve listEmployees' paginated query (limit →
  // offset chain), so the listing is covered by the shared code path rather
  // than a separate supertest case here.
});

describe("DELETE /api/organizations/:organizationId/employees/:employeeId/link-user", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.linkRows = [];
    fixtures.deleted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee is not linked", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("unlinks the employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];
    fixtures.linkRows = [{ employeeId: 42, applicationUserId: 7 }];

    const res = await request(app)
      .delete("/api/organizations/10/employees/42/link-user")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(fixtures.deleted.some((d) => d.table === "employee_user_links")).toBe(true);
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/separate", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("separates an active employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01", separationReason: "resigned" });

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("terminated");
    expect(res.body.separationReason).toBe("resigned");
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });

  it("returns 400 when the employee is already separated", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/separate")
      .set("Authorization", "Bearer valid-token")
      .send({ separationDate: "2026-01-01" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/rehire", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(403);
  });

  it("rehires a separated employee and records an audit event", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [
      // organizationId is required from WS-11 onward: rehire now appends an
      // employment_periods event, and that shared write path asserts the
      // employee belongs to the organization — as transfer/promotion/
      // confirmation already did.
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "terminated", separationDate: new Date(), separationReason: "resigned" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("active");
    expect(res.body.separationDate).toBeNull();
    expect(fixtures.inserted.some((i) => i.table === "audit_events")).toBe(true);
  });

  it("returns 400 when the employee is not currently separated", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/rehire")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/transfer", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.departmentRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", departmentId: 1 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/transfer")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", departmentId: 5 });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/transfer")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", departmentId: 5 });

    expect(res.status).toBe(404);
  });

  it("returns 400 when the transfer would not change department, branch, or position", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", departmentId: 5 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/transfer")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", departmentId: 5 });

    expect(res.status).toBe(400);
  });

  it("rejects a department reference that belongs to a different organization", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", departmentId: 1 }];
    fixtures.departmentRows = [{ organizationId: 999 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/transfer")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", departmentId: 5 });

    expect(res.status).toBe(400);
  });

  it("transfers the employee, records an employment_periods event, and audit-logs it", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", departmentId: 1 },
    ];
    fixtures.departmentRows = [{ organizationId: 10 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/transfer")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", departmentId: 5 });

    expect(res.status).toBe(200);
    expect(res.body.departmentId).toBe(5);
    expect(fixtures.inserted.find((i) => i.table === "employment_periods")).toBeDefined();
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employment_period.transfer");
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/promote", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.positionRows = [];
    fixtures.inserted = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", positionId: 1 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/promote")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", positionId: 9 });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/promote")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", positionId: 9 });

    expect(res.status).toBe(404);
  });

  it("returns 400 when the target position is the employee's current one", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", positionId: 9 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/promote")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", positionId: 9 });

    expect(res.status).toBe(400);
  });

  it("rejects a position reference that belongs to a different organization", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", positionId: 1 }];
    fixtures.positionRows = [{ organizationId: 999 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/promote")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", positionId: 9 });

    expect(res.status).toBe(400);
  });

  it("promotes the employee, records an employment_periods event, and audit-logs it", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active", positionId: 1 },
    ];
    fixtures.positionRows = [{ organizationId: 10 }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/promote")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", positionId: 9 });

    expect(res.status).toBe(200);
    expect(res.body.positionId).toBe(9);
    expect(fixtures.inserted.find((i) => i.table === "employment_periods")).toBeDefined();
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employment_period.promotion");
  });
});

describe("POST /api/organizations/:organizationId/employees/:employeeId/confirm", () => {
  beforeEach(() => {
    fixtures.sessionRows = [];
    fixtures.membershipRows = [];
    fixtures.membershipRoleRows = [];
    fixtures.permissionRows = [];
    fixtures.employeeRows = [];
    fixtures.inserted = [];
    fixtures.performanceReviewRows = [];
  });

  it("returns 403 when the membership's role lacks employee.write", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.read"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the employee does not exist", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when the employee is not currently on probation", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [{ id: 42, firstName: "Ada", lastName: "Lovelace", employmentStatus: "active" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01" });

    expect(res.status).toBe(400);
  });

  it("confirms the employee, records an employment_periods event, and audit-logs it", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write", "employee.notes.read"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("active");
    expect(fixtures.inserted.find((i) => i.table === "employment_periods")).toBeDefined();
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("employment_period.confirmation");
  });

  it("confirms with a valid probationReviewId and records it in the employment_periods newState (Phase 3H, W117)", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];
    fixtures.performanceReviewRows = [{ id: 99, employeeId: 42, organizationId: 10, cycleType: "probation" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", probationReviewId: 99 });

    expect(res.status).toBe(200);
    expect(res.body.employmentStatus).toBe("active");
    const periodInsert = fixtures.inserted.find((i) => i.table === "employment_periods");
    expect((periodInsert!.values as Record<string, unknown>).newState).toEqual({ employmentStatus: "active", probationReviewId: 99 });
  });

  it("returns 400 when probationReviewId does not belong to this employee", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];
    fixtures.performanceReviewRows = [{ id: 99, employeeId: 7, organizationId: 10, cycleType: "probation" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", probationReviewId: 99 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when probationReviewId references a non-probation cycle", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];
    fixtures.performanceReviewRows = [{ id: 99, employeeId: 42, organizationId: 10, cycleType: "annual" }];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", probationReviewId: 99 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when probationReviewId does not exist", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];
    fixtures.performanceReviewRows = [];

    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01", probationReviewId: 99 });

    expect(res.status).toBe(400);
  });

  it("confirmation remains a separate, distinct action from probation-review completion (no auto-confirm)", async () => {
    mockSession({ id: 1 });
    mockActiveMembership({ id: 5, organizationId: 10 });
    mockPermissions(["employee.write"]);
    fixtures.employeeRows = [
      { id: 42, organizationId: 10, firstName: "Ada", lastName: "Lovelace", employmentStatus: "probation" },
    ];
    // No probationReviewId supplied at all — confirmation must still succeed
    // on its own, exactly as it did before W117 (backward compatible).
    const res = await request(app)
      .post("/api/organizations/10/employees/42/confirm")
      .set("Authorization", "Bearer valid-token")
      .send({ effectiveDate: "2026-01-01" });

    expect(res.status).toBe(200);
    const periodInsert = fixtures.inserted.find((i) => i.table === "employment_periods");
    expect((periodInsert!.values as Record<string, unknown>).newState).toEqual({ employmentStatus: "active" });
  });
});
