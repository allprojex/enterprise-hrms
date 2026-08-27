/**
 * The guard itself is pure and runs in ordinary CI — it is the thing standing
 * between a destructive live suite and a shared hosted database, so it needs
 * its own coverage rather than only being exercised by the suites it guards.
 */
import { describe, it, expect, afterEach } from "vitest";
import { assertSafeLiveDatabaseUrl, resolveLiveDatabaseUrl, UnsafeLiveTestDatabaseError } from "./liveDbGuard";

const VAR = "WS_TEST_GUARD_URL";

afterEach(() => {
  delete process.env[VAR];
  delete process.env.ALLOW_NONLOCAL_TEST_DB;
});

describe("live database guard", () => {
  it("allows loopback and docker-compose service hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "host.docker.internal", "db"]) {
      const url = `postgresql://hrms:hrms@${host}:5433/hrms`;
      expect(assertSafeLiveDatabaseUrl(url, VAR)).toBe(url);
    }
  });

  it("refuses a managed/remote host so a destructive suite cannot hit shared infrastructure", () => {
    expect(() => assertSafeLiveDatabaseUrl("postgresql://u:p@aws-0-eu-north-1.pooler.example.com:6543/postgres", VAR)).toThrow(
      UnsafeLiveTestDatabaseError,
    );
  });

  it("names the offending host but never echoes the credential", () => {
    let message = "";
    try {
      assertSafeLiveDatabaseUrl("postgresql://someuser:sup3rsecret@managed.example.com:6543/postgres", VAR);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("managed.example.com");
    expect(message).not.toContain("sup3rsecret");
    expect(message).not.toContain("someuser");
  });

  it("allows a remote host only with an explicit acknowledgement", () => {
    const url = "postgresql://u:p@managed.example.com:6543/postgres";
    expect(() => assertSafeLiveDatabaseUrl(url, VAR)).toThrow();
    process.env.ALLOW_NONLOCAL_TEST_DB = "1";
    expect(assertSafeLiveDatabaseUrl(url, VAR)).toBe(url);
  });

  it("rejects a malformed URL rather than passing it through", () => {
    expect(() => assertSafeLiveDatabaseUrl("not-a-url", VAR)).toThrow(UnsafeLiveTestDatabaseError);
  });

  it("returns null (skip) when the variable is unset, and throws — never silently skips — when it is unsafe", () => {
    expect(resolveLiveDatabaseUrl(VAR)).toBeNull();
    process.env[VAR] = "postgresql://u:p@managed.example.com:6543/postgres";
    expect(() => resolveLiveDatabaseUrl(VAR)).toThrow(UnsafeLiveTestDatabaseError);
  });
});
