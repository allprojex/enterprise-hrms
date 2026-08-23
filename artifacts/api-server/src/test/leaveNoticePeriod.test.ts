/**
 * Unit tests for the pure notice-period boundary calculator (Phase 3H,
 * W117, frozen plan Decision 11) — no DB, no mocks, exercising
 * leaveRequests.ts's resolveEarliestAllowedStartDate directly.
 */
import { describe, it, expect } from "vitest";
import { resolveEarliestAllowedStartDate } from "../lib/leaveRequests";

describe("resolveEarliestAllowedStartDate", () => {
  it("adds calendar days (weekends included) when countWorkingDaysOnly is false", () => {
    // Mon 2030-06-10 + 5 calendar days = Sat 2030-06-15.
    expect(resolveEarliestAllowedStartDate("2030-06-10", 5, false)).toBe("2030-06-15");
  });

  it("skips weekends when countWorkingDaysOnly is true", () => {
    // Mon 2030-06-10 + 5 working days: Tue 11, Wed 12, Thu 13, Fri 14, (Sat 15, Sun 16 skipped), Mon 17.
    expect(resolveEarliestAllowedStartDate("2030-06-10", 5, true)).toBe("2030-06-17");
  });

  it("also skips supplied holiday dates when countWorkingDaysOnly is true", () => {
    // Same as above, but Wed 2030-06-12 is a holiday and is skipped too:
    // Tue 11(1), Wed 12(holiday, skip), Thu 13(2), Fri 14(3), Sat/Sun skip, Mon 17(4), Tue 18(5).
    const holidays = new Set(["2030-06-12"]);
    expect(resolveEarliestAllowedStartDate("2030-06-10", 5, true, holidays)).toBe("2030-06-18");
  });

  it("ignores a holiday date that falls on a weekend (no double-skip)", () => {
    // 2030-06-15 (Sat) is both a weekend and (redundantly) listed as a holiday.
    const holidays = new Set(["2030-06-15"]);
    expect(resolveEarliestAllowedStartDate("2030-06-10", 5, true, holidays)).toBe("2030-06-17");
  });

  it("returns today unchanged when noticePeriodDays is 0", () => {
    expect(resolveEarliestAllowedStartDate("2030-06-10", 0, false)).toBe("2030-06-10");
    expect(resolveEarliestAllowedStartDate("2030-06-10", 0, true)).toBe("2030-06-10");
  });

  it("defaults to an empty holiday set when none is supplied", () => {
    expect(resolveEarliestAllowedStartDate("2030-06-10", 1, true)).toBe("2030-06-11");
  });
});
