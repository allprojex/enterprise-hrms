/**
 * Focused tests for the Performance authorization foundation (Phase 3C,
 * W73). These are pure functions (no query, no Performance route or
 * service function exists yet) — no @workspace/db mocking is needed for
 * them.
 */
import { describe, it, expect } from "vitest";
import {
  PERFORMANCE_MODULE_KEY,
  isOwnPerformanceRecord,
  isReviewerOfRecord,
  resolvePerformanceVisibilityScope,
} from "../lib/performanceAuthorization";

describe("Performance authorization foundation (W73)", () => {
  it("exposes the exact module key the registry already seeded", () => {
    expect(PERFORMANCE_MODULE_KEY).toBe("performance");
  });

  describe("isOwnPerformanceRecord", () => {
    it("is true only when both IDs are set and equal", () => {
      expect(isOwnPerformanceRecord(5, 5)).toBe(true);
    });
    it("is false when the IDs differ", () => {
      expect(isOwnPerformanceRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null", () => {
      expect(isOwnPerformanceRecord(null, 5)).toBe(false);
      expect(isOwnPerformanceRecord(5, null)).toBe(false);
      expect(isOwnPerformanceRecord(null, null)).toBe(false);
    });
  });

  describe("isReviewerOfRecord", () => {
    it("is true only when the actor equals the review's snapshotted reviewerEmployeeId", () => {
      expect(isReviewerOfRecord(5, 5)).toBe(true);
    });
    it("is false when the actor is not the review's reviewer of record", () => {
      expect(isReviewerOfRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null (no reviewer snapshotted, or no actor resolved)", () => {
      expect(isReviewerOfRecord(null, 5)).toBe(false);
      expect(isReviewerOfRecord(5, null)).toBe(false);
      expect(isReviewerOfRecord(null, null)).toBe(false);
    });
  });

  describe("resolvePerformanceVisibilityScope", () => {
    it("prioritizes organization-wide over every narrower tier", () => {
      const scope = resolvePerformanceVisibilityScope({
        isOrgWide: true,
        isOwn: true,
        isReviewerOfRecord: true,
      });
      expect(scope).toBe("organization_wide");
    });

    it("falls back to own when not org-wide", () => {
      const scope = resolvePerformanceVisibilityScope({
        isOrgWide: false,
        isOwn: true,
        isReviewerOfRecord: true,
      });
      expect(scope).toBe("own");
    });

    it("falls back to reviewer when neither org-wide nor own", () => {
      const scope = resolvePerformanceVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isReviewerOfRecord: true,
      });
      expect(scope).toBe("reviewer");
    });

    it("returns null when no tier matches", () => {
      const scope = resolvePerformanceVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isReviewerOfRecord: false,
      });
      expect(scope).toBeNull();
    });
  });
});
