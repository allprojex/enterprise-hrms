/**
 * form_submission.create_on_behalf — who is granted it by the seeded role
 * definitions. Assisted completion is an exception path, so the key is
 * registered once and granted to the canonical HR role only:
 *
 *   - not org_admin (organization administration is not HR delegation of form
 *     completion), not the deprecated hr_manager/hr_administrator, not employee,
 *     and not any other seeded role;
 *   - form.assess — held by org_admin and the HR roles — does not imply it;
 *   - super_admin receives it only through the platform's pre-existing
 *     all-permissions blanket grant, the same as every other key.
 */
import { describe, it, expect } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, CANONICAL_HR_ROLE_KEY } from "@workspace/db/seed/roles-permissions-definitions";

const KEY = "form_submission.create_on_behalf";

describe("form_submission.create_on_behalf grants", () => {
  it("is registered exactly once", () => {
    expect(PERMISSIONS.filter((p) => p.key === KEY)).toHaveLength(1);
  });

  it("is granted to the canonical hr role", () => {
    expect(CANONICAL_HR_ROLE_KEY).toBe("hr");
    expect(ROLE_PERMISSIONS.hr).toContain(KEY);
  });

  it("is not granted to org_admin, the deprecated HR roles or employee — even though they hold form.assess", () => {
    for (const role of ["org_admin", "hr_manager", "hr_administrator", "employee"] as const) {
      expect(ROLE_PERMISSIONS[role], role).toBeDefined();
      expect(ROLE_PERMISSIONS[role], role).not.toContain(KEY);
    }
    expect(ROLE_PERMISSIONS.org_admin).toContain("form.assess");
  });

  it("reaches no other seeded role except super_admin's all-permissions blanket grant", () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, keys]) => (keys as readonly string[]).includes(KEY))
      .map(([role]) => role)
      .sort();
    expect(holders).toEqual(["hr", "super_admin"]);
    expect(ROLE_PERMISSIONS.super_admin).toHaveLength(PERMISSIONS.length);
  });
});
