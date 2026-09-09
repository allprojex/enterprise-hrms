/**
 * Pure-function coverage for lib/roleDelegation.ts — the ownership / template /
 * subset / prohibited-key rules that every membership and role route now
 * applies. Route-level (HTTP) enforcement is exercised adversarially in
 * hrTeamDelegation.security.test.ts; this file pins the rules themselves so a
 * future edit to the constant tables fails loudly.
 */
import { describe, it, expect } from "vitest";
import {
  HR_DELEGATION_PROHIBITED_KEYS,
  NON_ASSIGNABLE_TEMPLATE_KEYS,
  PLATFORM_RESTRICTED_KEYS,
  isProhibitedForHrDelegation,
  roleDelegationVerdict,
  permissionGrantVerdict,
  membershipScopeVerdict,
} from "../lib/roleDelegation";

const HR_KEYS = ["membership.read", "hr_team.manage", "employee.read", "employee.write", "organization.read"];

const hrTeam = { mode: "hr_team" as const, actorPermissions: new Set(HR_KEYS) };
const orgAdmin = {
  mode: "org_admin" as const,
  actorPermissions: new Set(["membership.manage", "role.manage", "organization.update"]),
};

describe("prohibited-key table", () => {
  it("keeps every organization-level authority key outside the HR boundary", () => {
    for (const key of [
      "organization.update",
      "module.manage",
      "primary_hr.manage",
      "role.manage",
      "membership.manage",
      "migration.manage",
      "migration.execute",
      "audit.read",
      "audit.read.security",
      "audit.read.platform_configuration",
      "audit.read.payroll",
    ]) {
      expect(HR_DELEGATION_PROHIBITED_KEYS, key).toContain(key);
      expect(isProhibitedForHrDelegation(key), key).toBe(true);
    }
  });

  it("treats the whole payroll namespace as prohibited", () => {
    expect(isProhibitedForHrDelegation("payroll.read")).toBe(true);
    expect(isProhibitedForHrDelegation("payroll.run.approve")).toBe(true);
    expect(isProhibitedForHrDelegation("payroll_like.read")).toBe(false);
  });

  it("does not prohibit ordinary HR keys", () => {
    for (const key of HR_KEYS) expect(isProhibitedForHrDelegation(key), key).toBe(false);
  });

  it("never lets the super_admin template through organization routes", () => {
    expect(NON_ASSIGNABLE_TEMPLATE_KEYS).toEqual(["super_admin"]);
  });

  it("marks the platform-only audit categories as restricted for org_admin grants", () => {
    expect(PLATFORM_RESTRICTED_KEYS).toEqual(["audit.read.security", "audit.read.platform_configuration"]);
  });
});

describe("roleDelegationVerdict", () => {
  const employee = { key: "employee", isSystemRole: true, permissionKeys: ["employee.read"] };
  const hrManager = { key: "hr_manager", isSystemRole: true, permissionKeys: ["employee.read", "employee.write"] };
  // The canonical HR template that replaced hr_manager (2026-09-09 consolidation).
  const hr = { key: "hr", isSystemRole: true, permissionKeys: ["employee.read", "employee.write"] };
  const orgAdminRole = { key: "org_admin", isSystemRole: true, permissionKeys: ["membership.manage", "employee.read"] };
  const superAdmin = { key: "super_admin", isSystemRole: true, permissionKeys: ["membership.manage"] };
  const payroll = { key: "payroll_clerk", isSystemRole: false, permissionKeys: ["payroll.read"] };
  const beyond = { key: "leave_admin", isSystemRole: false, permissionKeys: ["employee.read", "leave.approve"] };

  it("lets the HR team delegate narrow HR roles within its own boundary", () => {
    expect(roleDelegationVerdict(hrTeam, employee).ok).toBe(true);
    expect(roleDelegationVerdict(hrTeam, hr).ok).toBe(true);
  });

  it("refuses to ASSIGN a deprecated HR template but still allows revoking it", () => {
    // hr_manager was superseded by hr; existing holders must remain removable.
    expect(roleDelegationVerdict(hrTeam, hrManager).ok).toBe(false);
    expect(roleDelegationVerdict(hrTeam, hrManager, { intent: "revoke" }).ok).toBe(true);
  });

  it("denies the HR team any role carrying a prohibited key", () => {
    expect(roleDelegationVerdict(hrTeam, orgAdminRole)).toMatchObject({ ok: false });
    expect(roleDelegationVerdict(hrTeam, payroll)).toMatchObject({ ok: false });
  });

  it("denies the HR team any role reaching beyond what the actor holds (subset rule)", () => {
    expect(roleDelegationVerdict(hrTeam, beyond)).toMatchObject({ ok: false });
  });

  it("denies the super_admin template to everyone, including org_admin", () => {
    expect(roleDelegationVerdict(hrTeam, superAdmin)).toMatchObject({ ok: false });
    expect(roleDelegationVerdict(orgAdmin, superAdmin)).toMatchObject({ ok: false });
  });

  it("does not treat an organization-owned role that happens to be named super_admin as the template", () => {
    const copy = { key: "super_admin", isSystemRole: false, permissionKeys: ["employee.read"] };
    expect(roleDelegationVerdict(orgAdmin, copy).ok).toBe(true);
    expect(roleDelegationVerdict(hrTeam, copy).ok).toBe(true);
  });

  it("leaves org_admin behaviour otherwise unchanged", () => {
    expect(roleDelegationVerdict(orgAdmin, orgAdminRole).ok).toBe(true);
    expect(roleDelegationVerdict(orgAdmin, payroll).ok).toBe(true);
    expect(roleDelegationVerdict(orgAdmin, beyond).ok).toBe(true);
  });
});

describe("permissionGrantVerdict", () => {
  it("HR team may only grant keys it holds and that are not prohibited", () => {
    expect(permissionGrantVerdict(hrTeam, "employee.read").ok).toBe(true);
    expect(permissionGrantVerdict(hrTeam, "membership.manage")).toMatchObject({ ok: false });
    expect(permissionGrantVerdict(hrTeam, "payroll.read")).toMatchObject({ ok: false });
    expect(permissionGrantVerdict(hrTeam, "leave.approve")).toMatchObject({ ok: false });
  });

  it("org_admin may grant anything except platform-restricted keys it does not hold", () => {
    expect(permissionGrantVerdict(orgAdmin, "membership.manage").ok).toBe(true);
    expect(permissionGrantVerdict(orgAdmin, "payroll.read").ok).toBe(true);
    expect(permissionGrantVerdict(orgAdmin, "audit.read.security")).toMatchObject({ ok: false });
    const holder = { mode: "org_admin" as const, actorPermissions: new Set(["role.manage", "audit.read.security"]) };
    expect(permissionGrantVerdict(holder, "audit.read.security").ok).toBe(true);
  });
});

describe("membershipScopeVerdict", () => {
  it("HR team may only act on members entirely inside its boundary", () => {
    expect(membershipScopeVerdict(hrTeam, ["employee.read"]).ok).toBe(true);
    expect(membershipScopeVerdict(hrTeam, []).ok).toBe(true);
    expect(membershipScopeVerdict(hrTeam, ["employee.read", "membership.manage"])).toMatchObject({ ok: false });
    expect(membershipScopeVerdict(hrTeam, ["leave.approve"])).toMatchObject({ ok: false });
  });

  it("org_admin scope is unrestricted", () => {
    expect(membershipScopeVerdict(orgAdmin, ["membership.manage", "payroll.read"]).ok).toBe(true);
  });
});
