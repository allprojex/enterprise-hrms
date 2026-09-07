import { useListMyOrganizations, getListMyOrganizationsQueryKey } from '@workspace/api-client-react';

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

const HR_CAPABLE_ROLES = new Set(['org_admin', 'hr_manager', 'super_admin']);

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
  return roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin');
}

/**
 * Whether the caller may manage the organization's HR team through the
 * Primary HR delegation path: they hold the hr_administrator system role AND
 * are the organization's active Primary HR. Mirrors the backend's
 * requireDelegationAuthority (hr_team.manage + active Primary HR) using the
 * two signals the frontend has (role keys and isPrimaryHr). The server is
 * authoritative — this only decides which affordances to show.
 */
export function useCanManageHrTeam(organizationId: number): boolean {
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  if (!currentOrg) return false;
  return currentOrg.isPrimaryHr === true && currentOrg.roles.includes('hr_administrator');
}
