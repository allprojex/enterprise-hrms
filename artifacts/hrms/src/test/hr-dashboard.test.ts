/**
 * Pure presentation rules behind the HR Dashboard Command Centre
 * (lib/hr-dashboard.ts): Quick Access visibility, operational badges, task
 * timing and labels. The server authorizes; these rules decide only what is
 * advertised — and must fail closed.
 */
import { describe, it, expect } from 'vitest';
import type { DashboardSummary, HrCommandCentre, OrganizationModule } from '@workspace/api-client-react';
import {
  canOpenDestination,
  resolveWorkspaceCards,
  workspaceBadge,
  taskTiming,
  attentionSupporting,
  humanizeEventType,
  orderedAttention,
} from '@/lib/hr-dashboard';

function mod(key: string, enabled = true, requiredModuleKeys: string[] = []): OrganizationModule {
  return {
    id: 1,
    key,
    name: key,
    description: '',
    category: 'hr',
    version: '1.0.0',
    status: 'active',
    defaultEnabled: false,
    requiredModuleKeys,
    optionalModuleKeys: [],
    enabled,
  } as OrganizationModule;
}

const ALL_MODULES = ['leave', 'attendance', 'performance', 'learning', 'recruitment', 'asset_management', 'office_inventory', 'employee_self_service'].map((k) => mod(k));

// Mirrors the real HR templates: every one that holds a *.reports.read key also
// holds the matching organization-wide *.manage key (checked against
// roles-permissions-definitions for hr, hr_manager, hr_administrator).
const HR_PERMISSIONS = [
  'employee.read',
  'leave_request.approve',
  'leave_request.manage',
  'learning.manage',
  'asset_management.manage',
  'attendance.manage',
  'form.read',
  'personnel_file.read',
  'performance.manage',
  'performance.reports.read',
  'learning.reports.read',
  'recruitment.reports.read',
  'asset_management.reports.read',
  'office_inventory.reports.read',
];

function commandCentre(overrides: Partial<HrCommandCentre> = {}): HrCommandCentre {
  return {
    organizationId: 10,
    generatedAt: '2026-09-14T09:00:00Z',
    tasks: null,
    attention: [],
    upcomingHolidays: null,
    recentActivity: null,
    unavailableSections: [],
    ...overrides,
  };
}

describe('canOpenDestination — fails closed', () => {
  it('denies a permission-gated destination while permissions are unknown', () => {
    expect(canOpenDestination({ href: '/forms', anyPermission: ['form.read'] }, [], undefined)).toBe(false);
  });

  it('denies a module-gated destination while the module list is unknown, or when the module or a dependency is disabled', () => {
    const dest = { href: '/leave-approvals', moduleKey: 'leave', anyPermission: ['leave_request.approve'] };
    expect(canOpenDestination(dest, undefined, ['leave_request.approve'])).toBe(false);
    expect(canOpenDestination(dest, [mod('leave', false)], ['leave_request.approve'])).toBe(false);
    expect(canOpenDestination(dest, [mod('leave', true, ['core']), mod('core', false)], ['leave_request.approve'])).toBe(false);
    expect(canOpenDestination(dest, [mod('leave')], ['leave_request.approve'])).toBe(true);
  });

  it('allows a membership-only destination when its module is enabled', () => {
    expect(canOpenDestination({ href: '/self-service', moduleKey: 'employee_self_service', anyPermission: [] }, [mod('employee_self_service')], [])).toBe(true);
  });
});

describe('resolveWorkspaceCards', () => {
  it('shows an HR user every enabled, permitted workspace in catalog order, with Reports pointing at the first available report area', () => {
    const cards = resolveWorkspaceCards({ modules: ALL_MODULES, permissions: HR_PERMISSIONS });
    expect(cards.map((c) => c.key)).toEqual([
      'employees',
      'leave',
      'attendance',
      'forms',
      'personnel_files',
      'performance',
      'learning',
      'recruitment',
      'assets',
      'office_inventory',
      'reports',
      'self_service',
    ]);
    const reports = cards.find((c) => c.key === 'reports')!;
    expect(reports.href).toBe('/personnel-reports');
    expect(reports.description).toBe('6 report areas available');
  });

  it('omits a module the organization has disabled even when the permission is held', () => {
    const modules = ALL_MODULES.map((m) => (m.key === 'performance' ? mod('performance', false) : m));
    const cards = resolveWorkspaceCards({ modules, permissions: HR_PERMISSIONS });
    expect(cards.map((c) => c.key)).not.toContain('performance');
  });

  it('shows master data only to holders of its management permission', () => {
    const readOnly = resolveWorkspaceCards({ modules: [], permissions: ['branch.read', 'department.read', 'position.read', 'employee.read'] });
    expect(readOnly.map((c) => c.key)).toEqual(['employees']);
    const manager = resolveWorkspaceCards({ modules: [], permissions: ['branch.manage', 'department.manage', 'position.manage'] });
    expect(manager.map((c) => c.key)).toEqual(['branches', 'departments', 'positions']);
  });

  it('gives an ordinary employee only what they can open', () => {
    const cards = resolveWorkspaceCards({ modules: ALL_MODULES, permissions: ['employee.read', 'leave_request.read.own', 'attendance.read.own'] });
    expect(cards.map((c) => c.key)).toEqual(['employees', 'self_service']);
  });

  it('places Reports before self-service when Office Inventory is not shown', () => {
    const cards = resolveWorkspaceCards({
      modules: ALL_MODULES,
      permissions: ['asset_management.reports.read'],
      relationships: { hasDirectReports: true },
    });
    expect(cards.map((c) => c.key)).toEqual(['assets', 'reports', 'self_service']);
    expect(cards.find((c) => c.key === 'reports')!.href).toBe('/asset-reports');
  });
});

describe('resolveWorkspaceCards — relationship-aware cards per persona', () => {
  // The real ordinary-employee grant set after the 2026-09-22 correction, plus
  // WWM's inventory self-service keys: attempt-only (leave_request.approve,
  // office_inventory.approve) and team-scoped (*.reports.read) keys included.
  const EMPLOYEE = [
    'organization.read',
    'employee.read',
    'branch.read',
    'department.read',
    'position.read',
    'leave_type.read',
    'public_holiday.read',
    'leave_request.read.own',
    'leave_request.write.own',
    'leave_request.approve',
    'interview.read',
    'scorecard.submit',
    'attendance.read.own',
    'attendance.clock.own',
    'performance.read.own',
    'performance.write.own',
    'performance.review.write',
    'performance.reports.read',
    'learning.read.own',
    'learning.write.own',
    'learning.review.write',
    'learning.reports.read',
    'asset_management.read.own',
    'asset_management.write.own',
    'asset_management.reports.read',
    'office_inventory.request',
    'office_inventory.approve',
  ];
  const keys = (relationships: Parameters<typeof resolveWorkspaceCards>[0]['relationships'], permissions = EMPLOYEE) =>
    resolveWorkspaceCards({ modules: ALL_MODULES, permissions, relationships }).map((c) => c.key);

  it('an ordinary employee sees no manager, approver or HR card — only the directory and self-service', () => {
    expect(keys({})).toEqual(['employees', 'self_service']);
    expect(keys(undefined)).toEqual(['employees', 'self_service']);
    expect(keys({ isDepartmentHead: false, hasDirectReports: false, isInventoryApprovalDelegate: false })).toEqual(['employees', 'self_service']);
  });

  it('a department head sees leave approvals, team views, the inventory approval surface and team reports', () => {
    expect(keys({ isDepartmentHead: true })).toEqual(['employees', 'leave', 'learning', 'assets', 'office_inventory', 'reports', 'self_service']);
  });

  it('a reporting manager (no department) sees team views and reports, but not leave or inventory approvals', () => {
    expect(keys({ hasDirectReports: true })).toEqual(['employees', 'learning', 'assets', 'reports', 'self_service']);
  });

  it('an inventory approval delegate sees the inventory approval surface only', () => {
    expect(keys({ isInventoryApprovalDelegate: true })).toEqual(['employees', 'office_inventory', 'self_service']);
  });

  it('HR sees every organization-wide card without needing any relationship', () => {
    expect(keys({}, HR_PERMISSIONS)).toEqual([
      'employees',
      'leave',
      'attendance',
      'forms',
      'personnel_files',
      'performance',
      'learning',
      'recruitment',
      'assets',
      'office_inventory',
      'reports',
      'self_service',
    ]);
  });

  it('a relationship without the matching key opens nothing', () => {
    const cards = resolveWorkspaceCards({
      modules: ALL_MODULES,
      permissions: ['employee.read'],
      relationships: { isDepartmentHead: true, hasDirectReports: true, isInventoryApprovalDelegate: true },
    });
    expect(cards.map((c) => c.key)).toEqual(['employees', 'self_service']);
  });
});

describe('canOpenDestination — relationship-gated keys fail closed', () => {
  const dest = {
    href: '/leave-approvals',
    moduleKey: 'leave',
    anyPermission: ['leave_request.manage'],
    relationshipGated: { anyPermission: ['leave_request.approve'], anyRelationship: ['isDepartmentHead' as const] },
  };

  it('the attempt-only key alone does not open it', () => {
    expect(canOpenDestination(dest, ALL_MODULES, ['leave_request.approve'])).toBe(false);
    expect(canOpenDestination(dest, ALL_MODULES, ['leave_request.approve'], {})).toBe(false);
  });

  it('the attempt-only key opens it with the relationship; the organization-wide key opens it alone', () => {
    expect(canOpenDestination(dest, ALL_MODULES, ['leave_request.approve'], { isDepartmentHead: true })).toBe(true);
    expect(canOpenDestination(dest, ALL_MODULES, ['leave_request.manage'])).toBe(true);
  });

  it('a disabled module still wins over any relationship', () => {
    expect(canOpenDestination(dest, [mod('leave', false)], ['leave_request.manage'], { isDepartmentHead: true })).toBe(false);
  });
});

describe('workspaceBadge — real counts or "Open", never invented', () => {
  const summary = { leaveMetrics: { awaitingMyActionCount: 3 } } as unknown as DashboardSummary;

  it('uses the stage-aware leave count, not every visible pending request', () => {
    expect(workspaceBadge('leave', summary, undefined)).toEqual({ text: '3 pending', tone: 'warning' });
  });

  it('says "No pending items" for a genuine zero and "Open" where no count exists', () => {
    const cc = commandCentre({ attention: [{ key: 'performance_reviews_due', count: 0, secondaryCount: null, deepLink: '/performance-reviews' }] });
    expect(workspaceBadge('performance', undefined, cc)).toEqual({ text: 'No pending items', tone: 'neutral' });
    expect(workspaceBadge('attendance', undefined, cc)).toEqual({ text: 'Open', tone: 'neutral' });
    expect(workspaceBadge('employees', summary, cc)).toEqual({ text: 'Open', tone: 'neutral' });
  });

  it('labels each operational count', () => {
    const cc = commandCentre({
      attention: [
        { key: 'attendance_exceptions', count: 1, secondaryCount: null, deepLink: '' },
        { key: 'personnel_files_attention', count: 2, secondaryCount: null, deepLink: '' },
        { key: 'assets_awaiting_return', count: 4, secondaryCount: null, deepLink: '' },
        { key: 'forms_awaiting_review', count: 5, secondaryCount: 2, deepLink: '' },
      ],
    });
    expect(workspaceBadge('attendance', undefined, cc).text).toBe('1 exception');
    expect(workspaceBadge('personnel_files', undefined, cc).text).toBe('2 overdue');
    expect(workspaceBadge('assets', undefined, cc).text).toBe('4 overdue returns');
    expect(workspaceBadge('forms', undefined, cc).text).toBe('5 awaiting you');
  });
});

describe('task and card presentation', () => {
  const now = new Date('2026-09-14T12:00:00Z');

  it('derives timing only from the source due date, and shows waiting time for undated work', () => {
    expect(taskTiming({ dueAt: '2026-09-01T00:00:00Z', overdue: true, createdAt: '2026-08-01T00:00:00Z' }, now)).toMatchObject({ tone: 'danger', text: expect.stringMatching(/^Overdue · due /) });
    expect(taskTiming({ dueAt: '2026-09-20T00:00:00Z', overdue: false, createdAt: '2026-08-01T00:00:00Z' }, now)).toMatchObject({ tone: 'warning', text: expect.stringMatching(/^Due /) });
    expect(taskTiming({ dueAt: null, overdue: null, createdAt: '2026-09-11T08:00:00Z' }, now)).toEqual({ tone: 'neutral', text: 'Waiting 3 days' });
    expect(taskTiming({ dueAt: null, overdue: null, createdAt: '2026-09-13T13:00:00Z' }, now)).toEqual({ tone: 'neutral', text: 'Waiting since today' });
  });

  it('shows forms waiting elsewhere as monitoring context on the forms card', () => {
    expect(attentionSupporting({ key: 'forms_awaiting_review', count: 1, secondaryCount: 3, deepLink: '/forms' })).toBe('3 elsewhere in workflow');
    expect(attentionSupporting({ key: 'forms_awaiting_review', count: 1, secondaryCount: 0, deepLink: '/forms' })).toBe('Currently at your stage');
  });

  it('orders attention cards deterministically, with forms first', () => {
    const ordered = orderedAttention([
      { key: 'assets_awaiting_return', count: 1, secondaryCount: null, deepLink: '' },
      { key: 'forms_awaiting_review', count: 1, secondaryCount: null, deepLink: '' },
      { key: 'attendance_exceptions', count: 1, secondaryCount: null, deepLink: '' },
    ]);
    expect(ordered.map((c) => c.key)).toEqual(['forms_awaiting_review', 'attendance_exceptions', 'assets_awaiting_return']);
  });

  it('humanizes audit event types', () => {
    expect(humanizeEventType('leave_request.department_head_approved')).toBe('Leave request department head approved');
  });
});
