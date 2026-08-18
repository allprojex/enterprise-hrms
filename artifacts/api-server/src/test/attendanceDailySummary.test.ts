/**
 * Focused tests for the Attendance Daily Summary read-model's pure
 * computation functions (Phase 3B, W66) — deriveCivilDate,
 * isConfiguredWorkDay, computeEventDerivedStatus. No @workspace/db mocking
 * needed; these take already-resolved values, exactly like
 * attendanceAuthorization.ts's own pure-function precedent.
 */
import { describe, it, expect } from "vitest";
import { deriveCivilDate, isConfiguredWorkDay, computeEventDerivedStatus } from "../lib/attendanceDailySummary";

describe("Attendance Daily Summary read-model (W66)", () => {
  describe("deriveCivilDate", () => {
    it("derives the UTC civil date when timezone is UTC", () => {
      expect(deriveCivilDate(new Date("2026-03-05T10:00:00Z"), "UTC")).toBe("2026-03-05");
    });

    it("derives an earlier civil date for a timezone behind UTC (near-midnight UTC boundary)", () => {
      // 2026-03-05T01:00:00Z is still 2026-03-04 20:00 in America/New_York (UTC-5).
      expect(deriveCivilDate(new Date("2026-03-05T01:00:00Z"), "America/New_York")).toBe("2026-03-04");
    });

    it("derives a later civil date for a timezone ahead of UTC (near-midnight UTC boundary)", () => {
      // 2026-03-04T23:00:00Z is already 2026-03-05 02:00 in Europe/Moscow (UTC+3).
      expect(deriveCivilDate(new Date("2026-03-04T23:00:00Z"), "Europe/Moscow")).toBe("2026-03-05");
    });

    it("is DST-correct (no fixed-offset arithmetic) across a DST transition", () => {
      // America/New_York: EST (UTC-5) before mid-March, EDT (UTC-4) after.
      expect(deriveCivilDate(new Date("2026-01-15T04:30:00Z"), "America/New_York")).toBe("2026-01-14");
      expect(deriveCivilDate(new Date("2026-07-15T03:30:00Z"), "America/New_York")).toBe("2026-07-14");
    });
  });

  describe("isConfiguredWorkDay", () => {
    it("matches the configured work day list", () => {
      expect(isConfiguredWorkDay("2026-03-05", ["monday", "tuesday", "wednesday", "thursday", "friday"])).toBe(true);
      expect(isConfiguredWorkDay("2026-03-07", ["monday", "tuesday", "wednesday", "thursday", "friday"])).toBe(false);
    });

    it("supports a Sunday-included work week", () => {
      expect(isConfiguredWorkDay("2026-03-08", ["sunday", "monday", "tuesday", "wednesday", "thursday"])).toBe(true);
    });
  });

  describe("computeEventDerivedStatus", () => {
    const base = { workStartTime: "09:00", workEndTime: "17:00", gracePeriodMinutes: 15, timezone: "UTC" };

    it("returns absent with no numeric fields when neither clock-in nor clock-out exists", () => {
      const result = computeEventDerivedStatus({ firstClockIn: null, lastClockOut: null, ...base });
      expect(result.status).toBe("absent");
      expect(result.workedMinutes).toBeNull();
      expect(result.lateMinutes).toBeNull();
      expect(result.earlyDepartureMinutes).toBeNull();
    });

    it("returns partial when only a clock-in exists", () => {
      const result = computeEventDerivedStatus({ firstClockIn: new Date("2026-03-05T09:00:00Z"), lastClockOut: null, ...base });
      expect(result.status).toBe("partial");
    });

    it("returns partial when only a clock-out exists", () => {
      const result = computeEventDerivedStatus({ firstClockIn: null, lastClockOut: new Date("2026-03-05T17:00:00Z"), ...base });
      expect(result.status).toBe("partial");
    });

    it("returns present, on time, within the grace period", () => {
      const result = computeEventDerivedStatus({
        firstClockIn: new Date("2026-03-05T09:10:00Z"),
        lastClockOut: new Date("2026-03-05T17:00:00Z"),
        ...base,
      });
      expect(result.status).toBe("present");
      expect(result.lateMinutes).toBe(0);
      expect(result.workedMinutes).toBe(470);
    });

    it("returns late when the clock-in is beyond workStartTime + grace", () => {
      const result = computeEventDerivedStatus({
        firstClockIn: new Date("2026-03-05T09:20:00Z"),
        lastClockOut: new Date("2026-03-05T17:00:00Z"),
        ...base,
      });
      expect(result.status).toBe("late");
      expect(result.lateMinutes).toBe(5);
    });

    it("computes earlyDepartureMinutes without changing status away from present", () => {
      const result = computeEventDerivedStatus({
        firstClockIn: new Date("2026-03-05T09:00:00Z"),
        lastClockOut: new Date("2026-03-05T16:30:00Z"),
        ...base,
      });
      expect(result.status).toBe("present");
      expect(result.earlyDepartureMinutes).toBe(30);
    });

    it("clamps workedMinutes at 0 for a reversed/malformed pair", () => {
      const result = computeEventDerivedStatus({
        firstClockIn: new Date("2026-03-05T17:00:00Z"),
        lastClockOut: new Date("2026-03-05T09:00:00Z"),
        ...base,
      });
      expect(result.workedMinutes).toBe(0);
    });

    it("is timezone-aware, not UTC-literal, when computing lateMinutes", () => {
      // 09:10 local in America/New_York (UTC-5 in March) is 14:10 UTC.
      const result = computeEventDerivedStatus({
        firstClockIn: new Date("2026-03-05T14:10:00Z"),
        lastClockOut: new Date("2026-03-05T22:00:00Z"),
        workStartTime: "09:00",
        workEndTime: "17:00",
        gracePeriodMinutes: 15,
        timezone: "America/New_York",
      });
      expect(result.status).toBe("present");
    });
  });
});
