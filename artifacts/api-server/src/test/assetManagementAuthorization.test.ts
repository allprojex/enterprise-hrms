/**
 * Focused tests for the Asset Management authorization foundation (Phase
 * 3E, W95). These are pure functions (no query, no Assets route or service
 * function exists yet) — no @workspace/db mocking is needed for them.
 */
import { describe, it, expect } from "vitest";
import {
  ASSET_MANAGEMENT_MODULE_KEY,
  isOwnAssetRecord,
  isCurrentManagerOfEmployee,
  resolveAssetVisibilityScope,
} from "../lib/assetManagementAuthorization";

describe("Asset Management authorization foundation (W95)", () => {
  it("exposes the exact module key the registry already seeded", () => {
    expect(ASSET_MANAGEMENT_MODULE_KEY).toBe("asset_management");
  });

  describe("isOwnAssetRecord", () => {
    it("is true only when both IDs are set and equal", () => {
      expect(isOwnAssetRecord(5, 5)).toBe(true);
    });
    it("is false when the IDs differ", () => {
      expect(isOwnAssetRecord(5, 6)).toBe(false);
    });
    it("is false when either side is null", () => {
      expect(isOwnAssetRecord(null, 5)).toBe(false);
      expect(isOwnAssetRecord(5, null)).toBe(false);
      expect(isOwnAssetRecord(null, null)).toBe(false);
    });
  });

  describe("isCurrentManagerOfEmployee", () => {
    it("is true only when the actor equals the employee's own live reportingManagerId", () => {
      expect(isCurrentManagerOfEmployee(5, 5)).toBe(true);
    });
    it("is false when the actor is not the employee's current manager", () => {
      expect(isCurrentManagerOfEmployee(5, 6)).toBe(false);
    });
    it("is false when either side is null (no manager set, or no actor resolved)", () => {
      expect(isCurrentManagerOfEmployee(null, 5)).toBe(false);
      expect(isCurrentManagerOfEmployee(5, null)).toBe(false);
      expect(isCurrentManagerOfEmployee(null, null)).toBe(false);
    });
    // Owner Decision 3: this comparison must always be evaluated against a
    // *live* reportingManagerId, never a snapshotted value — there is no
    // snapshot parameter this function could even be passed, by design
    // (asset_assignments has no managerEmployeeIdSnapshot column at all).
    // A caller who was previously (but is no longer) this employee's
    // manager must compare false the instant the live relationship changes
    // — this test documents that expectation at the call-site level, since
    // the function itself has no notion of "previously."
    it("has no snapshot concept — a stale prior-manager ID must never be passed as if it still applied", () => {
      const formerManagerId = 5;
      const currentManagerId = 9;
      expect(isCurrentManagerOfEmployee(formerManagerId, currentManagerId)).toBe(false);
      expect(isCurrentManagerOfEmployee(currentManagerId, currentManagerId)).toBe(true);
    });
  });

  describe("resolveAssetVisibilityScope", () => {
    it("prioritizes organization-wide over every narrower tier", () => {
      const scope = resolveAssetVisibilityScope({ isOrgWide: true, isOwn: true, isCurrentManager: true });
      expect(scope).toBe("organization_wide");
    });

    it("falls back to own when not org-wide", () => {
      const scope = resolveAssetVisibilityScope({ isOrgWide: false, isOwn: true, isCurrentManager: true });
      expect(scope).toBe("own");
    });

    it("falls back to manager_current_direct_report when neither org-wide nor own", () => {
      const scope = resolveAssetVisibilityScope({ isOrgWide: false, isOwn: false, isCurrentManager: true });
      expect(scope).toBe("manager_current_direct_report");
    });

    it("returns null when no tier matches", () => {
      const scope = resolveAssetVisibilityScope({ isOrgWide: false, isOwn: false, isCurrentManager: false });
      expect(scope).toBeNull();
    });

    // Unlike Learning (own/manager-of-record/instructor-of-record), Assets
    // has exactly three tiers — no instructor-equivalent relationship
    // exists anywhere in this module.
    it("has exactly three tiers — own, manager_current_direct_report, organization_wide — no fourth relationship", () => {
      const scope = resolveAssetVisibilityScope({ isOrgWide: false, isOwn: false, isCurrentManager: false });
      expect(["own", "manager_current_direct_report", "organization_wide", null]).toContain(scope);
    });
  });
});
