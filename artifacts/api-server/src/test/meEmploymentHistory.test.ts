/**
 * Integration tests for GET /me/employment-history (Phase 3F, W105 — ESS
 * Career Profile foundation), exercising the real
 * requireAuth/requireModuleEnabled chain through supertest, mirroring
 * meEmployee.test.ts's harness style exactly. @workspace/db is mocked with
 * real field-based filtering — no real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  employmentPeriodsTable,
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
      employmentPeriodRows: [] as Record<string, unknown>[],
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
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", ["id", "organizationId"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    employmentPeriodsTable: mockTable("employment_periods", ["id", "organizationId", "employeeId", "eventType", "effectiveDate"]),
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
  employmentPeriodsTable,
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
        else if (table === employmentPeriodsTable) rows = fixtures.employmentPeriodRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => Promise.resolve(filtered),
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
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

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const EMPLOYEE_ID = 42;

function mockSession(userId = 1, legacyOrganizationId: number | null = ORG_ID, activeOrganizationId: number | null = ORG_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000), activeOrganizationId },
      user: {
        id: userId,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        organizationId: legacyOrganizationId,
        createdAt: new Date(),
      },
    },
  ];
}

function mockActiveMembership(organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: 5, applicationUserId: 1, organizationId, status: "active", expiresAt: null }];
}

function mockEssModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [
    { id: 1, key: "employee_self_service", status: "hidden", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
  ];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function mockLinkedEmployee(organizationId = ORG_ID) {
  fixtures.employeeUserLinkRows = [{ employeeId: EMPLOYEE_ID, applicationUserId: 1 }];
  fixtures.employeeRows = [{ id: EMPLOYEE_ID, organizationId }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.employeeRows = [];
  fixtures.employeeUserLinkRows = [];
  fixtures.employmentPeriodRows = [];
});

describe("GET /api/me/employment-history", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/me/employment-history");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no active organization membership", async () => {
    mockSession(1, null, null);
    fixtures.membershipRows = [];
    mockEssModuleEnabled(true);

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns 403 when the employee_self_service module is disabled", async () => {
    mockSession();
    mockActiveMembership();
    mockEssModuleEnabled(false);
    mockLinkedEmployee();

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("returns linked:false, items:[] for a valid user with no employee link — not a 404 or 500", async () => {
    mockSession();
    mockActiveMembership();
    mockEssModuleEnabled(true);
    fixtures.employeeUserLinkRows = [];
    fixtures.employeeRows = [];

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, items: [] });
  });

  it("returns a valid empty result when linked but no employment_periods rows exist", async () => {
    mockSession();
    mockActiveMembership();
    mockEssModuleEnabled(true);
    mockLinkedEmployee();
    fixtures.employmentPeriodRows = [];

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, items: [] });
  });

  it("resolves only the caller's own employment history when enabled and linked", async () => {
    mockSession();
    mockActiveMembership();
    mockEssModuleEnabled(true);
    mockLinkedEmployee();
    const effectiveDate = new Date("2026-03-01T00:00:00.000Z");
    const createdAt = new Date("2026-03-01T00:05:00.000Z");
    fixtures.employmentPeriodRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        employeeId: EMPLOYEE_ID,
        eventType: "transfer",
        effectiveDate,
        previousState: { departmentId: 1 },
        newState: { departmentId: 2 },
        createdAt,
      },
      // A different employee's row in the same org must never leak through.
      { id: 2, organizationId: ORG_ID, employeeId: 999, eventType: "promotion", effectiveDate, previousState: null, newState: {}, createdAt },
    ];

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: 1, eventType: "transfer", previousState: { departmentId: 1 }, newState: { departmentId: 2 } });
  });

  it("never trusts a client-supplied employeeId — there is no such parameter on this route", async () => {
    mockSession();
    mockActiveMembership();
    mockEssModuleEnabled(true);
    mockLinkedEmployee();
    fixtures.employmentPeriodRows = [
      { id: 1, organizationId: ORG_ID, employeeId: EMPLOYEE_ID, eventType: "transfer", effectiveDate: new Date(), previousState: null, newState: {}, createdAt: new Date() },
      { id: 2, organizationId: ORG_ID, employeeId: 999, eventType: "promotion", effectiveDate: new Date(), previousState: null, newState: {}, createdAt: new Date() },
    ];

    const res = await request(app)
      .get("/api/me/employment-history?employeeId=999")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(1);
  });

  it("does not resolve employment history belonging to a different organization than the caller's active one", async () => {
    mockSession(1, ORG_ID, ORG_ID);
    mockActiveMembership(ORG_ID);
    mockEssModuleEnabled(true);
    // The link points at an employee row that in fact belongs to another
    // organization (e.g. a stale link) — resolveOwnEmployeeId re-verifies
    // via getEmployeeById(organizationId, ...), so this must not leak.
    mockLinkedEmployee(OTHER_ORG_ID);
    fixtures.employmentPeriodRows = [
      { id: 1, organizationId: OTHER_ORG_ID, employeeId: EMPLOYEE_ID, eventType: "transfer", effectiveDate: new Date(), previousState: null, newState: {}, createdAt: new Date() },
    ];

    const res = await request(app).get("/api/me/employment-history").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, items: [] });
  });
});
