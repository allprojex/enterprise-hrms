import { useMemo } from 'react';
import { useListMyOrganizations, getListMyOrganizationsQueryKey } from '@workspace/api-client-react';

/**
 * What this membership may actually do — the one signal the dashboard, the
 * sidebar and every capability-gated control read.
 *
 * Authority in this product comes from TWO places, and a surface that consults
 * only one of them gets the answer wrong:
 *
 *   PERMISSIONS, the union of the membership's roles, exactly what
 *   requirePermission evaluates.
 *
 *   STRUCTURE, which is not a permission at all. A department head may act on
 *   their department's leave because of a live department_heads row; a manager
 *   sees their reports because of employees.reportingManagerId. The permission
 *   that looks like it should carry this — leave_request.approve — is held by
 *   EVERY employee and gates "may attempt", never "may act"
 *   (routes/leaveApprovals.ts states this outright). So permissions alone
 *   cannot tell a department head from an ordinary employee.
 *
 * Deliberately NOT role names. `isHrCapable` used to be a string-set test over
 * role keys, which is why an org_admin looked like HR and a department head
 * looked like nothing. Roles are how permissions are granted, never what the
 * server checks, and a tenant may rename or compose them freely.
 *
 * Fails closed: while the query is in flight, or if a field is absent, every
 * capability is false, so a gated control stays hidden rather than flashing in
 * and then failing server-side.
 *
 * This decides only what to SHOW. Every capability here is independently
 * enforced by the API on every request.
 */
export interface Capabilities {
  /** Effective permission keys for this membership. */
  permissions: ReadonlySet<string>;
  /** Holds every one of these permissions. */
  can: (...keys: string[]) => boolean;
  /** Holds at least one of these permissions. */
  canAny: (...keys: string[]) => boolean;
  /** Current head of at least one department (structural). */
  isDepartmentHead: boolean;
  /** At least one employee currently reports to them (structural). */
  hasDirectReports: boolean;
  /**
   * Currently holds valid delegated Office Inventory approval authority
   * (structural — office_inventory.approve alone only gates "may attempt").
   */
  isInventoryApprovalDelegate: boolean;
  /** Structural authority over other people, from either tier. */
  isManager: boolean;
  /**
   * Authorized for organization-wide HR operations. A capability, not a role:
   * it is true for anyone the server would actually let perform org-wide HR
   * work, and false for a department head who merely manages a team.
   */
  isHrOperational: boolean;
  /** Authorized for organization administration/governance. */
  isOrgAdministrator: boolean;
  /** The membership summary has not resolved yet — everything above is false. */
  isLoading: boolean;
}

/**
 * Org-wide HR operations. Any ONE of these means the server would already let
 * the caller see organization-level HR information, so the HR surface is
 * honest for them. `attendance.manage` and `personnel_file.read` are the two
 * the HR Command Centre's own attention cards gate on.
 */
const HR_OPERATIONAL_PERMISSIONS = [
  'employee.write',
  'attendance.manage',
  'personnel_file.read',
  'employment_lifecycle.manage',
  'leave_request.manage',
] as const;

/** Organization administration and governance. */
const ORG_ADMINISTRATION_PERMISSIONS = [
  'organization.manage',
  'role.manage',
  'module.manage',
  'audit.read',
] as const;

export function useCapabilities(organizationId: number): Capabilities {
  const { data, isLoading } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });

  return useMemo(() => {
    const membership = data?.find((m) => m.organizationId === organizationId);
    const permissions = new Set<string>(membership?.permissions ?? []);
    const can = (...keys: string[]) => keys.every((k) => permissions.has(k));
    const canAny = (...keys: string[]) => keys.some((k) => permissions.has(k));

    const isDepartmentHead = membership?.isDepartmentHead === true;
    const hasDirectReports = membership?.hasDirectReports === true;
    const isInventoryApprovalDelegate = membership?.isInventoryApprovalDelegate === true;

    return {
      permissions,
      can,
      canAny,
      isDepartmentHead,
      hasDirectReports,
      isInventoryApprovalDelegate,
      isManager: isDepartmentHead || hasDirectReports,
      isHrOperational: canAny(...HR_OPERATIONAL_PERMISSIONS),
      isOrgAdministrator: canAny(...ORG_ADMINISTRATION_PERMISSIONS),
      isLoading: organizationId > 0 && (isLoading || data === undefined),
    };
  }, [data, isLoading, organizationId]);
}
