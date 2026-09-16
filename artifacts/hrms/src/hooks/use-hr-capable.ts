import { useListMyOrganizations, getListMyOrganizationsQueryKey, type MembershipSummary } from '@workspace/api-client-react';
import { resolveAdministrationAccess, type AdministrationAccess } from '@/lib/administration-access';

/**
 * Shared role lookup underlying both useIsOrgAdmin/useIsHrCapable below —
 * the single place this org membership fetch happens, so app-shell.tsx's
 * sidebar and every page-level gate read the exact same roles array rather
 * than each independently re-deriving it (previously duplicated inline in
 * app-shell.tsx).
 */
function useMyRolesState(organizationId: number): { roles: string[]; isLoading: boolean } {
  const { data: myOrganizations, isLoading } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  return { roles: currentOrg?.roles ?? [], isLoading: organizationId > 0 && (isLoading || myOrganizations === undefined) };
}

function useMyRoles(organizationId: number): string[] {
  return useMyRolesState(organizationId).roles;
}

/**
 * Role keys that carry HR-administrator authority by the platform's standard
 * templates. `hr` is the canonical HR role (2026-09-09 consolidation);
 * `hr_administrator` and `hr_manager` are its deprecated predecessors, kept
 * here so existing holders are not locked out of HR surfaces before their
 * assignments are migrated — and because `hr_administrator` was missing from
 * these checks entirely, which silently denied HR surfaces to the platform's
 * own principal-HR role. Exported as the single definition: the pages that
 * used to inline this list now call isHrCapableRole.
 */
export const HR_CAPABLE_ROLES: ReadonlySet<string> = new Set([
  'hr',
  'org_admin',
  'super_admin',
  'hr_administrator',
  'hr_manager',
]);

/** Whether any of `roles` carries HR-administrator authority. */
export function isHrCapableRole(roles: readonly string[] | undefined): boolean {
  return roles?.some((r) => HR_CAPABLE_ROLES.has(r)) ?? false;
}

/**
 * Same heuristic as useIsHrCapable, plus whether the role lookup is still
 * in flight — for a page-level guard that must not redirect a legitimate HR
 * caller during the first render before /me/organizations has answered
 * (WWM Employee Access Remediation, 2026-09-07: /form-templates). The
 * server remains authoritative; this only decides whether the
 * administrative page is shown at all.
 */
export function useHrCapability(organizationId: number): { isHrCapable: boolean; isLoading: boolean } {
  const { roles, isLoading } = useMyRolesState(organizationId);
  return { isHrCapable: roles.some((r) => HR_CAPABLE_ROLES.has(r)), isLoading };
}

/** Whether the caller holds the org_admin or super_admin system role for `organizationId`. */
export function useIsOrgAdmin(organizationId: number): boolean {
  const roles = useMyRoles(organizationId);
  return roles.some((r) => r === 'org_admin' || r === 'super_admin');
}

/**
 * Whether the caller holds a role that, by the platform's standard role
 * templates, carries HR-administrator authority (org_admin/hr_manager/
 * super_admin) for `organizationId`. This is the same heuristic already
 * used independently across many pages (performance-cycles.tsx,
 * asset-workspace.tsx, attendance-register.tsx, app-shell.tsx's sidebar,
 * etc.) — role KEYS are all the frontend has today (see
 * useListMyOrganizations), not the caller's actual fine-grained permission
 * grants, so a custom per-org role that departs from the standard
 * templates (e.g. an "employee" clone granted employee.write, or an
 * Inventory-only role holding office_inventory.reports.read without
 * hr_manager) would not be reflected here.
 *
 * Do NOT reach for this hook where the backend's own authority is actually
 * permission-scoped rather than role-shaped (e.g. asset/inventory/employee
 * dashboard aggregates, gated by asset_management.reports.read/
 * office_inventory.reports.read/employee.write respectively, which a
 * custom role can hold independently of hr_manager) — for those, the
 * correct signal is the backend's own null-vs-real-data response, not this
 * heuristic. This hook is for UI affordances where the backend's real gate
 * already is exactly org_admin/hr_manager/super_admin (employee.write,
 * branch.manage, department.manage, position.manage all happen to be
 * granted to exactly that role set today), or for genuinely decorative
 * surfaces where a role-heuristic mismatch has no data-exposure
 * consequence.
 */
export function useIsHrCapable(organizationId: number): boolean {
  const roles = useMyRoles(organizationId);
  return isHrCapableRole(roles);
}

/**
 * The caller's own membership summary for `organizationId` (roles, effective
 * permissions, Primary HR status), or undefined while loading / when the
 * caller is not a member. Same self-scoped GET /me/organizations source every
 * hook in this file reads.
 */
export function useMyMembership(organizationId: number): MembershipSummary | undefined {
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });
  return myOrganizations?.find((m) => m.organizationId === organizationId);
}

/**
 * Administration navigation permission gating (2026-09-07): what
 * administrative entries the caller may be shown for `organizationId`,
 * resolved from their EFFECTIVE permission keys (MembershipSummary.permissions)
 * rather than role names — see lib/administration-access.ts for the rule.
 * `isPlatformSuperAdmin` is users.role === 'super_admin' (GET /auth/me), the
 * platform bootstrap identity, and only widens the Organisations control
 * plane entry exactly as before; it adds no console bypass. The server is
 * authoritative — this only decides which affordances to show.
 */
export function useAdministrationAccess(organizationId: number, isPlatformSuperAdmin: boolean): AdministrationAccess {
  const membership = useMyMembership(organizationId);
  return resolveAdministrationAccess({ isPlatformSuperAdmin, membership });
}

/**
 * Whether the caller's EFFECTIVE permissions include at least one of
 * `permissionKeys` for `organizationId`. Reads MembershipSummary.permissions —
 * the same explicit-capability source useAdministrationAccess uses — never a
 * role name, so an organization-defined custom role is recognised the moment it
 * is granted the key. The server remains authoritative; this only decides which
 * affordances to show.
 */
export function useHasAnyPermission(organizationId: number, permissionKeys: readonly string[]): boolean {
  const membership = useMyMembership(organizationId);
  const granted = membership?.permissions;
  if (!granted) return false;
  return permissionKeys.some((key) => granted.includes(key));
}

/**
 * Whether the caller may manage the organization's HR team through the
 * Primary HR delegation path: they hold hr_team.manage AND are the
 * organization's active Primary HR — exactly the backend's
 * requireDelegationAuthority hr_team path, read from the caller's effective
 * permissions (no longer inferred from the hr_administrator role name). The
 * server is authoritative — this only decides which affordances to show.
 */
export function useCanManageHrTeam(organizationId: number): boolean {
  return useAdministrationAccess(organizationId, false).canManageHrTeam;
}
