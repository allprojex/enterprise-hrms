import { useListMyOrganizations, getListMyOrganizationsQueryKey } from '@workspace/api-client-react';

/**
 * Whether the caller holds a role that, by the platform's standard role
 * templates, carries HR-administrator authority (org_admin/hr_manager/
 * super_admin) for `organizationId`. This is the same heuristic already
 * used independently across many pages (performance-cycles.tsx,
 * asset-workspace.tsx, attendance-register.tsx, etc.) — role KEYS are all
 * the frontend has today (see useListMyOrganizations), not the caller's
 * actual fine-grained permission grants, so a custom per-org role that
 * departs from the standard templates (e.g. an "employee" clone granted
 * employee.write) would not be reflected here. The backend's own
 * requirePermission checks remain the actual authority; this only controls
 * whether a control that would otherwise 403 is shown/enabled.
 */
export function useIsHrCapable(organizationId: number): boolean {
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  return currentOrg?.roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin') ?? false;
}
