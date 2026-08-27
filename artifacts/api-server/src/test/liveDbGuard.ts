/**
 * Shared safety guard for the opt-in live-integration suites.
 *
 * Those suites are destructive by nature: they create real organizations,
 * users, employees and ledger rows. They already require a dedicated
 * environment variable (WS5_/WS6_/WS7_LIVE_DATABASE_URL) and skip entirely
 * without one, so they can never run by accident in CI.
 *
 * What that does NOT protect against is someone pointing one of those
 * variables at a SHARED hosted database — the project's own hosted
 * development instance, or any managed Postgres — where the damage is not
 * confined to a throwaway container. This guard closes that gap by failing
 * closed: a live suite runs only against a local/loopback host unless the
 * operator explicitly acknowledges a non-local target.
 *
 * Deliberately host-shaped rather than a denylist of one customer's
 * infrastructure: nothing here hard-codes a project ref, hostname or
 * credential, so it stays correct for every deployment of this platform.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "db", "postgres"]);

export class UnsafeLiveTestDatabaseError extends Error {}

/**
 * Returns the URL if it is safe to run a destructive suite against, and
 * throws otherwise. Set ALLOW_NONLOCAL_TEST_DB=1 to override deliberately —
 * an explicit, auditable act rather than a silent default.
 */
export function assertSafeLiveDatabaseUrl(url: string, varName: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new UnsafeLiveTestDatabaseError(`${varName} is not a valid connection URL`);
  }

  if (LOCAL_HOSTNAMES.has(host)) return url;
  if (process.env.ALLOW_NONLOCAL_TEST_DB === "1") return url;

  throw new UnsafeLiveTestDatabaseError(
    `${varName} points at the non-local host "${host}". These suites create and modify real records, so they are ` +
      `restricted to a local throwaway database (e.g. the docker-compose "db" service on port 5433). ` +
      `If you genuinely intend to target a remote database, re-run with ALLOW_NONLOCAL_TEST_DB=1.`,
  );
}

/**
 * Resolves an opt-in live database URL: returns null when the suite should
 * skip, or a verified-safe URL. Throwing (rather than skipping) on an unsafe
 * host is deliberate — a silent skip would hide the misconfiguration.
 */
export function resolveLiveDatabaseUrl(varName: string): string | null {
  const raw = process.env[varName];
  if (!raw) return null;
  return assertSafeLiveDatabaseUrl(raw, varName);
}
