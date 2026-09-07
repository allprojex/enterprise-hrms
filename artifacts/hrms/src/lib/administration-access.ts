/**
 * Administration navigation permission gating (2026-09-07).
 *
 * Production defect: every organization member — including ordinary
 * employees with only self-service permissions — saw an "Administration"
 * sidebar group, because its "Organisations" entry was unconditional and
 * the group renders whenever it has at least one visible child.
 *
 * The rule this module encodes, for every Administration entry:
 *
 *   entry visible  <=>  the caller holds at least one EFFECTIVE permission
 *                       that the entry's destination actually requires
 *                       (and, where the entry is module-gated, the active
 *                       organization has the module enabled — applied by
 *                       the shell's shared MODULE_BY_HREF filter).
 *
 * Membership alone, and the `employee` role name alone, grant nothing here.
 * Conversely, an employee delegated one administrative capability through
 * a custom role sees exactly the entry that capability unlocks and nothing
 * else — which is why this is keyed on permission keys and never on
 * `role === "employee"`. Effective permissions come from GET
 * /me/organizations (MembershipSummary.permissions), computed server-side
 * from the same role grants requirePermission evaluates. The server remains
 * the authority on every request; this only decides what to advertise.
 *
 * Pure functions, no React, so the rule is unit-testable in isolation.
 */

/**
 * The organization administration console (/admin/:organizationId). Its
 * tabs are backed by these server gates, and exactly these keys are the
 * "pure organization administration" authorities the platform withholds
 * from every non-org_admin standard role (membership.manage / role.manage
 * via requireDelegationAuthority's org_admin path, module.manage,
 * primary_hr.manage, organization.update). Read-only keys such as
 * membership.read or organization.read are deliberately NOT here: holding
 * them lets a caller *see* data the console also shows, but unlocks no
 * administrative action, and the platform's standard hr_manager /
 * hr_administrator / employee roles hold them without being administrators.
 */
export const ORGANIZATION_ADMINISTRATION_PERMISSIONS: readonly string[] = [
  'membership.manage',
  'role.manage',
  'module.manage',
  'primary_hr.manage',
  'organization.update',
];

/**
 * The Organisations page (/organizations). For a tenant member its only
 * administrative capability is editing the organization profile, which the
 * server gates on organization.update (PATCH /organizations/:id). The
 * platform super_admin (users.role, never a tenant role) reaches it as the
 * tenant control plane regardless — existing behaviour, preserved.
 */
export const ORGANISATIONS_PAGE_PERMISSIONS: readonly string[] = ['organization.update'];

/**
 * Primary HR Administrator delegation: the server's requireDelegationAuthority
 * hr_team path needs hr_team.manage AND the caller being the organization's
 * ACTIVE Primary HR. Both signals come from the membership summary.
 */
export const HR_TEAM_MANAGEMENT_PERMISSION = 'hr_team.manage';

export interface AdministrationMembership {
  /** Effective permission keys for this membership (MembershipSummary.permissions). */
  permissions?: readonly string[] | null;
  isPrimaryHr?: boolean;
}

export interface AdministrationAccess {
  /** May open /organizations for administrative purposes. */
  canViewOrganisations: boolean;
  /** May open the full organization administration console. */
  canOpenOrganizationAdministration: boolean;
  /** May open the console in HR Team Management mode (Members + Roles). */
  canManageHrTeam: boolean;
}

export function hasAnyPermission(
  permissions: readonly string[] | null | undefined,
  required: readonly string[],
): boolean {
  if (!permissions || permissions.length === 0) return false;
  const held = new Set(permissions);
  return required.some((key) => held.has(key));
}

export function resolveAdministrationAccess(input: {
  /** users.role === "super_admin" — the platform bootstrap identity only. */
  isPlatformSuperAdmin: boolean;
  membership: AdministrationMembership | null | undefined;
}): AdministrationAccess {
  const permissions = input.membership?.permissions ?? [];
  const canOpenOrganizationAdministration = hasAnyPermission(permissions, ORGANIZATION_ADMINISTRATION_PERMISSIONS);
  const canManageHrTeam =
    input.membership?.isPrimaryHr === true && hasAnyPermission(permissions, [HR_TEAM_MANAGEMENT_PERMISSION]);
  return {
    canViewOrganisations: input.isPlatformSuperAdmin || hasAnyPermission(permissions, ORGANISATIONS_PAGE_PERMISSIONS),
    canOpenOrganizationAdministration,
    canManageHrTeam,
  };
}

export type AdministrationNavKey = 'organisations' | 'organization-administration' | 'hr-team-management';

export interface AdministrationNavEntry {
  key: AdministrationNavKey;
  href: string;
  label: string;
}

/**
 * The Administration group's children, already filtered to what the caller
 * is authorized for. An empty array means the whole group must not render.
 * Organization Administration and HR Team Management share one route; the
 * broader authority wins so the same destination is never listed twice.
 */
export function resolveAdministrationNavEntries(
  access: AdministrationAccess,
  activeOrganizationId: number | null | undefined,
): AdministrationNavEntry[] {
  const entries: AdministrationNavEntry[] = [];
  if (access.canViewOrganisations) {
    entries.push({ key: 'organisations', href: '/organizations', label: 'Organisations' });
  }
  if (activeOrganizationId && activeOrganizationId > 0) {
    if (access.canOpenOrganizationAdministration) {
      entries.push({
        key: 'organization-administration',
        href: `/admin/${activeOrganizationId}`,
        label: 'Organization Administration',
      });
    } else if (access.canManageHrTeam) {
      entries.push({ key: 'hr-team-management', href: `/admin/${activeOrganizationId}`, label: 'HR Team Management' });
    }
  }
  return entries;
}
