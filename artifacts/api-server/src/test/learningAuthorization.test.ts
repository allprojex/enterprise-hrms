/**
 * Focused tests for the Learning authorization foundation (Phase 3D,
 * W85). These are pure functions (no query, no Learning route or service
 * function exists yet) — no @workspace/db mocking is needed for them.
 */
import { describe, it, expect } from "vitest";
import {
  LEARNING_MODULE_KEY,
  isOwnLearningRecord,
  isManagerOfRecord,
  isInstructorOfRecord,
  resolveLearningVisibilityScope,
} from "../lib/learningAuthorization";

describe("Learning authorization foundation (W85)", () => {
  it("exposes the exact module key the registry already seeded", () => {
    expect(LEARNING_MODULE_KEY).toBe("learning");
  });

  describe("isOwnLearningRecord", () => {
    it("is true only when both IDs are set and equal", () => {
      expect(isOwnLearningRecord(5, 5)).toBe(true);
    });
    it("is false when the IDs differ", () => {
      expect(isOwnLearningRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null", () => {
      expect(isOwnLearningRecord(null, 5)).toBe(false);
      expect(isOwnLearningRecord(5, null)).toBe(false);
      expect(isOwnLearningRecord(null, null)).toBe(false);
    });
  });

  describe("isManagerOfRecord", () => {
    it("is true only when the actor equals the enrollment's snapshotted managerEmployeeIdSnapshot", () => {
      expect(isManagerOfRecord(5, 5)).toBe(true);
    });
    it("is false when the actor is not the enrollment's manager of record", () => {
      expect(isManagerOfRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null (no manager snapshotted, or no actor resolved)", () => {
      expect(isManagerOfRecord(null, 5)).toBe(false);
      expect(isManagerOfRecord(5, null)).toBe(false);
      expect(isManagerOfRecord(null, null)).toBe(false);
    });
  });

  describe("isInstructorOfRecord", () => {
    it("is true only when the actor equals the session's own instructorEmployeeId", () => {
      expect(isInstructorOfRecord(5, 5)).toBe(true);
    });
    it("is false when the actor is not the session's instructor of record", () => {
      expect(isInstructorOfRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null (no instructor assigned, or no actor resolved)", () => {
      expect(isInstructorOfRecord(null, 5)).toBe(false);
      expect(isInstructorOfRecord(5, null)).toBe(false);
      expect(isInstructorOfRecord(null, null)).toBe(false);
    });
  });

  describe("resolveLearningVisibilityScope", () => {
    it("prioritizes organization-wide over every narrower tier", () => {
      const scope = resolveLearningVisibilityScope({
        isOrgWide: true,
        isOwn: true,
        isManagerOfRecord: true,
        isInstructorOfRecord: true,
      });
      expect(scope).toBe("organization_wide");
    });

    it("falls back to own when not org-wide", () => {
      const scope = resolveLearningVisibilityScope({
        isOrgWide: false,
        isOwn: true,
        isManagerOfRecord: true,
        isInstructorOfRecord: true,
      });
      expect(scope).toBe("own");
    });

    it("falls back to manager_of_record when neither org-wide nor own", () => {
      const scope = resolveLearningVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isManagerOfRecord: true,
        isInstructorOfRecord: true,
      });
      expect(scope).toBe("manager_of_record");
    });

    it("falls back to instructor_of_record when neither org-wide, own, nor manager-of-record", () => {
      const scope = resolveLearningVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isManagerOfRecord: false,
        isInstructorOfRecord: true,
      });
      expect(scope).toBe("instructor_of_record");
    });

    it("returns null when no tier matches", () => {
      const scope = resolveLearningVisibilityScope({
        isOrgWide: false,
        isOwn: false,
        isManagerOfRecord: false,
        isInstructorOfRecord: false,
      });
      expect(scope).toBeNull();
    });

    it("treats manager-of-record and instructor-of-record as independent, non-exclusive tiers (an employee who is both is authorized on each relationship separately)", () => {
      // Manager-of-record alone still resolves even when the caller is not
      // this session's instructor, and vice versa — dispatch is per-tier,
      // never all-or-nothing.
      expect(resolveLearningVisibilityScope({ isOrgWide: false, isOwn: false, isManagerOfRecord: true, isInstructorOfRecord: false })).toBe(
        "manager_of_record",
      );
      expect(resolveLearningVisibilityScope({ isOrgWide: false, isOwn: false, isManagerOfRecord: false, isInstructorOfRecord: true })).toBe(
        "instructor_of_record",
      );
    });
  });
});
