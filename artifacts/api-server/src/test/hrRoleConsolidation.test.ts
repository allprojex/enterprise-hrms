/**
 * Enterprise HR role consolidation (owner architecture decision, 2026-09-09).
 *
 * One canonical operational HR role (`hr`). It must carry real HR authority —
 * including HR form governance, which is what WS-26 was missing — while never
 * acquiring organization governance, platform control, payroll, or anything a
 * licence/module gate is responsible for. These are pure-data assertions over
 * the seeded role templates plus the delegation chokepoint, so they hold
 * regardless of what any particular database happens to contain.
 */
import { describe, it, expect } from "vitest";
import {
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  PERMISSIONS,
  DEPRECATED_ROLE_KEYS,
  CANONICAL_HR_ROLE_KEY,
  ORG_GOVERNANCE_ONLY_KEYS,
} from "@workspace/db/seed/roles-permissions-definitions";
import { roleDelegationVerdict, NON_ASSIGNABLE_TEMPLATE_KEYS } from "../lib/roleDelegation";

const keys = (role: string) => new Set(ROLE_PERMISSIONS[role] ?? []);
const hr = keys(CANONICAL_HR_ROLE_KEY);
const orgAdmin = keys("org_admin");
const hrAdministrator = keys("hr_administrator");
const hrManager = keys("hr_manager");
const employee = keys("employee");
const superAdmin = keys("super_admin");
const catalogue = PERMISSIONS.map((p) => p.key);

describe("canonical HR role — authority it must have", () => {
  it("can administer employees and their records", () => {
    for (const key of ["employee.read", "employee.write", "employee.sensitive.read", "employee.documents.read"]) {
      expect(hr.has(key), key).toBe(true);
    }
  });

  it("can administer leave, performance, onboarding/offboarding and learning", () => {
    for (const key of [
      "leave_request.manage",
      "leave_request.approve",
      "leave_type.manage",
      "onboarding.configure",
      "offboarding.configure",
      "employment_lifecycle.configure",
    ]) {
      expect(hr.has(key), key).toBe(true);
    }
  });

  it("can manage AND publish HR form templates — the WS-26 gap this decision closes", () => {
    expect(hr.has("form_template.manage")).toBe(true);
    expect(hr.has("form_template.publish")).toBe(true);
    // and the rest of the form lifecycle it is expected to run
    for (const key of ["form.read", "form.approve", "form.finalize", "form.signature.apply", "form.final.read"]) {
      expect(hr.has(key), key).toBe(true);
    }
  });

  it("can delegate within the HR team", () => {
    expect(hr.has("hr_team.manage")).toBe(true);
  });

  it("never drops below either deprecated role — nobody loses authority when migrated", () => {
    for (const key of hrAdministrator) expect(hr.has(key), `hr_administrator key missing from hr: ${key}`).toBe(true);
    for (const key of hrManager) expect(hr.has(key), `hr_manager key missing from hr: ${key}`).toBe(true);
  });
});

describe("canonical HR role — authority it must NOT have", () => {
  it("is not org_admin: no organization-governance keys", () => {
    for (const key of ORG_GOVERNANCE_ONLY_KEYS) {
      expect(hr.has(key), `hr must not hold governance key ${key}`).toBe(false);
    }
    // Specifically: being HR never confers member/role administration or
    // Primary HR reassignment.
    expect(hr.has("membership.manage")).toBe(false);
    expect(hr.has("role.manage")).toBe(false);
    expect(hr.has("primary_hr.manage")).toBe(false);
    expect(hr.has("organization.update")).toBe(false);
    expect(hr.has("module.manage")).toBe(false);
  });

  it("holds no payroll authority (separately licensed module)", () => {
    expect([...hr].filter((k) => k.startsWith("payroll."))).toEqual([]);
    expect(hr.has("audit.read.payroll")).toBe(false);
  });

  it("holds no platform/security control-plane authority", () => {
    for (const key of ["audit.read", "audit.read.security", "audit.read.platform_configuration", "migration.manage", "migration.execute"]) {
      expect(hr.has(key), key).toBe(false);
    }
  });

  it("is strictly smaller than super_admin and never equal to it", () => {
    expect(hr.size).toBeLessThan(superAdmin.size);
    expect(superAdmin.size).toBe(catalogue.length);
  });

  it("grants HR no key that is absent from the catalogue", () => {
    const known = new Set(catalogue);
    for (const key of hr) expect(known.has(key), key).toBe(true);
  });
});

describe("least privilege elsewhere is unchanged", () => {
  it("the employee template gains nothing from this consolidation", () => {
    expect(employee.has("form_template.manage")).toBe(false);
    expect(employee.has("form_template.publish")).toBe(false);
    expect(employee.has("employee.sensitive.read")).toBe(false);
    expect(employee.has("employee.documents.read")).toBe(false);
    expect(employee.has("hr_team.manage")).toBe(false);
    for (const key of ORG_GOVERNANCE_ONLY_KEYS) expect(employee.has(key), key).toBe(false);
  });

  it("org_admin keeps organization governance and does not lose form publishing", () => {
    for (const key of ORG_GOVERNANCE_ONLY_KEYS) expect(orgAdmin.has(key), key).toBe(true);
    expect(orgAdmin.has("form_template.publish")).toBe(true);
  });

  it("org_admin is not silently turned into HR: hr_team.manage stays out of it", () => {
    expect(orgAdmin.has("hr_team.manage")).toBe(false);
  });
});

describe("deprecated HR templates", () => {
  const template = (key: string) => ({
    key,
    isSystemRole: true,
    permissionKeys: [...keys(key)],
  });
  const orgAdminAuthority = { mode: "org_admin" as const, actorPermissions: new Set(catalogue) };

  it("can no longer be ASSIGNED, even by an org_admin", () => {
    for (const key of DEPRECATED_ROLE_KEYS) {
      const verdict = roleDelegationVerdict(orgAdminAuthority, template(key));
      expect(verdict.ok, key).toBe(false);
      expect(verdict.reason, key).toMatch(/deprecated/i);
    }
  });

  it("can still be REVOKED, so existing holders can be migrated off them", () => {
    for (const key of DEPRECATED_ROLE_KEYS) {
      expect(roleDelegationVerdict(orgAdminAuthority, template(key), { intent: "revoke" }).ok, key).toBe(true);
    }
  });

  it("defaults to the strict answer when no intent is given", () => {
    expect(roleDelegationVerdict(orgAdminAuthority, template("hr_administrator")).ok).toBe(false);
  });

  it("the canonical HR role remains assignable", () => {
    expect(roleDelegationVerdict(orgAdminAuthority, template(CANONICAL_HR_ROLE_KEY)).ok).toBe(true);
  });

  it("super_admin remains non-assignable through organization routes", () => {
    expect(NON_ASSIGNABLE_TEMPLATE_KEYS).toContain("super_admin");
    expect(roleDelegationVerdict(orgAdminAuthority, template("super_admin")).ok).toBe(false);
  });

  it("still exist as templates, so historical audit references stay interpretable", () => {
    for (const key of DEPRECATED_ROLE_KEYS) {
      expect(SYSTEM_ROLES.some((r) => r.key === key), key).toBe(true);
      expect(ROLE_PERMISSIONS[key], key).toBeDefined();
    }
  });
});

describe("HR-team delegation boundary still holds for the canonical role", () => {
  // An HR actor delegating through the hr_team path may only pass on what it
  // holds, and never a prohibited key. Since `hr` holds no governance key, a
  // role composed of HR's own keys can never carry governance either.
  const hrAuthority = { mode: "hr_team" as const, actorPermissions: hr };

  it("HR cannot delegate a role containing organization governance", () => {
    const adminish = { key: "custom_admin", isSystemRole: false, permissionKeys: ["employee.read", "role.manage"] };
    const verdict = roleDelegationVerdict(hrAuthority, adminish);
    expect(verdict.ok).toBe(false);
  });

  it("HR can delegate a role that is a subset of its own HR authority", () => {
    const hrIsh = { key: "custom_hr_helper", isSystemRole: false, permissionKeys: ["employee.read", "leave_request.approve"] };
    expect(roleDelegationVerdict(hrAuthority, hrIsh).ok).toBe(true);
  });

  it("HR cannot delegate form publishing it would not itself hold", () => {
    const notHeld = { key: "x", isSystemRole: false, permissionKeys: ["payroll.run.approve"] };
    expect(roleDelegationVerdict(hrAuthority, notHeld).ok).toBe(false);
  });
});
