/**
 * Tests for Public Holiday Management (Phase 2B, W37), exercising the real
 * requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. @workspace/db is mocked with real field-based
 * filtering (mirrors leaveCalendar.test.ts/leaveApprovals.test.ts's
 * mockTable/Cond/matches pattern) since tenant-isolation and by-id lookups
 * need genuine filtering against a multi-row fixture. Recurring-holiday
 * year expansion (including the Feb 29 fallback) is exercised by calling
 * `listHolidayOccurrencesInRange` directly, since it's pure date arithmetic
 * that doesn't need HTTP. No real database connection is made.
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
  modulesTable,
  organizationModulesTable,
  publicHolidaysTable,
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
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      publicHolidayRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    publicHolidaysTable: mockTable("public_holidays", [
      "id",
      "organizationId",
      "name",
      "date",
      "scope",
      "recurring",
      "observedDate",
      "effectiveYear",
      "description",
      "status",
    ]),
    auditEventsTable: mockTable("audit_events", []),
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

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === publicHolidaysTable) return fixtures.publicHolidayRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === organizationModulesTable) fixtures.organizationModuleRows = rows;
  else if (table === publicHolidaysTable) fixtures.publicHolidayRows = rows;
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
  publicHolidaysTable,
  auditEventsTable,
  db: {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const sessionBuilder = {
            innerJoin: () => sessionBuilder,
            where: () => sessionBuilder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return sessionBuilder;
        }

        const unfiltered =
          table === organizationMembershipsTable
            ? fixtures.membershipRows
            : table === membershipRolesTable
              ? fixtures.membershipRoleRows
              : table === rolePermissionsTable
                ? fixtures.permissionRows
                : table === modulesTable
                  ? fixtures.moduleRows
                  : undefined;
        if (unfiltered !== undefined) {
          const rows = unfiltered as unknown[];
          const passthroughBuilder = {
            innerJoin: () => passthroughBuilder,
            where: () => passthroughBuilder,
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return passthroughBuilder;
        }

        const rows = getRowsFor(table);
        const project = (r: Record<string, unknown>) => (proj ? Object.fromEntries(Object.keys(proj).map((k) => [k, r[k]])) : r);
        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n).map(project)),
          orderBy: () => Promise.resolve(filtered.map(project)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered.map(project)).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        if (table === publicHolidaysTable) {
          const duplicate = fixtures.publicHolidayRows.some(
            (r) => r.organizationId === v.organizationId && r.date === v.date && r.name === v.name,
          );
          if (duplicate) return { returning: () => Promise.reject({ code: "23505" }) };
        }
        const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), status: "active", ...v };
        if (table === publicHolidaysTable) fixtures.publicHolidayRows = [...fixtures.publicHolidayRows, row];
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              const rows = getRowsFor(table);
              const idx = rows.findIndex((r) => matches(r, cond));
              if (idx === -1) return Promise.resolve([]);
              const updated = { ...rows[idx], ...v };
              setRowsFor(
                table,
                rows.map((r, i) => (i === idx ? updated : r)),
              );
              return Promise.resolve([updated]);
            },
          };
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where(cond: Cond) {
        const rows = getRowsFor(table);
        setRowsFor(table, rows.filter((r) => !matches(r, cond)));
        return Promise.resolve(undefined);
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");
const { listHolidayOccurrencesInRange } = await import("../lib/publicHolidays");

const ORG_ID = 10;
const OTHER_ORG_ID = 99;

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
        organizationId: ORG_ID,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = ORG_ID) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: 1, organizationId, status: "active", expiresAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockLeaveModuleEnabled() {
  fixtures.moduleRows = [{ id: 1, key: "leave", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  fixtures.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.publicHolidayRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockLeaveModuleEnabled();
  mockPermissions(["public_holiday.read"]);
});

describe("GET /api/organizations/:organizationId/public-holidays", () => {
  it("lists active holidays by default, excluding inactive ones", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "New Year", date: "2030-01-01", scope: "organization", recurring: true, observedDate: null, effectiveYear: null, status: "active" },
      { id: 2, organizationId: ORG_ID, name: "Old Holiday", date: "2029-05-01", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2029, status: "inactive" },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/public-holidays`).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("New Year");
  });

  it("never returns another organization's holidays", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: OTHER_ORG_ID, name: "Foreign Holiday", date: "2030-01-01", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2030, status: "active" },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/public-holidays`).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("returns 403 when the leave module is not enabled", async () => {
    fixtures.organizationModuleRows = [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: false }];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/public-holidays`).set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});

describe("POST /api/organizations/:organizationId/public-holidays", () => {
  it("returns 403 without public_holiday.manage — read access alone is not enough", async () => {
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Founders Day", date: "2030-06-15", recurring: false, effectiveYear: 2030 });

    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller only holds leave_request.approve or leave_type.manage", async () => {
    mockPermissions(["public_holiday.read", "leave_request.approve", "leave_type.manage"]);

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Founders Day", date: "2030-06-15", recurring: false, effectiveYear: 2030 });

    expect(res.status).toBe(403);
  });

  it("creates a one-off holiday and records an audit event", async () => {
    mockPermissions(["public_holiday.read", "public_holiday.manage"]);

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Founders Day", date: "2030-06-15", recurring: false, effectiveYear: 2030 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Founders Day");
    expect(res.body.scope).toBe("organization");
    const auditInsert = fixtures.inserted.find((i) => i.table === "audit_events");
    expect((auditInsert!.values as Record<string, unknown>).eventType).toBe("public_holiday.created");
  });

  it("returns 400 when a recurring holiday sets effectiveYear", async () => {
    mockPermissions(["public_holiday.read", "public_holiday.manage"]);

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Christmas", date: "2030-12-25", recurring: true, effectiveYear: 2030 });

    expect(res.status).toBe(400);
  });

  it("returns 400 when a one-off holiday omits effectiveYear", async () => {
    mockPermissions(["public_holiday.read", "public_holiday.manage"]);

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Founders Day", date: "2030-06-15", recurring: false });

    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate holiday (same organization, date, and name)", async () => {
    mockPermissions(["public_holiday.read", "public_holiday.manage"]);
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "Founders Day", date: "2030-06-15", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2030, status: "active" },
    ];

    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays`)
      .set("Authorization", "Bearer valid-token")
      .send({ name: "Founders Day", date: "2030-06-15", recurring: false, effectiveYear: 2030 });

    expect(res.status).toBe(409);
  });
});

describe("PATCH/DELETE/deactivate/reactivate /api/organizations/:organizationId/public-holidays/:id", () => {
  beforeEach(() => {
    mockPermissions(["public_holiday.read", "public_holiday.manage"]);
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "Founders Day", date: "2030-06-15", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2030, status: "active" },
      { id: 2, organizationId: OTHER_ORG_ID, name: "Foreign Holiday", date: "2030-07-01", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2030, status: "active" },
    ];
  });

  it("updates a holiday belonging to the caller's organization", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/public-holidays/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ description: "Local founding celebration" });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Local founding celebration");
  });

  it("returns 404 for a holiday belonging to another organization (tenant isolation)", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/public-holidays/2`)
      .set("Authorization", "Bearer valid-token")
      .send({ description: "Should not apply" });

    expect(res.status).toBe(404);
  });

  it("deactivates then reactivates a holiday", async () => {
    const deactivated = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays/1/deactivate`)
      .set("Authorization", "Bearer valid-token");
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("inactive");

    const reactivated = await request(app)
      .post(`/api/organizations/${ORG_ID}/public-holidays/1/reactivate`)
      .set("Authorization", "Bearer valid-token");
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe("active");
  });

  it("deletes a holiday, and it no longer appears in the list", async () => {
    const res = await request(app).delete(`/api/organizations/${ORG_ID}/public-holidays/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);

    const listRes = await request(app).get(`/api/organizations/${ORG_ID}/public-holidays`).set("Authorization", "Bearer valid-token");
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 deleting a holiday belonging to another organization", async () => {
    const res = await request(app).delete(`/api/organizations/${ORG_ID}/public-holidays/2`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("listHolidayOccurrencesInRange (recurring expansion, direct)", () => {
  it("expands a recurring holiday for every overlapping year", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "New Year", date: "2020-01-01", scope: "organization", recurring: true, observedDate: null, effectiveYear: null, status: "active" },
    ];

    const occurrences = await listHolidayOccurrencesInRange(ORG_ID, "2030-01-01", "2031-12-31");

    expect(occurrences).toEqual([
      { id: 1, name: "New Year", date: "2030-01-01" },
      { id: 1, name: "New Year", date: "2031-01-01" },
    ]);
  });

  it("falls back Feb 29 to Feb 28 in a non-leap year, and keeps Feb 29 in a leap year", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "Leap Day Holiday", date: "2020-02-29", scope: "organization", recurring: true, observedDate: null, effectiveYear: null, status: "active" },
    ];

    const nonLeap = await listHolidayOccurrencesInRange(ORG_ID, "2030-01-01", "2030-12-31");
    expect(nonLeap).toEqual([{ id: 1, name: "Leap Day Holiday", date: "2030-02-28" }]);

    const leap = await listHolidayOccurrencesInRange(ORG_ID, "2032-01-01", "2032-12-31");
    expect(leap).toEqual([{ id: 1, name: "Leap Day Holiday", date: "2032-02-29" }]);
  });

  it("uses observedDate instead of date for a one-off holiday shifted to a weekday", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "Shifted Holiday", date: "2030-06-15", scope: "organization", recurring: false, observedDate: "2030-06-17", effectiveYear: 2030, status: "active" },
    ];

    const occurrences = await listHolidayOccurrencesInRange(ORG_ID, "2030-06-01", "2030-06-30");

    expect(occurrences).toEqual([{ id: 1, name: "Shifted Holiday", date: "2030-06-17" }]);
  });

  it("excludes inactive holidays", async () => {
    fixtures.publicHolidayRows = [
      { id: 1, organizationId: ORG_ID, name: "Retired", date: "2030-06-15", scope: "organization", recurring: false, observedDate: null, effectiveYear: 2030, status: "inactive" },
    ];

    const occurrences = await listHolidayOccurrencesInRange(ORG_ID, "2030-06-01", "2030-06-30");

    expect(occurrences).toEqual([]);
  });
});
