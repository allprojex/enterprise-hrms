/**
 * Focused tests for the Recruitment authorization foundation (Phase 3A,
 * W43). These are pure functions (no query, no recruitment business
 * table exists yet) — no @workspace/db mocking is needed for them.
 */
import { describe, it, expect } from "vitest";
import {
  RECRUITMENT_MODULE_KEY,
  isAssignedRecruitmentActor,
  isSameDepartmentScope,
  isSameBranchScope,
  resolveRecruitmentVisibilityScope,
} from "../lib/recruitmentAuthorization";

describe("Recruitment authorization foundation (W43)", () => {
  it("exposes the exact module key the registry already seeded", () => {
    expect(RECRUITMENT_MODULE_KEY).toBe("recruitment");
  });

  describe("isAssignedRecruitmentActor", () => {
    it("is true only when both IDs are set and equal", () => {
      expect(isAssignedRecruitmentActor(5, 5)).toBe(true);
    });
    it("is false when the IDs differ", () => {
      expect(isAssignedRecruitmentActor(5, 6)).toBe(false);
    });
    it("is false when either side is null", () => {
      expect(isAssignedRecruitmentActor(null, 5)).toBe(false);
      expect(isAssignedRecruitmentActor(5, null)).toBe(false);
      expect(isAssignedRecruitmentActor(null, null)).toBe(false);
    });
  });

  describe("isSameDepartmentScope / isSameBranchScope", () => {
    it("matches only equal, non-null IDs", () => {
      expect(isSameDepartmentScope(1, 1)).toBe(true);
      expect(isSameDepartmentScope(1, 2)).toBe(false);
      expect(isSameDepartmentScope(null, 1)).toBe(false);
      expect(isSameBranchScope(1, 1)).toBe(true);
      expect(isSameBranchScope(1, 2)).toBe(false);
      expect(isSameBranchScope(1, null)).toBe(false);
    });
  });

  describe("resolveRecruitmentVisibilityScope", () => {
    it("prioritizes organization-wide over every narrower tier", () => {
      const scope = resolveRecruitmentVisibilityScope({
        isOrgWide: true,
        isAssigned: true,
        isSameDepartment: true,
        isSameBranch: true,
      });
      expect(scope).toBe("organization_wide");
    });

    it("falls back to assigned when not org-wide", () => {
      const scope = resolveRecruitmentVisibilityScope({
        isOrgWide: false,
        isAssigned: true,
        isSameDepartment: true,
        isSameBranch: true,
      });
      expect(scope).toBe("assigned");
    });

    it("falls back to department, then branch, in priority order", () => {
      expect(
        resolveRecruitmentVisibilityScope({
          isOrgWide: false,
          isAssigned: false,
          isSameDepartment: true,
          isSameBranch: true,
        }),
      ).toBe("department");

      expect(
        resolveRecruitmentVisibilityScope({
          isOrgWide: false,
          isAssigned: false,
          isSameDepartment: false,
          isSameBranch: true,
        }),
      ).toBe("branch");
    });

    it("returns null when no tier matches", () => {
      const scope = resolveRecruitmentVisibilityScope({
        isOrgWide: false,
        isAssigned: false,
        isSameDepartment: false,
        isSameBranch: false,
      });
      expect(scope).toBeNull();
    });
  });
});
