/**
 * Integration tests for POST/GET/DELETE /me/employee/profile-picture
 * (self-service profile picture — reuses the exact HR-administrator
 * validation/processing pipeline from lib/employeeProfilePicture.ts, but
 * identity is always server-resolved from the caller's own employee-user
 * link, mirroring GET /me/employee's own precedent, tested in
 * meEmployee.test.ts). @workspace/db is mocked with real field-based
 * filtering; ../lib/fileStorage is mocked — no real database or disk I/O.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  branchesTable,
  positionsTable,
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
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
      audits: [] as Record<string, unknown>[],
    },
    auditEventsTable: mockTable("audit_events", ["id"]),
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
      "expiresAt",
    ]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", [
      "id",
      "organizationId",
      "departmentId",
      "branchId",
      "positionId",
      "reportingManagerId",
      "profilePictureKey",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentsTable: mockTable("departments", ["id", "name"]),
    branchesTable: mockTable("branches", ["id", "name"]),
    positionsTable: mockTable("positions", ["id", "title"]),
  };
});

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  auditEventsTable,
  db: {
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.audits.push(v);
        return Promise.resolve();
      },
    }),
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

        const unfiltered =
          table === modulesTable ? fixtures.moduleRows : table === organizationModulesTable ? fixtures.organizationModuleRows : undefined;
        if (unfiltered !== undefined) {
          const rows = unfiltered as unknown[];
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
        else if (table === employeesTable) rows = fixtures.employeeRows;
        else if (table === employeeUserLinksTable) rows = fixtures.employeeUserLinkRows;
        else if (table === departmentsTable) rows = fixtures.departmentRows;
        else if (table === branchesTable) rows = fixtures.branchRows;
        else if (table === positionsTable) rows = fixtures.positionRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              if (table !== employeesTable) return Promise.resolve([]);
              fixtures.employeeRows = fixtures.employeeRows.map((row) =>
                matches(row, cond) ? { ...row, ...v } : row,
              );
              return Promise.resolve(fixtures.employeeRows.filter((row) => matches(row, cond)));
            },
          };
        },
      }),
    }),
  },
}));

vi.mock("../lib/fileStorage", () => ({
  writeOrgFile: vi.fn(async () => "avatars/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"),
  readOrgFile: vi.fn(async (_orgId: number, key: string) => {
    if (key === "avatars/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg") {
      return Buffer.from("fake-jpeg-bytes");
    }
    throw new Error("not found");
  }),
  deleteOrgFile: vi.fn(async () => undefined),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const EMPLOYEE_ID = 42;
const REAL_TOKEN = "valid-token";

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: REAL_TOKEN, userId, expiresAt: new Date(Date.now() + 100000), activeOrganizationId: ORG_ID },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership() {
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId: ORG_ID, status: "active", expiresAt: null }];
}

function mockEssModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [
    { id: 1, key: "employee_self_service", status: "hidden", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
  ];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function mockLinkedEmployee(profilePictureKey: string | null = null) {
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
  fixtures.employeeRows = [
    {
      id: EMPLOYEE_ID,
      organizationId: ORG_ID,
      employeeNumber: "EMP-0001",
      profilePictureKey,
      firstName: "Ada",
      middleName: null,
      lastName: "Lovelace",
      preferredName: null,
      gender: "female",
      dateOfBirth: null,
      maritalStatus: null,
      nationality: "British",
      nationalId: "SECRET",
      passportNumber: "SECRET",
      personalEmail: null,
      workEmail: "ada@work.example.com",
      phoneNumber: null,
      alternatePhoneNumber: null,
      residentialAddress: null,
      emergencyContacts: null,
      departmentId: null,
      branchId: null,
      positionId: null,
      reportingManagerId: null,
      employmentType: "full_time",
      hireDate: null,
      probationEndDate: null,
      employmentStatus: "active",
      workLocation: null,
      separationDate: null,
      separationReason: null,
      notes: null,
      createdBy: 99,
      updatedBy: 99,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.departmentRows = [];
  fixtures.branchRows = [];
  fixtures.positionRows = [];
  fixtures.audits = [];
  mockSession();
  mockActiveMembership();
  mockEssModuleEnabled(true);
});

describe("POST /api/me/employee/profile-picture", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .attach("file", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), "photo.png");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no linked employee record — never accepts a client-supplied employee id", async () => {
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [];
    const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", pngBytes, { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(403);
  });

  it("returns 403 when the employee_self_service module is disabled", async () => {
    mockEssModuleEnabled(false);
    mockLinkedEmployee();
    const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", pngBytes, { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(403);
  });

  it("400s for a file whose content does not match an allowed image type", async () => {
    mockLinkedEmployee();

    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", Buffer.from("not an image"), { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(400);
  });

  it("sets the caller's own profile picture and returns the updated self-service profile", async () => {
    mockLinkedEmployee();
    const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", pngBytes, { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.employee.id).toBe(EMPLOYEE_ID);
    expect(res.body.employee.hasProfilePicture).toBe(true);
  });

  it("audits the change — actor, employee and path only, never the image, key or URL", async () => {
    mockLinkedEmployee("avatars/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg");
    const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", pngBytes, { filename: "photo.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(fixtures.audits).toHaveLength(1);
    const audit = fixtures.audits[0]!;
    expect(audit).toMatchObject({
      eventType: "employee.profile_picture_updated",
      category: "hr",
      organizationId: ORG_ID,
      actorApplicationUserId: 1,
      actorMembershipId: 5,
      targetType: "employee",
      targetId: String(EMPLOYEE_ID),
      metadata: { via: "self_service", replacedExisting: true },
    });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("avatars/");
    expect(serialized).not.toContain(".jpg");
    expect(serialized).not.toContain("http");
  });

  it("does not audit a rejected upload", async () => {
    mockLinkedEmployee();
    const res = await request(app)
      .post("/api/me/employee/profile-picture")
      .set("Authorization", `Bearer ${REAL_TOKEN}`)
      .attach("file", Buffer.from("not an image"), { filename: "photo.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(fixtures.audits).toHaveLength(0);
  });
});

describe("GET /api/me/employee/profile-picture", () => {
  it("returns 404 when the caller has no picture", async () => {
    mockLinkedEmployee(null);
    const res = await request(app).get("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the caller has no linked employee — never leaks another employee's picture", async () => {
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [];
    const res = await request(app).get("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("streams the caller's own picture bytes", async () => {
    mockLinkedEmployee("avatars/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg");
    const res = await request(app).get("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });
});

describe("DELETE /api/me/employee/profile-picture", () => {
  it("returns 403 when the caller has no linked employee record", async () => {
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [];
    const res = await request(app).delete("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it("clears the caller's own profile picture", async () => {
    mockLinkedEmployee("avatars/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg");
    const res = await request(app).delete("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.employee.hasProfilePicture).toBe(false);
    expect(fixtures.audits).toHaveLength(1);
    expect(fixtures.audits[0]).toMatchObject({
      eventType: "employee.profile_picture_removed",
      category: "hr",
      organizationId: ORG_ID,
      actorApplicationUserId: 1,
      actorMembershipId: 5,
      targetId: String(EMPLOYEE_ID),
      metadata: { via: "self_service" },
    });
    expect(JSON.stringify(fixtures.audits[0])).not.toContain("avatars/");
  });

  it("does not audit a removal when there was no picture to remove", async () => {
    mockLinkedEmployee(null);
    const res = await request(app).delete("/api/me/employee/profile-picture").set("Authorization", `Bearer ${REAL_TOKEN}`);
    expect(res.status).toBe(200);
    expect(fixtures.audits).toHaveLength(0);
  });
});
