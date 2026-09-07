/**
 * Administration navigation permission gating — the pure rule, proved in
 * isolation from React. Fixtures mirror the platform's seeded role templates
 * (lib/db/src/seed/roles-permissions-definitions.ts) and the WWM regression
 * case (Kofi Asante, EMP-0054: employee + wwm_employee_inventory_self_service).
 */
import { describe, it, expect } from 'vitest';
import {
  ORGANIZATION_ADMINISTRATION_PERMISSIONS,
  resolveAdministrationAccess,
  resolveAdministrationNavEntries,
  hasAnyPermission,
} from './administration-access';

// Seeded `employee` template — 33 keys, organization.read among them and no
// administrative key at all.
const EMPLOYEE_PERMISSIONS = [
  'application.read', 'asset_management.read.own', 'asset_management.reports.read', 'asset_management.write.own',
  'attendance.clock.own', 'attendance.read.own', 'branch.read', 'candidate.notes.read', 'candidate.read',
  'department.read', 'employee.read', 'interview.read', 'learning.read.own', 'learning.reports.read',
  'learning.review.write', 'learning.write.own', 'leave_request.approve', 'leave_request.read.own',
  'leave_request.write.own', 'leave_type.read', 'offer.manage', 'offer.read', 'organization.read',
  'performance.read.own', 'performance.reports.read', 'performance.review.write', 'performance.write.own',
  'position.read', 'public_holiday.read', 'recruitment.reports.read', 'requisition.read', 'scorecard.submit',
  'vacancy.read',
];

// WWM "Employee — Inventory Self-Service" custom role: employee template plus
// the seven My Inventory keys (docs/WWM_ORGANIZATION_SETUP.md).
const KOFI_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'office_inventory.request',
  'office_inventory.approve',
  'office_inventory.receipt.confirm.own',
  'office_inventory.custody.read',
  'office_inventory.return',
  'office_inventory.handover',
  'office_inventory.report_issue.own',
];

const HR_MANAGER_ADMIN_KEYS = ['organization.read', 'membership.read', 'audit.read.hr', 'employee.write'];
const HR_ADMINISTRATOR_ADMIN_KEYS = [
  'organization.read', 'membership.read', 'master_data.manage', 'hr_team.manage', 'audit.read.hr',
  'audit.read.documents', 'audit.read.assets_inventory', 'employee.write',
];
const ORG_ADMIN_ADMIN_KEYS = [
  'organization.read', 'organization.update', 'membership.read', 'membership.manage', 'role.manage', 'module.manage',
  'master_data.manage', 'primary_hr.manage', 'audit.read', 'employee.write',
];

const tenant = (permissions: string[] | undefined, isPrimaryHr = false) =>
  resolveAdministrationAccess({ isPlatformSuperAdmin: false, membership: { permissions, isPrimaryHr } });

describe('resolveAdministrationAccess — ordinary employees', () => {
  it('grants nothing to a caller holding only the employee template', () => {
    expect(tenant(EMPLOYEE_PERMISSIONS)).toEqual({
      canViewOrganisations: false,
      canOpenOrganizationAdministration: false,
      canManageHrTeam: false,
    });
  });

  it('Kofi Asante (employee + inventory self-service) still gets nothing — inventory keys are not administration', () => {
    const access = tenant(KOFI_PERMISSIONS);
    expect(access.canViewOrganisations).toBe(false);
    expect(access.canOpenOrganizationAdministration).toBe(false);
    expect(access.canManageHrTeam).toBe(false);
    expect(resolveAdministrationNavEntries(access, 3)).toEqual([]);
  });

  it('membership with no permissions field (older API) fails closed', () => {
    expect(resolveAdministrationNavEntries(tenant(undefined), 3)).toEqual([]);
    expect(
      resolveAdministrationNavEntries(resolveAdministrationAccess({ isPlatformSuperAdmin: false, membership: null }), 3),
    ).toEqual([]);
  });

  it('organization.read alone (every member holds it) never unlocks Organisations', () => {
    expect(tenant(['organization.read']).canViewOrganisations).toBe(false);
  });
});

describe('resolveAdministrationAccess — delegated custom permissions', () => {
  it.each(ORGANIZATION_ADMINISTRATION_PERMISSIONS.map((k) => [k]))(
    'an employee delegated %s sees only the entry that key unlocks',
    (key) => {
      const access = tenant([...KOFI_PERMISSIONS, key]);
      const entries = resolveAdministrationNavEntries(access, 3);
      expect(entries.map((e) => e.key)).toEqual(
        key === 'organization.update' ? ['organisations', 'organization-administration'] : ['organization-administration'],
      );
      expect(entries.find((e) => e.key === 'organization-administration')?.href).toBe('/admin/3');
    },
  );

  it('hr_team.manage alone (not Primary HR) unlocks nothing', () => {
    expect(resolveAdministrationNavEntries(tenant([...EMPLOYEE_PERMISSIONS, 'hr_team.manage'], false), 3)).toEqual([]);
  });

  it('Primary HR without hr_team.manage unlocks nothing', () => {
    expect(resolveAdministrationNavEntries(tenant(EMPLOYEE_PERMISSIONS, true), 3)).toEqual([]);
  });

  it('Primary HR holding hr_team.manage gets HR Team Management only', () => {
    const entries = resolveAdministrationNavEntries(tenant(HR_ADMINISTRATOR_ADMIN_KEYS, true), 3);
    expect(entries).toEqual([{ key: 'hr-team-management', href: '/admin/3', label: 'HR Team Management' }]);
  });
});

describe('resolveAdministrationAccess — standard roles', () => {
  it('hr_manager (membership.read, audit.read.hr) sees no Administration entry', () => {
    expect(resolveAdministrationNavEntries(tenant(HR_MANAGER_ADMIN_KEYS), 3)).toEqual([]);
  });

  it('hr_administrator who is not Primary HR sees no Administration entry', () => {
    expect(resolveAdministrationNavEntries(tenant(HR_ADMINISTRATOR_ADMIN_KEYS, false), 3)).toEqual([]);
  });

  it('org_admin sees Organisations and Organization Administration (never HR Team Management as a duplicate)', () => {
    const entries = resolveAdministrationNavEntries(tenant([...ORG_ADMIN_ADMIN_KEYS, 'hr_team.manage'], true), 3);
    expect(entries.map((e) => e.key)).toEqual(['organisations', 'organization-administration']);
    expect(entries.filter((e) => e.href === '/admin/3')).toHaveLength(1);
  });

  it('Organization Administration requires an active organization id', () => {
    const access = tenant(ORG_ADMIN_ADMIN_KEYS);
    expect(resolveAdministrationNavEntries(access, undefined).map((e) => e.key)).toEqual(['organisations']);
    expect(resolveAdministrationNavEntries(access, 0).map((e) => e.key)).toEqual(['organisations']);
  });
});

describe('resolveAdministrationAccess — platform super_admin', () => {
  it('always reaches Organisations (tenant control plane), with no new console bypass', () => {
    const access = resolveAdministrationAccess({ isPlatformSuperAdmin: true, membership: null });
    expect(access.canViewOrganisations).toBe(true);
    expect(access.canOpenOrganizationAdministration).toBe(false);
    expect(resolveAdministrationNavEntries(access, 3).map((e) => e.key)).toEqual(['organisations']);
  });

  it('reaches the console for an organization where its membership carries the admin keys', () => {
    const access = resolveAdministrationAccess({
      isPlatformSuperAdmin: true,
      membership: { permissions: ORG_ADMIN_ADMIN_KEYS, isPrimaryHr: false },
    });
    expect(resolveAdministrationNavEntries(access, 1).map((e) => e.key)).toEqual(['organisations', 'organization-administration']);
  });
});

describe('hasAnyPermission', () => {
  it('handles empty and missing inputs without throwing', () => {
    expect(hasAnyPermission(undefined, ['x'])).toBe(false);
    expect(hasAnyPermission(null, ['x'])).toBe(false);
    expect(hasAnyPermission([], ['x'])).toBe(false);
    expect(hasAnyPermission(['x'], [])).toBe(false);
    expect(hasAnyPermission(['x', 'y'], ['y'])).toBe(true);
  });
});
