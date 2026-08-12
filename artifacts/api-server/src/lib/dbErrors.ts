function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  // drizzle-orm wraps the real pg-driver error (a DatabaseError, whose
  // `.code` carries the actual SQLSTATE) in its own Error — the wrapper's
  // own `.code` is always undefined; the SQLSTATE only ever surfaces via
  // `.cause`. Verified directly against this exact drizzle-orm version by
  // reproducing a real unique-violation live: `err.code` was undefined
  // while `err.cause.code === "23505"`. Checking `err.code` alone (this
  // function's entire previous body) can therefore never actually match a
  // real database error — only the flat-`.code` shape every existing
  // mocked-DB test fixture in this codebase constructs by hand, which is
  // why this was never caught by the test suite.
  if ("cause" in err) return pgErrorCode((err as { cause?: unknown }).cause);
  return undefined;
}

/** True if `err` is a Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}
