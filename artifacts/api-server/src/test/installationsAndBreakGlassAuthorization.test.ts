/**
 * WS-4 (Installation Registry & Break-Glass Access Foundation) — integration
 * tests, through supertest against the real app, proving the platform-scoped
 * authorization gate (requireSuperAdmin) on both new route surfaces: an
 * ordinary organization admin (a ship-shaped user with real org roles, but
 * not the platform bootstrap identity) is rejected; the platform super_admin
 * succeeds. Registry/grant business logic itself is covered by
 * installations.test.ts and breakGlassGrants.test.ts (lib-level); the
 * elevation mechanic itself is covered by breakGlassElevation.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, usersTable, sessionsTable, installationsTable, breakGlassGrantsTable, auditEventsTable } = vi.hoisted(() => {
  function mockTableInner(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as { session: Record<string, unknown>; user: Record<string, unknown> }[],
      installationRows: [] as Record<string, unknown>[],
      grantRows: [] as Record<string, unknown>[],
      auditInserts: [] as Record<string, unknown>[],
    },
    usersTable: mockTableInner("users", ["id"]),
    sessionsTable: mockTableInner("sessions", ["token", "userId", "expiresAt"]),
    installationsTable: mockTableInner("installations", []),
    breakGlassGrantsTable: mockTableInner("break_glass_grants", []),
    auditEventsTable: mockTableInner("audit_events", []),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  installationsTable,
  breakGlassGrantsTable,
  auditEventsTable,
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
        const rows = table === installationsTable ? fixtures.installationRows : table === breakGlassGrantsTable ? fixtures.grantRows : [];
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        };
        return builder;
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]), then: (r: (v: unknown) => void) => r(undefined) }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  gt: () => "gt",
  inArray: () => "inArray",
}));

const { default: app } = await import("../app");

function sessionFor(role: string) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId: 1, expiresAt: new Date(Date.now() + 100000) },
      user: { id: 1, email: "u@example.com", firstName: "U", lastName: "Ser", role, organizationId: 10, disabledAt: null, createdAt: new Date() },
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.installationRows = [];
  fixtures.grantRows = [];
  fixtures.auditInserts = [];
});

describe("installation registry — platform authority gate", () => {
  it("rejects an ordinary organization admin (not the platform bootstrap identity)", async () => {
    sessionFor("org_admin");
    const res = await request(app).get("/api/installations").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("allows the platform super_admin", async () => {
    sessionFor("super_admin");
    const res = await request(app).get("/api/installations").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("requires authentication at all (no session)", async () => {
    const res = await request(app).get("/api/installations");
    expect(res.status).toBe(401);
  });
});

describe("break-glass grants — platform authority gate", () => {
  it("rejects an ordinary organization admin creating a grant", async () => {
    sessionFor("org_admin");
    const res = await request(app)
      .post("/api/break-glass/grants")
      .set("Authorization", "Bearer valid-token")
      .send({ targetOrganizationId: 10, reason: "x", scope: ["employee.read"], expiresAt: new Date(Date.now() + 3600000).toISOString(), confirm: true });
    expect(res.status).toBe(403);
  });

  it("rejects an ordinary organization admin listing grants", async () => {
    sessionFor("hr_manager");
    const res = await request(app).get("/api/break-glass/grants").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("allows the platform super_admin to list grants", async () => {
    sessionFor("super_admin");
    const res = await request(app).get("/api/break-glass/grants").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
  });
});
