/**
 * WS-18 Pass 2, F-2 — adversarial tests for the unauthenticated
 * credential-recovery surface (`/auth/forgot-password`,
 * `/auth/reset-password/:token`).
 *
 * These are security regression tests, not feature tests. Each one encodes a
 * property an attacker would try to break:
 *
 *   - reset requests are throttled per source and per targeted account;
 *   - token presentation is throttled per source and per token;
 *   - a registered and an unregistered address are indistinguishable in status,
 *     body, AND elapsed time;
 *   - throttling itself does not become an enumeration oracle;
 *   - tokens are single-use, expire, and are never stored or logged in plaintext;
 *   - a successful reset revokes every existing session.
 *
 * Per §29, the negative cases assert BOTH that the action is refused and that
 * authoritative state is unchanged.
 *
 * The rate limiters hold state in module-level memory, so each test uses a
 * distinct source IP and/or account identifier to stay independent of the
 * others rather than trying to reset limiter internals.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, usersTable, sessionsTable, sentEmails, loggedLines } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      userRows: [] as Record<string, unknown>[],
      sessionRows: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", [
      "id",
      "email",
      "firstName",
      "passwordHash",
      "passwordResetToken",
      "passwordResetTokenExpiresAt",
    ]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    sentEmails: [] as { to: string; subject: string; html: string; text: string }[],
    loggedLines: [] as string[],
  };
});

/** Minimal `eq` condition shape, matching the convention in the sibling suites. */
type Cond = { __op: "eq"; field: string; val: unknown } | undefined;

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (field: string, val: unknown) => ({ __op: "eq", field, val }),
  };
});

vi.mock("@workspace/db", () => {
  function rowsFor(table: { __name: string }) {
    return table.__name === "users" ? fixtures.userRows : fixtures.sessionRows;
  }
  function matches(row: Record<string, unknown>, cond: Cond): boolean {
    if (!cond) return true;
    const key = cond.field.split(".")[1];
    return row[key] === cond.val;
  }

  const api = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: (cond: Cond) => ({
          limit: () => rowsFor(table).filter((r) => matches(r, cond)).slice(0, 1),
        }),
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          for (const row of rowsFor(table)) if (matches(row, cond)) Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: (cond: Cond) => {
        const rows = rowsFor(table);
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (matches(rows[i], cond)) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
    // resetPassword runs its update+revocation in a transaction; the mock
    // applies the callback against the same in-memory rows.
    transaction: async (cb: (tx: unknown) => Promise<void>) => cb(api),
  };

  return { db: api, usersTable, sessionsTable };
});

vi.mock("../lib/email", () => ({
  getEmailProvider: () => ({
    send: async (msg: { to: string; subject: string; html: string; text: string }) => {
      sentEmails.push(msg);
    },
  }),
}));

const { default: app } = await import("../app");
const { logger } = await import("../lib/logger");

// Simulate the production topology this app is deployed into: an edge proxy
// that sets X-Forwarded-For. Without this, Express reports the loopback socket
// address for every supertest request and the whole suite shares one rate-limit
// bucket — which is precisely the failure mode finding WS18-P2-04 describes.
app.set("trust proxy", true);

// The real pino logger is kept (pino-http wraps it and needs its full surface);
// its write methods are spied so the suite can assert what the application
// actually hands to the log pipeline.
for (const level of ["error", "warn", "info", "debug"] as const) {
  vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
    loggedLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    return undefined;
  }) as never);
}

const { FORGOT_PASSWORD_MIN_RESPONSE_MS } = await import("../lib/authRateLimit");

const HOUR = 60 * 60 * 1000;

function seedUser(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 1,
    email: "victim@orga.test",
    firstName: "Vic",
    passwordHash: "oldsalt:oldhash",
    passwordResetToken: null as string | null,
    passwordResetTokenExpiresAt: null as Date | null,
    ...overrides,
  };
  fixtures.userRows.push(user);
  return user;
}

/** Pulls the plaintext token out of the emailed reset URL. */
function tokenFromLastEmail(): string {
  const match = /reset-password\/([a-f0-9]+)/.exec(sentEmails.at(-1)?.text ?? "");
  if (!match) throw new Error("no reset token was emailed");
  return match[1];
}

/** Waits for the non-awaited email dispatch to settle. */
async function flushEmail(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  fixtures.userRows.length = 0;
  fixtures.sessionRows.length = 0;
  sentEmails.length = 0;
  loggedLines.length = 0;
  process.env.APP_BASE_URL = "https://hrms.test";
});

describe("F-2 — forgot-password abuse controls", () => {
  it("throttles repeated reset requests from one source", async () => {
    seedUser({ email: "rate1@orga.test" });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ email: `nobody${i}@orga.test` });
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5);
    expect(statuses).toContain(429);
  });

  it("throttles a distributed campaign against ONE targeted mailbox", async () => {
    seedUser({ email: "target@orga.test" });

    // Every request from a different source address: a per-IP limit alone
    // would never catch this. The per-account dimension must.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", `198.51.100.${20 + i}`)
        .send({ email: "target@orga.test" });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
    await flushEmail();
    // Mail flooding is bounded: far fewer emails than requests.
    expect(sentEmails.length).toBeLessThanOrEqual(3);
  });

  it("returns an identical response for a registered and an unregistered address", async () => {
    seedUser({ email: "real@orgb.test" });

    const registered = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.31")
      .send({ email: "real@orgb.test" });

    const unregistered = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.32")
      .send({ email: "ghost@orgb.test" });

    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(registered.status);
    expect(unregistered.body).toEqual(registered.body);
  });

  it("does not leak account existence through response timing", async () => {
    seedUser({ email: "timed@orgb.test" });

    const time = async (email: string, ip: string) => {
      const started = Date.now();
      await request(app).post("/api/auth/forgot-password").set("X-Forwarded-For", ip).send({ email });
      return Date.now() - started;
    };

    const hit = await time("timed@orgb.test", "192.0.2.41");
    const miss = await time("absent@orgb.test", "192.0.2.42");

    // Both paths are held to the same floor, so neither is separable by a
    // stopwatch. Without the floor the registered path is materially slower.
    expect(hit).toBeGreaterThanOrEqual(FORGOT_PASSWORD_MIN_RESPONSE_MS - 50);
    expect(miss).toBeGreaterThanOrEqual(FORGOT_PASSWORD_MIN_RESPONSE_MS - 50);
  });

  it("throttling does not reveal whether the throttled address exists", async () => {
    seedUser({ email: "known@orgc.test" });

    const exhaust = async (email: string, ip: string) => {
      let last = await request(app)
        .post("/api/auth/forgot-password")
        .set("X-Forwarded-For", ip)
        .send({ email });
      for (let i = 0; i < 5 && last.status !== 429; i += 1) {
        last = await request(app)
          .post("/api/auth/forgot-password")
          .set("X-Forwarded-For", ip)
          .send({ email });
      }
      return last;
    };

    const knownThrottled = await exhaust("known@orgc.test", "192.0.2.51");
    const unknownThrottled = await exhaust("unknown@orgc.test", "192.0.2.52");

    expect(knownThrottled.status).toBe(429);
    expect(unknownThrottled.status).toBe(429);
    expect(unknownThrottled.body).toEqual(knownThrottled.body);
  });

  it("never writes the reset token or a password into logs", async () => {
    seedUser({ email: "logged@orgc.test" });

    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.61")
      .send({ email: "logged@orgc.test" });
    await flushEmail();

    const token = tokenFromLastEmail();
    const allLogs = loggedLines.join("\n");
    expect(allLogs).not.toContain(token);
    expect(allLogs).not.toContain("reset-password/");
  });
});

describe("F-2 — reset token lifecycle", () => {
  it("stores the token only as a digest, never in plaintext", async () => {
    const user = seedUser({ email: "digest@orgd.test" });

    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.71")
      .send({ email: "digest@orgd.test" });
    await flushEmail();

    const emailedToken = tokenFromLastEmail();
    expect(user.passwordResetToken).toBeTruthy();
    // The stored value must not be the secret that was emailed.
    expect(user.passwordResetToken).not.toBe(emailedToken);
    expect(user.passwordResetToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an expired token and leaves the password unchanged", async () => {
    const user = seedUser({
      email: "expired@orgd.test",
      passwordResetToken: null,
    });

    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.81")
      .send({ email: "expired@orgd.test" });
    await flushEmail();
    const token = tokenFromLastEmail();

    // Age the token past its TTL.
    user.passwordResetTokenExpiresAt = new Date(Date.now() - HOUR);
    const before = user.passwordHash;

    const res = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .set("X-Forwarded-For", "192.0.2.82")
      .send({ password: "BrandNewPassw0rd!" });

    expect(res.status).toBe(410);
    expect(user.passwordHash).toBe(before);
  });

  it("consumes the token so it cannot be replayed", async () => {
    const user = seedUser({ email: "single@orge.test" });

    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.91")
      .send({ email: "single@orge.test" });
    await flushEmail();
    const token = tokenFromLastEmail();

    const first = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .set("X-Forwarded-For", "192.0.2.92")
      .send({ password: "FirstNewPassw0rd!" });
    expect(first.status).toBe(200);

    const afterFirst = user.passwordHash;

    const replay = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .set("X-Forwarded-For", "192.0.2.93")
      .send({ password: "AttackerPassw0rd!" });

    expect(replay.status).toBe(404);
    // The replay changed nothing.
    expect(user.passwordHash).toBe(afterFirst);
    expect(user.passwordResetToken).toBeNull();
  });

  it("revokes every existing session on a successful reset", async () => {
    const user = seedUser({ email: "sessions@orge.test" });
    fixtures.sessionRows.push(
      { token: "stolen-by-attacker", userId: user.id, expiresAt: new Date(Date.now() + HOUR) },
      { token: "victims-own-laptop", userId: user.id, expiresAt: new Date(Date.now() + HOUR) },
      { token: "unrelated-other-user", userId: 999, expiresAt: new Date(Date.now() + HOUR) },
    );

    await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", "192.0.2.101")
      .send({ email: "sessions@orge.test" });
    await flushEmail();
    const token = tokenFromLastEmail();

    const res = await request(app)
      .post(`/api/auth/reset-password/${token}`)
      .set("X-Forwarded-For", "192.0.2.102")
      .send({ password: "RecoveredPassw0rd!" });

    expect(res.status).toBe(200);
    // The whole point of the reset: the attacker's stolen session is gone.
    expect(fixtures.sessionRows.filter((s) => s.userId === user.id)).toHaveLength(0);
    // Another user's session is untouched.
    expect(fixtures.sessionRows.filter((s) => s.userId === 999)).toHaveLength(1);
  });

  it("throttles repeated invalid token attempts against one token", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i += 1) {
      const res = await request(app)
        .get("/api/auth/reset-password/deadbeefdeadbeefdeadbeefdeadbeef")
        .set("X-Forwarded-For", `198.51.100.${100 + i}`);
      statuses.push(res.status);
    }

    // Per-token budget is exhausted even though every request came from a
    // different source address.
    expect(statuses).toContain(429);
  });

  it("throttles token guessing from one source across many tokens", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app)
        .get(`/api/auth/reset-password/${"a".repeat(60)}${i.toString().padStart(4, "0")}`)
        .set("X-Forwarded-For", "203.0.113.77");
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
