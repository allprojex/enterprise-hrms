/**
 * Integration tests for Forgot Password Email Delivery (W19): requesting a
 * reset, previewing a reset token, and consuming it. Exercises the real
 * route handlers through supertest. @workspace/db is mocked -- no real
 * database connection is made. The email provider (../lib/email) is mocked
 * so no real Resend call is made and delivery can be forced to fail.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

/**
 * WS-18 Pass 2, F-2: reset tokens are persisted as a SHA-256 digest rather than
 * in plaintext, so a fixture row must hold the digest of the token the test
 * presents — exactly as lib/passwordReset.ts stores it.
 */
function digest(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const { fixtures, usersTable, sessionsTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      userRows: [] as Record<string, unknown>[],
      updated: [] as { table: string; values: unknown }[],
      deleted: [] as { table: string }[],
    },
    usersTable: mockTable("users", ["id", "email", "passwordResetToken", "passwordResetTokenExpiresAt"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
  };
});

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  db: {
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

        const rows = table === usersTable ? fixtures.userRows : [];
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
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          fixtures.updated.push({ table: table.__name, values: v });
          if (table === usersTable && fixtures.userRows[0]) {
            fixtures.userRows[0] = { ...fixtures.userRows[0], ...v };
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
    // WS-18 Pass 2, F-2: a successful reset now revokes every session for the
    // account, so the mock needs both a delete and the transaction that wraps
    // it together with the password update.
    delete: (table: { __name: string }) => ({
      where: () => {
        fixtures.deleted.push({ table: table.__name });
        if (table === sessionsTable) fixtures.sessionRows.length = 0;
        return Promise.resolve(undefined);
      },
    }),
    get transaction() {
      const self = this as unknown as Record<string, unknown>;
      return async (cb: (tx: unknown) => Promise<unknown>) => cb(self);
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
}));

const sendMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/email", () => ({
  getEmailProvider: () => ({ send: sendMock }),
}));

const { default: app } = await import("../app");

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.userRows = [];
  fixtures.updated = [];
  sendMock.mockReset().mockResolvedValue(undefined);
  process.env.APP_BASE_URL = "http://localhost:5173";
});

describe("POST /api/auth/forgot-password", () => {
  it("returns the same confirmation for a registered email", async () => {
    fixtures.userRows = [{ id: 1, email: "known@example.com", firstName: "Ada" }];

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "known@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that email is registered, a reset link has been sent.");
  });

  it("returns the same confirmation for an unregistered email, without sending anything", async () => {
    fixtures.userRows = [];

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that email is registered, a reset link has been sent.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("generates and stores a reset token for a registered email, and sends an email", async () => {
    fixtures.userRows = [{ id: 1, email: "known@example.com", firstName: "Ada" }];

    await request(app).post("/api/auth/forgot-password").send({ email: "known@example.com" });

    const tokenUpdate = fixtures.updated.find((u) => u.table === "users");
    expect(tokenUpdate).toBeDefined();
    const values = tokenUpdate!.values as Record<string, unknown>;
    expect(typeof values.passwordResetToken).toBe("string");
    expect((values.passwordResetToken as string).length).toBeGreaterThan(10);
    expect(values.passwordResetTokenExpiresAt).toBeInstanceOf(Date);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [emailArgs] = sendMock.mock.calls[0];
    expect(emailArgs.to).toBe("known@example.com");
    expect(emailArgs.html).toContain("http://localhost:5173/reset-password/");
  });

  it("still returns the generic confirmation when email delivery fails", async () => {
    fixtures.userRows = [{ id: 1, email: "known@example.com", firstName: "Ada" }];
    sendMock.mockRejectedValueOnce(new Error("Resend is down"));

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "known@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If that email is registered, a reset link has been sent.");
  });

  it("returns 400 for a malformed request body", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/reset-password/:token", () => {
  it("reports invalid for an unknown token", async () => {
    fixtures.userRows = [];
    const res = await request(app).get("/api/auth/reset-password/nonexistent");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("invalid");
  });

  it("reports valid for a live, unexpired token", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("good-token"), passwordResetTokenExpiresAt: new Date(Date.now() + 100000) },
    ];
    const res = await request(app).get("/api/auth/reset-password/good-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("valid");
  });

  it("reports expired for a token past its expiry", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("stale-token"), passwordResetTokenExpiresAt: new Date(Date.now() - 1000) },
    ];
    const res = await request(app).get("/api/auth/reset-password/stale-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
  });
});

describe("POST /api/auth/reset-password/:token", () => {
  it("returns 404 for an unknown token", async () => {
    fixtures.userRows = [];
    const res = await request(app).post("/api/auth/reset-password/nonexistent").send({ password: "correct-horse-battery" });
    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired token", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("stale-token"), passwordResetTokenExpiresAt: new Date(Date.now() - 1000) },
    ];
    const res = await request(app).post("/api/auth/reset-password/stale-token").send({ password: "correct-horse-battery" });
    expect(res.status).toBe(410);
  });

  it("returns 400 for a password shorter than the minimum", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("good-token"), passwordResetTokenExpiresAt: new Date(Date.now() + 100000) },
    ];
    const res = await request(app).post("/api/auth/reset-password/good-token").send({ password: "short" });
    expect(res.status).toBe(400);
  });

  it("sets a new password and clears the token on success", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("good-token"), passwordResetTokenExpiresAt: new Date(Date.now() + 100000) },
    ];

    const res = await request(app).post("/api/auth/reset-password/good-token").send({ password: "correct-horse-battery" });

    expect(res.status).toBe(200);
    const update = fixtures.updated.find((u) => u.table === "users");
    expect(update).toBeDefined();
    const values = update!.values as Record<string, unknown>;
    expect(values.passwordResetToken).toBeNull();
    expect(values.passwordResetTokenExpiresAt).toBeNull();
    expect(typeof values.passwordHash).toBe("string");
  });

  it("does not include the password in the response body", async () => {
    fixtures.userRows = [
      { id: 1, email: "known@example.com", firstName: "Ada", passwordResetToken: digest("good-token"), passwordResetTokenExpiresAt: new Date(Date.now() + 100000) },
    ];

    const res = await request(app).post("/api/auth/reset-password/good-token").send({ password: "correct-horse-battery" });

    expect(JSON.stringify(res.body)).not.toContain("correct-horse-battery");
  });
});
