/**
 * Focused tests for the Attendance authorization foundation (Phase 3B,
 * W64). These are pure functions (no query, no Attendance route or service
 * function exists yet) — no @workspace/db mocking is needed for them.
 */
import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_MODULE_KEY,
  isOwnAttendanceRecord,
  isReportingManagerOf,
  resolveAttendanceVisibilityScope,
} from "../lib/attendanceAuthorization";

describe("Attendance authorization foundation (W64)", () => {
  it("exposes the exact module key the registry already seeded", () => {
    expect(ATTENDANCE_MODULE_KEY).toBe("attendance");
  });

  describe("isOwnAttendanceRecord", () => {
    it("is true only when both IDs are set and equal", () => {
      expect(isOwnAttendanceRecord(5, 5)).toBe(true);
    });
    it("is false when the IDs differ", () => {
      expect(isOwnAttendanceRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null", () => {
      expect(isOwnAttendanceRecord(null, 5)).toBe(false);
      expect(isOwnAttendanceRecord(5, null)).toBe(false);
      expect(isOwnAttendanceRecord(null, null)).toBe(false);
    });
  });

  describe("isReportingManagerOf", () => {
    it("is true only when the actor equals the target's reportingManagerId", () => {
      expect(isReportingManagerOf(5, 5)).toBe(true);
    });
    it("is false when the actor is not the target's manager", () => {
      expect(isReportingManagerOf(5, 6)).toBe(false);
    });
    it("is false when either side is null (no manager set, or no actor resolved)", () => {
      expect(isReportingManagerOf(null, 5)).toBe(false);
      expect(isReportingManagerOf(5, null)).toBe(false);
      expect(isReportingManagerOf(null, null)).toBe(false);
    });
  });

  describe("resolveAttendanceVisibilityScope", () => {
    it("prioritizes organization-wide over every narrower tier", () => {
      const scope = resolveAttendanceVisibilityScope({
        isOrgWide: true,
        isOwn: true,
        isManagerOfTarget: true,
      });
      expect(scope).toBe("organization_wide");
    });

    it("falls back to own when not org-wide", () => {
      const scope = resolveAttendanceVisibilityScope({
        isOrgWide: false,
        isOwn: true,
        isManagerOfTarget: true,
      });
      expect(scope).toBe("own");
    });

    it("falls back to team when neither org-wide nor own", () => {
      const scope = resolveAttendanceVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isManagerOfTarget: true,
      });
      expect(scope).toBe("team");
    });

    it("returns null when no tier matches", () => {
      const scope = resolveAttendanceVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isManagerOfTarget: false,
      });
      expect(scope).toBeNull();
    });
  });
});
