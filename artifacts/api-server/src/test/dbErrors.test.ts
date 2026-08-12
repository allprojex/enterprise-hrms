/**
 * Regression coverage for isUniqueViolation (Phase 3A live QA finding):
 * drizzle-orm@0.45.2 wraps the real pg-driver DatabaseError in its own
 * Error, with the SQLSTATE only reachable via `.cause.code` — the wrapper's
 * own `.code` is always undefined. Every existing mocked-DB test fixture in
 * this codebase constructs errors with a flat `.code` directly (never
 * `.cause`), which is why this went uncaught until a live database
 * reproduced it during Phase 3A QA (a real duplicate-conversion attempt
 * leaked an unhandled 500 instead of the intended 409 AlreadyConvertedError).
 */
import { describe, it, expect } from "vitest";
import { isUniqueViolation } from "../lib/dbErrors";

describe("isUniqueViolation", () => {
  it("returns true for the flat-.code shape every mocked-DB test fixture in this codebase constructs", () => {
    expect(isUniqueViolation(Object.assign(new Error("duplicate key"), { code: "23505" }))).toBe(true);
  });

  it("returns true for drizzle-orm's real wrapped shape (.code undefined, real code on .cause.code)", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const wrapped = Object.assign(new Error("Failed query: insert into ..."), { cause });
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("returns false for an unrelated Postgres error code, flat or wrapped", () => {
    expect(isUniqueViolation(Object.assign(new Error("not null violation"), { code: "23502" }))).toBe(false);
    const cause = Object.assign(new Error("not null violation"), { code: "23502" });
    expect(isUniqueViolation(Object.assign(new Error("Failed query"), { cause }))).toBe(false);
  });

  it("returns false for a plain Error with no code anywhere in the chain", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});
