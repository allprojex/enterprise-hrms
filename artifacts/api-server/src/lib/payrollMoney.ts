/**
 * Payroll, Workstream 3 — Decimal-Safe Money Arithmetic
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §K). Every authoritative payroll
 * money calculation in this module operates on integer minor units (GHS
 * pesewas — 1 GHS = 100 pesewas, matching every currency this platform's
 * `numeric(12,2)` money columns already assume) via BigInt — never
 * JavaScript's native floating-point arithmetic, which cannot represent
 * decimal fractions like 0.10 exactly and would silently drift over
 * repeated calculations.
 *
 * Rounding behavior (frozen/recorded here, per §K's explicit instruction to
 * document the applicable rounding): every intermediate percentage
 * application rounds HALF AWAY FROM ZERO to the nearest whole pesewa
 * (`roundHalfAwayFromZero`) — the conventional, auditable convention for
 * statutory money calculations, applied identically and only once per
 * discrete calculation step (never accumulated as fractional pesewas
 * carried between steps). Two calculations given byte-identical inputs
 * always produce byte-identical outputs — this module contains no
 * randomness, no wall-clock dependency, no floating-point step.
 */

const MINOR_UNITS_PER_MAJOR = 100n;
const BASIS_POINTS_DENOMINATOR = 10000n; // ratePercent "5.50" -> toMinorUnits gives 550 basis points out of 10000 (=100%)

export class InvalidMoneyStringError extends Error {
  constructor(value: string) {
    super(`"${value}" is not a valid monetary amount (expected up to 2 decimal places)`);
  }
}

/** Parses a numeric(12,2)-shaped string ("1000.00", "-50.25", "0") into integer minor units (pesewas). Never uses parseFloat. */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) throw new InvalidMoneyStringError(value);
  const [, sign, whole, fraction = ""] = match;
  const paddedFraction = fraction.padEnd(2, "0");
  const magnitude = BigInt(whole) * MINOR_UNITS_PER_MAJOR + BigInt(paddedFraction);
  return sign === "-" ? -magnitude : magnitude;
}

/** Formats integer minor units back to a numeric(12,2)-shaped string ("1000.00"). */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / MINOR_UNITS_PER_MAJOR;
  const fraction = abs % MINOR_UNITS_PER_MAJOR;
  return `${negative ? "-" : ""}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
}

/** Rounds a fraction (numerator/denominator, both non-negative) to the nearest whole number, ties away from zero. */
function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) return quotient + 1n;
  return quotient;
}

/**
 * amountMinor x percent% (e.g. "5.50"), rounded half-away-from-zero to the
 * nearest pesewa. Sign-safe. `toMinorUnits("5.50")` yields 550 — already the
 * correct basis-point value relative to 100.00% (550 / 10000 = 0.055 = 5.5%),
 * so no further scaling is applied.
 */
export function applyPercent(amountMinor: bigint, ratePercent: string): bigint {
  const basisPoints = toMinorUnits(ratePercent);
  const negative = amountMinor < 0n;
  const absAmount = negative ? -amountMinor : amountMinor;
  const product = absAmount * basisPoints;
  const rounded = roundHalfAwayFromZero(product < 0n ? -product : product, BASIS_POINTS_DENOMINATOR);
  return negative ? -rounded : rounded;
}

/** Clamps amountMinor into [minMinor, maxMinor] where either bound may be null (unbounded). */
export function clampMinor(amountMinor: bigint, minMinor: bigint | null, maxMinor: bigint | null): bigint {
  let result = amountMinor;
  if (minMinor !== null && result < minMinor) result = minMinor;
  if (maxMinor !== null && result > maxMinor) result = maxMinor;
  return result;
}

export function sumMinor(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
