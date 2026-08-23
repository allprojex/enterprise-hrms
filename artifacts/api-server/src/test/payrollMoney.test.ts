/**
 * Payroll, Workstream 3 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.7, §13, §K).
 * Pure arithmetic — no DB/mocking required. Every value hand-verified.
 */
import { describe, it, expect } from "vitest";
import { toMinorUnits, fromMinorUnits, applyPercent, clampMinor, sumMinor, maxBigInt, InvalidMoneyStringError } from "../lib/payrollMoney";

describe("toMinorUnits / fromMinorUnits", () => {
  it("round-trips whole amounts", () => {
    expect(toMinorUnits("1000.00")).toBe(100000n);
    expect(fromMinorUnits(100000n)).toBe("1000.00");
  });
  it("round-trips fractional pesewas", () => {
    expect(toMinorUnits("0.01")).toBe(1n);
    expect(toMinorUnits("0.10")).toBe(10n);
    expect(fromMinorUnits(1n)).toBe("0.01");
  });
  it("pads a single decimal digit", () => {
    expect(toMinorUnits("5.5")).toBe(550n);
  });
  it("handles a bare integer with no decimal point", () => {
    expect(toMinorUnits("0")).toBe(0n);
    expect(toMinorUnits("42")).toBe(4200n);
  });
  it("handles negative amounts", () => {
    expect(toMinorUnits("-50.25")).toBe(-5025n);
    expect(fromMinorUnits(-5025n)).toBe("-50.25");
  });
  it("rejects a malformed string", () => {
    expect(() => toMinorUnits("abc")).toThrow(InvalidMoneyStringError);
    expect(() => toMinorUnits("1.234")).toThrow(InvalidMoneyStringError);
  });
});

describe("applyPercent — rounds half away from zero, no floating point", () => {
  it("computes an exact percentage with no remainder", () => {
    // 1500.00 x 5.50% = 82.50 exactly
    expect(applyPercent(toMinorUnits("1500.00"), "5.50")).toBe(toMinorUnits("82.50"));
  });
  it("rounds a tie (exact .5 pesewa) away from zero", () => {
    // 350.50 x 5.00% = 17.525 -> ties to 17.53
    expect(applyPercent(toMinorUnits("350.50"), "5.00")).toBe(toMinorUnits("17.53"));
  });
  it("rounds down when the fractional pesewa is below half", () => {
    // 100.00 x 1.23% = 1.23 exactly, no rounding ambiguity; use a case that produces < .5
    // 33.00 x 10% = 3.30 exact; instead force a sub-half remainder: 1.00 x 3% = 0.03 exact.
    // Use 10.03 x 10% = 1.003 -> rounds to 1.00 (remainder 3/100 of a pesewa, well under half)
    expect(applyPercent(toMinorUnits("10.03"), "10.00")).toBe(toMinorUnits("1.00"));
  });
  it("is sign-safe for a negative amount", () => {
    expect(applyPercent(-toMinorUnits("1500.00"), "5.50")).toBe(-toMinorUnits("82.50"));
  });
  it("returns zero for a zero amount", () => {
    expect(applyPercent(0n, "25.00")).toBe(0n);
  });
});

describe("clampMinor", () => {
  it("passes an in-range value through unchanged", () => {
    expect(clampMinor(toMinorUnits("900.00"), null, toMinorUnits("1500.00"))).toBe(toMinorUnits("900.00"));
  });
  it("clamps to the maximum when the value exceeds it", () => {
    expect(clampMinor(toMinorUnits("2000.00"), null, toMinorUnits("1500.00"))).toBe(toMinorUnits("1500.00"));
  });
  it("does not clamp when exactly at the maximum boundary", () => {
    expect(clampMinor(toMinorUnits("1500.00"), null, toMinorUnits("1500.00"))).toBe(toMinorUnits("1500.00"));
  });
  it("clamps to the minimum when the value is below it", () => {
    expect(clampMinor(toMinorUnits("50.00"), toMinorUnits("100.00"), null)).toBe(toMinorUnits("100.00"));
  });
  it("leaves the value unbounded when both limits are null", () => {
    expect(clampMinor(toMinorUnits("999999.99"), null, null)).toBe(toMinorUnits("999999.99"));
  });
});

describe("sumMinor / maxBigInt", () => {
  it("sums an empty list to zero", () => {
    expect(sumMinor([])).toBe(0n);
  });
  it("sums several values", () => {
    expect(sumMinor([toMinorUnits("100.00"), toMinorUnits("0.50"), toMinorUnits("-25.25")])).toBe(toMinorUnits("75.25"));
  });
  it("returns the larger of two bigints", () => {
    expect(maxBigInt(5n, 10n)).toBe(10n);
    expect(maxBigInt(10n, 5n)).toBe(10n);
  });
});

describe("determinism", () => {
  it("produces byte-identical results for identical inputs across repeated calls", () => {
    const a = applyPercent(toMinorUnits("1917.50"), "10.00");
    const b = applyPercent(toMinorUnits("1917.50"), "10.00");
    expect(a).toBe(b);
  });
});
