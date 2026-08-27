/**
 * WS-7 (§12) — small, shared, pure coercion helpers every entity adapter's
 * `normalizeRow` uses, so type/date/enum validation behaves identically
 * across all nine entity types rather than each adapter inventing its own
 * rules ("do not create a second inconsistent validation universe").
 */
import type { FieldMessage } from "./adapterRegistry";

export function requiredString(raw: string | undefined, field: string, label: string, messages: FieldMessage[]): string | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    messages.push({ field, message: `${label} is required`, severity: "error" });
    return null;
  }
  return value;
}

export function optionalString(raw: string | undefined): string | null {
  const value = raw?.trim() ?? "";
  return value || null;
}

/** Accepts YYYY-MM-DD or a small set of common spreadsheet date shapes; rejects anything ambiguous rather than guessing. */
export function parseDate(raw: string | undefined, field: string, label: string, required: boolean, messages: FieldMessage[]): Date | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    if (required) messages.push({ field, message: `${label} is required`, severity: "error" });
    return null;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  let date: Date | null = null;
  if (isoMatch) {
    date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  } else if (slashMatch) {
    // DD/MM/YYYY — this platform's documented Ghana-first date convention (never MM/DD/YYYY, which would silently swap day/month for any date where both are <= 12).
    date = new Date(Date.UTC(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1])));
  }
  if (!date || Number.isNaN(date.getTime())) {
    messages.push({ field, message: `${label} must be a valid date (YYYY-MM-DD or DD/MM/YYYY)`, severity: "error" });
    return null;
  }
  return date;
}

export function parseEnum<T extends string>(
  raw: string | undefined,
  field: string,
  label: string,
  allowed: readonly T[],
  required: boolean,
  messages: FieldMessage[],
): T | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    if (required) messages.push({ field, message: `${label} is required`, severity: "error" });
    return null;
  }
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const match = allowed.find((a) => a.toLowerCase() === normalized);
  if (!match) {
    messages.push({ field, message: `${label} must be one of: ${allowed.join(", ")}`, severity: "error" });
    return null;
  }
  return match;
}

export function parseNumber(raw: string | undefined, field: string, label: string, required: boolean, messages: FieldMessage[]): number | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    if (required) messages.push({ field, message: `${label} is required`, severity: "error" });
    return null;
  }
  const normalized = value.replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    messages.push({ field, message: `${label} must be a number`, severity: "error" });
    return null;
  }
  return parsed;
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Reads a date back out of a staged row.
 *
 * `normalizeRow` produces real `Date` objects, but a staged row is persisted
 * as JSONB — so by the time `planRow`/`executeRow` sees it, every date has
 * round-tripped through JSON and is an ISO **string**, not a `Date`. Casting
 * it back with `as Date` compiles happily and then fails at runtime the first
 * time anything calls a Date method on it. Every adapter reads its dates
 * through this instead.
 */
export function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
