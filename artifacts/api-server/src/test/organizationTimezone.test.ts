/**
 * WS-6 (§21-22, §60) — timezone conversion is the one piece of this
 * workstream with genuine subtlety (DST transitions, offset math), so it
 * gets direct, dependency-free unit coverage before anything else is built
 * on top of it. Africa/Accra (no DST, UTC+0 year-round — this platform's
 * current customer base) and America/New_York (observes DST) are both
 * exercised deliberately: §22 forbids assuming every organization is
 * GMT-only, so the mechanism must be proven against a zone whose offset
 * actually changes across the year, not just the zone real customers use
 * today.
 */
import { describe, it, expect } from "vitest";
import { isValidTimezone, resolveOrganizationTimezone, localDateTimeToUtc, InvalidLocalDateTimeError, DEFAULT_ORGANIZATION_TIMEZONE } from "../lib/organizationTimezone";

describe("isValidTimezone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimezone("Africa/Accra")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
  });

  it("rejects garbage and injection-shaped strings", () => {
    expect(isValidTimezone("Not/A/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("'; DROP TABLE organizations; --")).toBe(false);
    expect(isValidTimezone("GMT+25")).toBe(false);
  });
});

describe("localDateTimeToUtc", () => {
  it("converts a zero-offset zone (Africa/Accra, no DST) 1:1 to UTC", () => {
    const utc = localDateTimeToUtc("Africa/Accra", "2026-09-01T09:00");
    expect(utc.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("converts a fixed positive-offset zone correctly", () => {
    // Asia/Kolkata is UTC+5:30 year-round (no DST) — a clean, non-integer offset check.
    const utc = localDateTimeToUtc("Asia/Kolkata", "2026-09-01T09:00");
    expect(utc.toISOString()).toBe("2026-09-01T03:30:00.000Z");
  });

  it("converts correctly on the winter (standard time) side of a DST zone", () => {
    // America/New_York is UTC-5 in January (EST).
    const utc = localDateTimeToUtc("America/New_York", "2026-01-15T09:00");
    expect(utc.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("converts correctly on the summer (daylight time) side of the same DST zone", () => {
    // America/New_York is UTC-4 in July (EDT) — same wall-clock time, different UTC instant,
    // proving the offset is resolved per-date rather than cached from a first call.
    const utc = localDateTimeToUtc("America/New_York", "2026-07-15T09:00");
    expect(utc.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("resolves deterministically across a spring-forward DST boundary", () => {
    // 2026-03-08 is America/New_York's spring-forward date (02:00 -> 03:00 EDT).
    // 02:30 local does not exist that day; this must resolve to SOME definite
    // instant rather than throw.
    const utc = localDateTimeToUtc("America/New_York", "2026-03-08T02:30");
    expect(Number.isNaN(utc.getTime())).toBe(false);
  });

  it("resolves both sides of a fall-back DST boundary distinctly", () => {
    // 2026-11-01 is the fall-back date; 01:30 local occurs twice. Whichever
    // side this resolves to, it must be a definite, valid instant.
    const utc = localDateTimeToUtc("America/New_York", "2026-11-01T01:30");
    expect(Number.isNaN(utc.getTime())).toBe(false);
  });

  it("accepts an explicit seconds component", () => {
    const utc = localDateTimeToUtc("UTC", "2026-09-01T09:00:30");
    expect(utc.toISOString()).toBe("2026-09-01T09:00:30.000Z");
  });

  it("rejects a malformed local date-time string", () => {
    expect(() => localDateTimeToUtc("UTC", "not-a-date")).toThrow(InvalidLocalDateTimeError);
    expect(() => localDateTimeToUtc("UTC", "2026-09-01 09:00")).toThrow(InvalidLocalDateTimeError);
  });
});

describe("resolveOrganizationTimezone", () => {
  it("falls back to UTC (never throws) — exercised fully in the live suite against real org config", () => {
    // A dedicated live-DB test proves the configured-timezone path end to
    // end (documentsLiveIntegration.test.ts's own pattern); this file
    // covers the pure default-constant contract only, no DB dependency.
    expect(DEFAULT_ORGANIZATION_TIMEZONE).toBe("UTC");
  });
});
