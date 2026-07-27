/**
 * Focused tests for requireModuleEnabled (W5, Backend Module Gating).
 * @workspace/db is mocked -- no real database connection. Exercises the
 * middleware through a tiny local Express app (real requireAuth +
 * requireMembership + requireModuleEnabled composed exactly as a future
 * module route would), not the production app -- no gated route exists
 * there yet since every registered module (W3) is still status "hidden".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const { fixtures, usersTable, sessionsTable, organizationMembershipsTable, modulesTable, organizationModulesTable } =
  vi.hoisted(() => {
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
      },
      usersTable: mockTable("users", ["id", "email"]),
      sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
      organizationMembershipsTable: mockTable("organization_memberships", [
        "id",
        "applicationUserId",
        "organizationId",
        "status",
      ]),
      modulesTable: mockTable("modules", ["id", "key", "name", "status", "defaultEnabled", "requiredModuleKeys"]),
      organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    };
  });

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
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
        };
        return builder;
      }

      let rows: Record<string, unknown>[] = [];
      if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
      else if (table === modulesTable) rows = fixtures.moduleRows;
      else if (table === organizationModulesTable) rows = fixtures.organizationModuleRows;

      let filtered = rows;
      const builder = {
        where(cond: Cond) {
          filtered = rows.filter((r) => matches(r, cond));
          return builder;
        },
        limit(n: number) {
          filtered = filtered.slice(0, n);
          return builder;
        },
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(filtered).then(resolve, reject),
      };
      return builder;
    },
  }),
};

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
}));

const { requireAuth } = await import("../middlewares/requireAuth");
const { requireMembership } = await import("../middlewares/requireMembership");
const { requireModuleEnabled } = await import("../middlewares/requireModuleEnabled");

const testApp = express();
testApp.get(
  "/test/organizations/:organizationId/recruitment",
  requireAuth as never,
  requireMembership("organizationId"),
  requireModuleEnabled("recruitment"),
  (_req, res) => {
    res.json({ ok: true });
  },
);

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com" },
    },
  ];
}

function mockActiveMembership(organizationId: number, membershipId = 5) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function seedRecruitmentModule(overrides: Partial<{ defaultEnabled: boolean; requiredModuleKeys: string[] }> = {}) {
  fixtures.moduleRows = [
    {
      id: 1,
      key: "recruitment",
      status: "active",
      defaultEnabled: overrides.defaultEnabled ?? false,
      requiredModuleKeys: overrides.requiredModuleKeys ?? [],
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
});

describe("requireModuleEnabled", () => {
  it("blocks unauthenticated requests with 401", async () => {
    const res = await request(testApp).get("/test/organizations/10/recruitment");
    expect(res.status).toBe(401);
  });

  it("blocks callers with no membership in the target organization with 403", async () => {
    mockSession();
    seedRecruitmentModule({ defaultEnabled: true });

    const res = await request(testApp)
      .get("/test/organizations/10/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("allows the request when the module is explicitly enabled for the organization", async () => {
    mockSession();
    mockActiveMembership(10);
    seedRecruitmentModule({ defaultEnabled: false });
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }];

    const res = await request(testApp)
      .get("/test/organizations/10/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("blocks the request when the module is explicitly disabled for the organization", async () => {
    mockSession();
    mockActiveMembership(10);
    seedRecruitmentModule({ defaultEnabled: true });
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: false }];

    const res = await request(testApp)
      .get("/test/organizations/10/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("falls back to the registry's defaultEnabled when no override row exists", async () => {
    mockSession();
    mockActiveMembership(10);
    seedRecruitmentModule({ defaultEnabled: true });
    fixtures.organizationModuleRows = [];

    const res = await request(testApp)
      .get("/test/organizations/10/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
  });

  it("blocks access when the target module is enabled but a required module is not (dependency chain)", async () => {
    mockSession();
    mockActiveMembership(10);
    fixtures.moduleRows = [
      { id: 1, key: "recruitment", status: "active", defaultEnabled: false, requiredModuleKeys: ["employee_self_service"] },
      { id: 2, key: "employee_self_service", status: "active", defaultEnabled: false, requiredModuleKeys: [] },
    ];
    // recruitment itself is on, but its required module has no enabling override -> defaultEnabled false
    fixtures.organizationModuleRows = [{ id: 1, organizationId: 10, moduleId: 1, enabled: true }];

    const res = await request(testApp)
      .get("/test/organizations/10/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });

  it("enforces tenant isolation: org A's enablement does not leak into org B's request", async () => {
    mockSession();
    seedRecruitmentModule({ defaultEnabled: false });
    fixtures.organizationModuleRows = [
      { id: 1, organizationId: 10, moduleId: 1, enabled: true }, // org 10 turned it on
    ];
    mockActiveMembership(20); // caller's membership is in org 20, which has no override row

    const res = await request(testApp)
      .get("/test/organizations/20/recruitment")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
  });
});
