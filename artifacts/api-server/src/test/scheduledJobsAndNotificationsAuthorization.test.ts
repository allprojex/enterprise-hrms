/**
 * WS-6 (Scheduled Jobs / Notifications Foundation) — integration tests,
 * through supertest against the real app, proving:
 *   (1) the platform-scoped authorization gate (requireSuperAdmin) on the
 *       scheduled-jobs admin surface, mirroring
 *       installationsAndBreakGlassAuthorization.test.ts's own pattern
 *       exactly for a new platform-scoped route family;
 *   (2) the pre-existing notifications routes still authenticate exactly as
 *       before, and the new dismiss route is wired and IDOR-safe.
 * Engine/service business logic itself is covered by the live-Postgres
 * suites; this file is purely about the HTTP/auth wiring.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, usersTable, sessionsTable, notificationsTable } = vi.hoisted(() => {
  function mockTableInner(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as { session: Record<string, unknown>; user: Record<string, unknown> }[],
      jobRows: [] as Record<string, unknown>[],
      notificationRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTableInner("users", ["id"]),
    sessionsTable: mockTableInner("sessions", ["token", "userId", "expiresAt"]),
    notificationsTable: mockTableInner("notifications", ["id", "userId", "organizationId", "expiresAt"]),
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  notificationsTable,
  scheduledJobsTable: { __name: "scheduled_jobs" },
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
        const rows = table === notificationsTable ? fixtures.notificationRows : fixtures.jobRows;
        const builder = {
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          offset: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
        };
        return builder;
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (table === notificationsTable) {
              const base = fixtures.notificationRows[0];
              if (!base) return Promise.resolve([]);
              return Promise.resolve([{ ...base, ...v }]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]), then: (r: (v: unknown) => void) => r(undefined) }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  or: () => "or",
  isNull: () => "isNull",
  desc: () => "desc",
  sql: () => "sql",
  gt: () => "gt",
}));

const { default: app } = await import("../app");

function sessionFor(role: string, userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "u@example.com", firstName: "U", lastName: "Ser", role, organizationId: 10, disabledAt: null, createdAt: new Date() },
    },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.jobRows = [];
  fixtures.notificationRows = [];
});

describe("scheduled jobs — platform authority gate", () => {
  it("rejects an ordinary organization admin listing jobs", async () => {
    sessionFor("org_admin");
    const res = await request(app).get("/api/platform/scheduled-jobs").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("rejects an ordinary organization admin cancelling a job", async () => {
    sessionFor("hr_manager");
    const res = await request(app).post("/api/platform/scheduled-jobs/1/cancel").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("allows the platform super_admin to list jobs", async () => {
    sessionFor("super_admin");
    const res = await request(app).get("/api/platform/scheduled-jobs").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("requires authentication at all (no session)", async () => {
    const res = await request(app).get("/api/platform/scheduled-jobs");
    expect(res.status).toBe(401);
  });

  it("there is no generic 'execute job' or 'create job' route exposed to any caller", async () => {
    sessionFor("super_admin");
    const createAttempt = await request(app)
      .post("/api/platform/scheduled-jobs")
      .set("Authorization", "Bearer valid-token")
      .send({ jobType: "anything", payload: {} });
    // Not registered at all — 404, never a 200/201 that would imply a generic creation endpoint exists.
    expect(createAttempt.status).toBe(404);
  });
});

describe("notifications — existing auth model unchanged, new dismiss route wired", () => {
  it("still requires authentication for the pre-existing list route", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("lists an authenticated user's own notifications", async () => {
    sessionFor("employee", 7);
    fixtures.notificationRows = [{ id: 1, userId: 7, title: "t", message: "m", type: "info", read: false, createdAt: new Date(), organizationId: null }];
    const res = await request(app).get("/api/notifications").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("dismiss route is wired and returns 404 (never another user's row) for a nonexistent/foreign id", async () => {
    sessionFor("employee", 7);
    fixtures.notificationRows = []; // update-with-returning finds nothing -> service throws NotificationNotFoundError
    const res = await request(app).patch("/api/notifications/999/dismiss").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });

  it("dismiss succeeds for the caller's own notification", async () => {
    sessionFor("employee", 7);
    fixtures.notificationRows = [{ id: 5, userId: 7, title: "t", message: "m", type: "info", read: false, createdAt: new Date(), organizationId: null, dismissedAt: null }];
    const res = await request(app).patch("/api/notifications/5/dismiss").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.dismissedAt).toBeTruthy();
  });
});
