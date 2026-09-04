/**
 * Role delegation authority (Primary HR Administrator + controlled HR-team
 * delegation, 2026-09-04) and the privilege-escalation guards that protect
 * EVERY membership/role route, for every actor.
 *
 * Two authorities may administer members and roles inside an organization:
 *
 *   org_admin path — the actor holds the unscoped administrative key the
 *     route has always required (`membership.manage` for member routes,
 *     `role.manage` for role routes). Legitimate organization administration,
 *     now subject to the ownership and template rules below.
 *
 *   hr_team path  — the actor holds `hr_team.manage` AND is the organization's
 *     current active Primary HR (primary_hr_assignments). The designation is
 *     therefore an authorization boundary, not just metadata: holding the key
 *     without being Primary HR, or being Primary HR without the key, grants
 *     nothing. Under this path the actor may only delegate what they
 *     themselves hold (subset rule) and never anything administrative
 *     (prohibited keys), so there is no way to compose, copy or assign a role
 *     that reaches beyond the HR boundary — including for themselves.
 *
 * Rules that apply to BOTH paths (they close pre-existing escalation gaps):
 *   1. a role is assignable only if it is a system template or is owned by
 *      the organization of the target membership — cross-tenant role
 *      assignment always fails;
 *   2. the `super_admin` membership-role template is never assignable through
 *      organization routes (platform authority is `users.role`, a separate
 *      mechanism, and stays that way);
 *   3. a permission may be granted to an organization role only if the actor
 *      is authorized to grant it: org_admin may grant anything except the
 *      platform-restricted keys it does not itself hold; hr_team may grant
 *      only keys it holds and that are not prohibited.
 *
 * Delegability is derived from a role's ACTUAL permission set at request
 * time — never from its name — so renaming or re-composing a role cannot
 * smuggle authority. The UI's `delegable` flag is convenience only; these
 * functions are the authority.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, rolesTable, rolePermissionsTable, permissionsTable, organizationMembershipsTable } from "@workspace/db";
import { getEffectivePermissions } from "./permissions";
import { getActivePrimaryHr } from "./primaryHr";
import type { MembershipRequest } from "../middlewares/requireMembership";

export const HR_TEAM_MANAGE = "hr_team.manage";

/** Membership-role templates that no organization route may ever assign. */
export const NON_ASSIGNABLE_TEMPLATE_KEYS: readonly string[] = ["super_admin"];

/**
 * Keys that must never be delegated through the HR-team path — organization
 * identity/entitlement, member/role administration, Primary HR reassignment,
 * bulk migration, platform-wide/security audit, and (owner decision, this
 * stage) payroll. Exact keys plus the prefixes below.
 */
export const HR_DELEGATION_PROHIBITED_KEYS: readonly string[] = [
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
];
const HR_DELEGATION_PROHIBITED_PREFIXES: readonly string[] = ["payroll."];

/** Keys an org_admin may not grant to organization roles unless it holds them itself (platform-restricted). */
export const PLATFORM_RESTRICTED_KEYS: readonly string[] = ["audit.read.security", "audit.read.platform_configuration"];

export function isProhibitedForHrDelegation(key: string): boolean {
  return HR_DELEGATION_PROHIBITED_KEYS.includes(key) || HR_DELEGATION_PROHIBITED_PREFIXES.some((p) => key.startsWith(p));
}

export type DelegationMode = "org_admin" | "hr_team";

export interface DelegationAuthority {
  mode: DelegationMode;
  organizationId: number;
  /** The actor's own effective permission keys (membership roles, or break-glass scope). */
  actorPermissions: ReadonlySet<string>;
  actorMembershipId: number | null;
}

export interface Verdict {
  ok: boolean;
  reason?: string;
}

/** Pure: may this authority assign/revoke a role with these permission keys? */
export function roleDelegationVerdict(
  authority: Pick<DelegationAuthority, "mode" | "actorPermissions">,
  role: { key: string; isSystemRole: boolean; permissionKeys: readonly string[] },
): Verdict {
  if (role.isSystemRole && NON_ASSIGNABLE_TEMPLATE_KEYS.includes(role.key)) {
    return { ok: false, reason: `The ${role.key} template cannot be assigned through organization routes` };
  }
  if (authority.mode === "org_admin") return { ok: true };
  const prohibited = role.permissionKeys.find(isProhibitedForHrDelegation);
  if (prohibited) return { ok: false, reason: `Role contains a permission outside the HR boundary (${prohibited})` };
  const missing = role.permissionKeys.find((k) => !authority.actorPermissions.has(k));
  if (missing) return { ok: false, reason: `Role contains a permission you do not hold (${missing})` };
  return { ok: true };
}

/** Pure: may this authority grant `key` to an organization-owned role? */
export function permissionGrantVerdict(
  authority: Pick<DelegationAuthority, "mode" | "actorPermissions">,
  key: string,
): Verdict {
  if (authority.mode === "org_admin") {
    if (PLATFORM_RESTRICTED_KEYS.includes(key) && !authority.actorPermissions.has(key)) {
      return { ok: false, reason: `Permission ${key} is platform-restricted` };
    }
    return { ok: true };
  }
  if (isProhibitedForHrDelegation(key)) return { ok: false, reason: `Permission ${key} is outside the HR boundary` };
  if (!authority.actorPermissions.has(key)) return { ok: false, reason: `You do not hold permission ${key}` };
  return { ok: true };
}

/** Pure: may this authority act on (revoke roles from / revoke) a membership holding these keys? */
export function membershipScopeVerdict(
  authority: Pick<DelegationAuthority, "mode" | "actorPermissions">,
  targetPermissionKeys: readonly string[],
): Verdict {
  if (authority.mode === "org_admin") return { ok: true };
  const outside = targetPermissionKeys.find((k) => isProhibitedForHrDelegation(k) || !authority.actorPermissions.has(k));
  if (outside) return { ok: false, reason: `Member holds authority outside your HR boundary (${outside})` };
  return { ok: true };
}

/** The actor's effective keys: membership roles, or the break-glass grant's explicit scope. */
export async function effectivePermissionsForRequest(req: MembershipRequest): Promise<ReadonlySet<string>> {
  if (req.membership) return getEffectivePermissions(req.membership.id);
  if (req.breakGlassGrant) return new Set(req.breakGlassGrant.scope);
  return new Set();
}

/**
 * Resolves which delegation path (if any) the request may use for a route whose
 * traditional unscoped key is `adminKey` (`membership.manage` or `role.manage`).
 */
export async function resolveDelegationAuthority(
  req: MembershipRequest,
  adminKey: "membership.manage" | "role.manage",
): Promise<DelegationAuthority | null> {
  const organizationId = req.membership?.organizationId ?? req.breakGlassGrant?.targetOrganizationId;
  if (organizationId == null) return null;
  const actorPermissions = await effectivePermissionsForRequest(req);
  const actorMembershipId = req.membership?.id ?? null;
  if (actorPermissions.has(adminKey)) return { mode: "org_admin", organizationId, actorPermissions, actorMembershipId };
  if (actorPermissions.has(HR_TEAM_MANAGE) && actorMembershipId != null) {
    const primary = await getActivePrimaryHr(organizationId);
    if (primary && primary.membershipId === actorMembershipId) {
      return { mode: "hr_team", organizationId, actorPermissions, actorMembershipId };
    }
  }
  return null;
}

export interface AssignableRole {
  id: number;
  key: string;
  label: string;
  organizationId: number | null;
  isSystemRole: boolean;
  permissionKeys: string[];
}

/**
 * Loads a role for assignment/revocation in `organizationId`: a system template
 * (organizationId null, isSystemRole true) or a role owned by this organization.
 * Any other role — including another tenant's — is reported as absent.
 */
export async function loadAssignableRole(organizationId: number, roleId: number): Promise<AssignableRole | null> {
  const [role] = await db
    .select()
    .from(rolesTable)
    .where(
      and(
        eq(rolesTable.id, roleId),
        or(and(isNull(rolesTable.organizationId), eq(rolesTable.isSystemRole, true)), eq(rolesTable.organizationId, organizationId)),
      ),
    )
    .limit(1);
  if (!role) return null;
  const keys = await permissionKeysForRoles([role.id]);
  return {
    id: role.id,
    key: role.key,
    label: role.label,
    organizationId: role.organizationId,
    isSystemRole: role.isSystemRole,
    permissionKeys: keys.get(role.id) ?? [],
  };
}

export async function permissionKeysForRoles(roleIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (roleIds.length === 0) return out;
  const rows = await db
    .select({ roleId: rolePermissionsTable.roleId, key: permissionsTable.key })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(inArray(rolePermissionsTable.roleId, roleIds));
  for (const row of rows) {
    const list = out.get(row.roleId) ?? [];
    list.push(row.key);
    out.set(row.roleId, list);
  }
  return out;
}

/** Effective permission keys of a membership in `organizationId`, or null if it is not that organization's membership. */
export async function effectivePermissionsOfMembership(
  organizationId: number,
  membershipId: number,
): Promise<ReadonlySet<string> | null> {
  const [membership] = await db
    .select({ id: organizationMembershipsTable.id })
    .from(organizationMembershipsTable)
    .where(and(eq(organizationMembershipsTable.id, membershipId), eq(organizationMembershipsTable.organizationId, organizationId)))
    .limit(1);
  if (!membership) return null;
  return getEffectivePermissions(membershipId);
}
