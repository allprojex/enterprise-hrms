/**
 * Guards the role/permission seed definitions that back the Primary HR
 * Administrator model (lib/db/src/seed/roles-permissions-definitions.ts).
 *
 * The seed is idempotent (onConflictDoNothing) and additive; these tests pin
 * the SHAPE of what it inserts so the security properties the routes rely on
 * cannot drift silently:
 *
 *   - hr_administrator is a strict superset of hr_manager (a Primary HR who is
 *     an HR Administrator loses nothing an HR Manager has);
 *   - hr_administrator never carries an organization-level authority key, any
 *     payroll key, or a platform-restricted audit category;
 *   - every mapped key exists in the catalogue; hr_team.manage is catalogued.
 */
import { describe, it, expect } from "vitest";
import { SYSTEM_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "@workspace/db/seed/roles-permissions-definitions";
import { HR_DELEGATION_PROHIBITED_KEYS, PLATFORM_RESTRICTED_KEYS, isProhibitedForHrDelegation } from "../lib/roleDelegation";

const catalogue = new Set<string>(PERMISSIONS.map((p) => p.key));

describe("system role templates", () => {
  it("defines the five templates, including hr_administrator", () => {
    expect(SYSTEM_ROLES.map((r) => r.key).sort()).toEqual(
      ["employee", "hr_administrator", "hr_manager", "org_admin", "super_admin"].sort(),
    );
    const hrAdmin = SYSTEM_ROLES.find((r) => r.key === "hr_administrator");
    expect(hrAdmin?.label).toBe("HR Administrator");
  });

  it("maps permissions for every template", () => {
    for (const role of SYSTEM_ROLES) expect(ROLE_PERMISSIONS[role.key], role.key).toBeDefined();
  });
});

describe("permission catalogue", () => {
  it("contains hr_team.manage as a distinct, non-organization-level key", () => {
    const entry = PERMISSIONS.find((p) => p.key === "hr_team.manage");
    expect(entry).toMatchObject({ resource: "hr_team", action: "manage" });
    expect(isProhibitedForHrDelegation("hr_team.manage")).toBe(false);
  });

  it("has no duplicate keys", () => {
    expect(catalogue.size).toBe(PERMISSIONS.length);
  });

  it("only references catalogued keys from role mappings", () => {
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      for (const key of keys) expect(catalogue.has(key), `${role} -> ${key}`).toBe(true);
    }
  });

  it("catalogues every prohibited key that the delegation guard names", () => {
    // A prohibited key that no longer exists would silently stop protecting anything.
    for (const key of HR_DELEGATION_PROHIBITED_KEYS) expect(catalogue.has(key), key).toBe(true);
    for (const key of PLATFORM_RESTRICTED_KEYS) expect(catalogue.has(key), key).toBe(true);
  });
});

/**
 * WWM Employee Access Remediation (2026-09-07): the directory grant
 * (employee.read) stays with every template, but a colleague's personal
 * identity fields and personnel-document metadata now sit behind two
 * field-category keys that only HR-tier templates hold.
 */
describe("employee directory vs personal-data keys", () => {
  const keys = ["employee.sensitive.read", "employee.documents.read"] as const;

  it("catalogues both keys under the employee resource", () => {
    for (const key of keys) {
      const entry = PERMISSIONS.find((p) => p.key === key);
      expect(entry?.resource, key).toBe("employee");
    }
  });

  it("grants both to org_admin, hr_manager, hr_administrator and super_admin", () => {
    for (const role of ["org_admin", "hr_manager", "hr_administrator", "super_admin"]) {
      const held = new Set(ROLE_PERMISSIONS[role]);
      for (const key of keys) expect(held.has(key), `${role} -> ${key}`).toBe(true);
    }
  });

  it("keeps the employee template on the directory grant only — never the personal-data keys", () => {
    const employee = new Set(ROLE_PERMISSIONS.employee);
    expect(employee.has("employee.read")).toBe(true);
    for (const key of keys) expect(employee.has(key), key).toBe(false);
    expect(employee.has("employee.notes.read")).toBe(false);
    expect(employee.has("membership.read")).toBe(false);
  });
});

describe("hr_administrator template", () => {
  const hrAdmin = new Set(ROLE_PERMISSIONS.hr_administrator);
  const hrManager = ROLE_PERMISSIONS.hr_manager;

  it("is a strict superset of hr_manager", () => {
    for (const key of hrManager) expect(hrAdmin.has(key), key).toBe(true);
    expect(hrAdmin.size).toBeGreaterThan(hrManager.length);
  });

  it("holds hr_team.manage and membership.read but not membership.manage or role.manage", () => {
    expect(hrAdmin.has("hr_team.manage")).toBe(true);
    expect(hrAdmin.has("membership.read")).toBe(true);
    expect(hrAdmin.has("membership.manage")).toBe(false);
    expect(hrAdmin.has("role.manage")).toBe(false);
    expect(hrAdmin.has("primary_hr.manage")).toBe(false);
    expect(hrAdmin.has("organization.update")).toBe(false);
    expect(hrAdmin.has("module.manage")).toBe(false);
  });

  it("carries no key outside the HR delegation boundary (no payroll, no platform audit)", () => {
    const outside = [...hrAdmin].filter(isProhibitedForHrDelegation);
    expect(outside).toEqual([]);
    expect([...hrAdmin].some((k) => k.startsWith("payroll."))).toBe(false);
  });

  it("does not exceed org_admin on any organization-authority key", () => {
    const orgAdmin = new Set(ROLE_PERMISSIONS.org_admin);
    for (const key of ["membership.manage", "role.manage", "organization.update", "module.manage", "primary_hr.manage"]) {
      expect(orgAdmin.has(key), key).toBe(true);
      expect(hrAdmin.has(key), key).toBe(false);
    }
  });
});
