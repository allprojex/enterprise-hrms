import { describe, it, expect } from "vitest";
import { canAccessOrganization, isSuperAdmin } from "../lib/authorization";

function makeUser(overrides: Partial<{ role: string; organizationId: number }> = {}) {
  return {
    role: "employee",
    organizationId: 1,
    ...overrides,
  } as Parameters<typeof isSuperAdmin>[0];
}

describe("isSuperAdmin", () => {
  it("is true only for the super_admin role", () => {
    expect(isSuperAdmin(makeUser({ role: "super_admin" }))).toBe(true);
    expect(isSuperAdmin(makeUser({ role: "org_admin" }))).toBe(false);
    expect(isSuperAdmin(makeUser({ role: "hr_manager" }))).toBe(false);
    expect(isSuperAdmin(makeUser({ role: "employee" }))).toBe(false);
  });
});

describe("canAccessOrganization", () => {
  it("allows a user to access their own organization", () => {
    const user = makeUser({ role: "employee", organizationId: 5 });
    expect(canAccessOrganization(user, 5)).toBe(true);
  });

  it("denies a user access to a different organization", () => {
    const user = makeUser({ role: "employee", organizationId: 5 });
    expect(canAccessOrganization(user, 6)).toBe(false);
  });

  it("denies org_admin and hr_manager access to a different organization", () => {
    expect(canAccessOrganization(makeUser({ role: "org_admin", organizationId: 1 }), 2)).toBe(false);
    expect(canAccessOrganization(makeUser({ role: "hr_manager", organizationId: 1 }), 2)).toBe(false);
  });

  it("allows super_admin to access any organization", () => {
    const user = makeUser({ role: "super_admin", organizationId: 1 });
    expect(canAccessOrganization(user, 999)).toBe(true);
  });
});
