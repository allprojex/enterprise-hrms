import { describe, it, expect } from "vitest";
import { isSuperAdmin } from "../lib/authorization";

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
