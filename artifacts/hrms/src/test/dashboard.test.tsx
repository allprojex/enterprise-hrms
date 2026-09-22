/**
 * Tests for the Dashboard page — HR Dashboard Command Centre.
 *
 * Carries forward the earlier contracts (W18 no hardcoded values; W40 real
 * Leave metrics; Permission-Aware Dashboard Reconciliation: a null/absent
 * section is hidden, never zero-filled; no administrative shortcuts) and adds
 * the command-centre hierarchy: Workforce Summary, My HR Tasks, Leave, HR
 * Attention, Quick Access and the secondary Activity/Holidays row.
 *
 * @workspace/api-client-react is mocked at the hook level — no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '@/pages/dashboard';
import type { DashboardSummary, HrCommandCentre, HrTask } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    summary: undefined as DashboardSummary | undefined,
    summaryLoading: false,
    commandCentre: undefined as HrCommandCentre | undefined,
    commandCentreLoading: false,
    commandCentreError: false,
    refetch: vi.fn(),
    roles: ['hr'] as string[],
    permissions: [] as string[] | undefined,
    isDepartmentHead: false,
    orgModules: [] as Record<string, unknown>[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, firstName: 'Ada', activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetDashboardSummary: () => ({ data: state.summary, isLoading: state.summaryLoading }),
  getGetDashboardSummaryQueryKey: () => ['dashboardSummary'],
  useGetHrCommandCentre: () => ({
    data: state.commandCentre,
    isLoading: state.commandCentreLoading,
    isError: state.commandCentreError,
    refetch: state.refetch,
  }),
  getGetHrCommandCentreQueryKey: () => ['hrCommandCentre', 10],
  useListMyOrganizations: () => ({
    data: [
      {
        organizationId: 10,
        organizationName: 'Acme Community Trust',
        roles: state.roles,
        permissions: state.permissions,
        isDepartmentHead: state.isDepartmentHead,
      },
    ],
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListOrganizationModules: () => ({ data: state.orgModules }),
  getListOrganizationModulesQueryKey: () => ['organizationModules', 10],
}));

const LEAVE_METRICS: NonNullable<DashboardSummary['leaveMetrics']> = {
  scope: 'organization',
  employeesOnLeave: 2,
  upcomingApprovedLeave: 4,
  pendingApprovalCount: 5,
  awaitingMyActionCount: 1,
  awaitingOtherStageCount: 4,
  upcomingPublicHolidays: 3,
  leaveUtilizationPercent: 42.5,
  expiringCarryForwardBalances: 1,
  requestsByStatus: { pending: 4, approved: 5, rejected: 0, cancelled: 2 },
};

const HR_PERMISSIONS = [
  'employee.read',
  'employee.write',
  'attendance.read.own',
  'attendance.manage',
  'leave_request.read.own',
  'leave_request.approve',
  'leave_request.manage',
  'form.read',
  'performance.manage',
];

const DAY = 86_400_000;

function summary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    totalEmployees: null,
    activeEmployees: null,
    activeModules: 0,
    unreadNotifications: 0,
    leaveMetrics: null,
    attendanceMetrics: null,
    assetMetrics: null,
    inventoryMetrics: null,
    ...overrides,
  };
}

function commandCentre(overrides: Partial<HrCommandCentre> = {}): HrCommandCentre {
  return {
    organizationId: 10,
    generatedAt: new Date().toISOString(),
    tasks: null,
    attention: [],
    upcomingHolidays: null,
    recentActivity: null,
    unavailableSections: [],
    ...overrides,
  };
}

function task(overrides: Partial<HrTask>): HrTask {
  return {
    sourceModule: 'leave',
    sourceType: 'leave_request',
    sourceId: 1,
    actionKind: 'approve',
    title: 'Leave request',
    employeeId: 5,
    employeeFirstName: 'Kofi',
    employeeLastName: 'Mensah',
    status: 'pending_hr',
    createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
    dueAt: null,
    overdue: null,
    context: null,
    deepLink: '/leave-approvals',
    ...overrides,
  };
}

function orgModule(key: string, enabled = true) {
  return { id: 1, key, name: key, description: '', category: 'hr', version: '1.0.0', status: 'active', defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [], enabled };
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.summary = summary();
  state.summaryLoading = false;
  state.commandCentre = commandCentre();
  state.commandCentreLoading = false;
  state.commandCentreError = false;
  state.refetch = vi.fn();
  state.roles = ['hr'];
  state.permissions = HR_PERMISSIONS;
  state.isDepartmentHead = false;
  state.orgModules = [];
});

describe('Dashboard — organization context', () => {
  it('names the active organization it is operating in', () => {
    renderDashboard();
    expect(screen.getByTestId('dashboard-org-context')).toHaveTextContent('Operating in: Acme Community Trust');
    expect(screen.getByTestId('page-title')).toHaveTextContent('Welcome back, Ada');
  });
});

describe('Dashboard — Workforce Summary', () => {
  it('renders the four workforce cards with real values and working destinations', () => {
    state.summary = summary({
      totalEmployees: 14,
      activeEmployees: 12,
      attendanceMetrics: { presentToday: 9, totalEmployeesInScope: 12 },
      leaveMetrics: LEAVE_METRICS,
    });
    state.commandCentre = commandCentre({ tasks: { items: [task({})], total: 7, overdue: 2, unavailableSources: [] } });
    renderDashboard();

    expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('12');
    expect(screen.getByTestId('card-stat-total-employees-link')).toHaveAttribute('href', '/employees');
    expect(screen.getByTestId('card-stat-present-today')).toHaveTextContent('9');
    expect(screen.getByTestId('card-stat-present-today')).toHaveTextContent('of 12 in scope');
    expect(screen.getByTestId('card-stat-present-today-link')).toHaveAttribute('href', '/attendance-dashboard');
    expect(screen.getByTestId('card-stat-on-leave')).toHaveTextContent('2');
    expect(screen.getByTestId('card-stat-on-leave-link')).toHaveAttribute('href', '/leave-calendar');
    expect(screen.getByTestId('card-stat-pending-hr-actions')).toHaveTextContent('7');
    expect(screen.getByTestId('card-stat-pending-hr-actions')).toHaveTextContent('2 overdue');
    expect(screen.getByTestId('card-stat-pending-hr-actions-link')).toHaveAttribute('href', '#my-hr-tasks');
  });

  it('omits every card the backend withheld — never a fabricated zero', () => {
    state.summary = summary();
    state.commandCentre = commandCentre({ tasks: null });
    renderDashboard();

    expect(screen.queryByTestId('card-stat-total-employees')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-stat-present-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-stat-on-leave')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-stat-pending-hr-actions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-workforce-summary')).not.toBeInTheDocument();
  });

  it('shows a card without a link when the caller cannot open its destination', () => {
    state.permissions = ['employee.write'];
    state.summary = summary({ activeEmployees: 3, attendanceMetrics: { presentToday: 1, totalEmployeesInScope: 3 } });
    renderDashboard();

    expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('3');
    expect(screen.queryByTestId('card-stat-total-employees-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-stat-present-today-link')).not.toBeInTheDocument();
  });

  it('shows loading skeletons without crashing while the summary loads', () => {
    state.summary = undefined;
    state.summaryLoading = true;
    state.commandCentre = undefined;
    state.commandCentreLoading = true;
    renderDashboard();

    expect(screen.getAllByTestId('metric-card-skeleton').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-my-hr-tasks')).toBeInTheDocument();
  });
});

describe('Dashboard — My HR Tasks', () => {
  it('lists actionable tasks in server order with person, context, timing, status and a direct link', () => {
    state.commandCentre = commandCentre({
      tasks: {
        items: [
          task({ sourceModule: 'onboarding', sourceType: 'onboarding_task', sourceId: 3, title: 'Issue laptop', dueAt: new Date(Date.now() - 2 * DAY).toISOString(), overdue: true, status: 'pending', deepLink: '/onboarding' }),
          task({ sourceModule: 'forms', sourceType: 'form_submission', sourceId: 501, title: 'Staff Leave Form', context: 'Stage: HR Review', status: 'pending_approval', deepLink: '/forms/501' }),
          task({ sourceId: 1 }),
        ],
        total: 3,
        overdue: 1,
        unavailableSources: [],
      },
    });
    renderDashboard();

    const rows = within(screen.getByTestId('my-hr-tasks-list')).getAllByRole('link');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/onboarding', '/forms/501', '/leave-approvals']);
    expect(rows[0]).toHaveTextContent('Issue laptop');
    expect(rows[0]).toHaveTextContent(/Overdue · due/);
    const form = screen.getByTestId('task-forms-501');
    expect(form).toHaveTextContent('Staff Leave Form');
    expect(form).toHaveTextContent('Forms');
    expect(form).toHaveTextContent('Kofi Mensah');
    expect(form).toHaveTextContent('Stage: HR Review');
    expect(screen.getByTestId('task-leave-1')).toHaveTextContent('Waiting 3 days');
    expect(screen.getByTestId('link-action-centre')).toHaveAttribute('href', '/action-centre');
  });

  it('shows an honest empty state when nothing needs action', () => {
    state.commandCentre = commandCentre({ tasks: { items: [], total: 0, overdue: 0, unavailableSources: [] } });
    renderDashboard();
    expect(screen.getByTestId('my-hr-tasks-empty')).toHaveTextContent("You're all caught up");
    expect(screen.getByTestId('card-stat-pending-hr-actions')).toHaveTextContent('0');
  });

  it('is absent entirely for a caller with no task source (e.g. an ordinary employee)', () => {
    state.roles = ['employee'];
    state.permissions = ['employee.read'];
    state.commandCentre = commandCentre({ tasks: null });
    renderDashboard();
    expect(screen.queryByTestId('section-my-hr-tasks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-action-centre')).not.toBeInTheDocument();
  });

  it('shows an error state with retry when the command centre fails to load', () => {
    state.commandCentre = undefined;
    state.commandCentreError = true;
    renderDashboard();
    const section = screen.getByTestId('section-my-hr-tasks');
    expect(section).toHaveTextContent('Tasks could not be loaded');
    fireEvent.click(within(section).getByRole('button', { name: /retry/i }));
    expect(state.refetch).toHaveBeenCalled();
  });

  it('names task sources that could not be loaded, and collapses a long list with a toggle', () => {
    const items = Array.from({ length: 9 }, (_, i) => task({ sourceId: i + 1 }));
    state.commandCentre = commandCentre({ tasks: { items, total: 30, overdue: 0, unavailableSources: ['performance'] } });
    renderDashboard();

    expect(screen.getByTestId('text-tasks-unavailable')).toHaveTextContent('Performance');
    expect(within(screen.getByTestId('my-hr-tasks-list')).getAllByRole('link')).toHaveLength(6);
    expect(screen.getByTestId('text-tasks-truncated')).toHaveTextContent('Showing 9 of 30');
    fireEvent.click(screen.getByTestId('button-toggle-tasks'));
    expect(within(screen.getByTestId('my-hr-tasks-list')).getAllByRole('link')).toHaveLength(9);
  });
});

describe('Dashboard — Leave', () => {
  it('shows the stage-aware approval count: only what the viewer can decide, with other-stage requests as context', () => {
    state.summary = summary({ leaveMetrics: LEAVE_METRICS });
    renderDashboard();

    expect(screen.getByTestId('card-leave-upcoming-approved')).toHaveTextContent('4');
    const approvals = screen.getByTestId('card-leave-pending-approvals');
    expect(approvals).toHaveTextContent('1');
    expect(approvals).not.toHaveTextContent('5');
    expect(approvals).toHaveTextContent('4 with another approver');
    expect(screen.getByTestId('card-leave-pending-approvals-link')).toHaveAttribute('href', '/leave-approvals');
    expect(screen.getByTestId('card-leave-utilization')).toHaveTextContent('42.5%');
    expect(screen.getByTestId('card-leave-expiring-carry-forward')).toHaveTextContent('1');
    expect(screen.getByTestId('text-leave-metrics-scope')).toHaveTextContent('Across your organisation');
  });

  it('hides the approvals card from a caller without leave_request.approve, and labels own + reports scope honestly', () => {
    state.permissions = ['leave_request.read.own'];
    state.summary = summary({ leaveMetrics: { ...LEAVE_METRICS, scope: 'own_and_reports' } });
    renderDashboard();

    expect(screen.queryByTestId('card-leave-pending-approvals')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-leave-metrics-scope')).toHaveTextContent('For you and your direct reports');
    expect(screen.getByTestId('text-leave-metrics-scope')).not.toHaveTextContent('organisation');
  });

  it('an ordinary employee holding the attempt-only leave_request.approve sees no approvals card', () => {
    // Every employee holds leave_request.approve; only a department head (or HR
    // via leave_request.manage) has a real approval queue.
    state.roles = ['employee'];
    state.permissions = ['employee.read', 'leave_request.read.own', 'leave_request.write.own', 'leave_request.approve'];
    state.isDepartmentHead = false;
    state.summary = summary({ leaveMetrics: { ...LEAVE_METRICS, scope: 'own_and_reports' } });
    renderDashboard();

    expect(screen.queryByTestId('card-leave-pending-approvals')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-leave-upcoming-approved')).toBeInTheDocument();
  });

  it('a department head with the same keys sees the approvals card', () => {
    state.roles = ['employee'];
    state.permissions = ['employee.read', 'leave_request.read.own', 'leave_request.write.own', 'leave_request.approve'];
    state.isDepartmentHead = true;
    state.summary = summary({ leaveMetrics: { ...LEAVE_METRICS, scope: 'own_and_reports' } });
    renderDashboard();

    expect(screen.getByTestId('card-leave-pending-approvals')).toHaveTextContent('1');
  });

  it('an ordinary employee is offered only the directory and self-service in Quick Access', () => {
    state.roles = ['employee'];
    state.permissions = [
      'employee.read',
      'leave_request.read.own',
      'leave_request.approve',
      'learning.reports.read',
      'performance.reports.read',
      'asset_management.reports.read',
      'office_inventory.approve',
    ];
    state.isDepartmentHead = false;
    state.orgModules = ['leave', 'learning', 'performance', 'asset_management', 'office_inventory', 'employee_self_service'].map((key) => ({
      id: 1,
      key,
      name: key,
      description: '',
      category: 'hr',
      version: '1.0.0',
      status: 'active',
      defaultEnabled: false,
      requiredModuleKeys: [],
      optionalModuleKeys: [],
      enabled: true,
    }));
    renderDashboard();

    for (const key of ['leave', 'learning', 'assets', 'office_inventory', 'reports', 'recruitment']) {
      expect(screen.queryByTestId(`workspace-card-${key}`)).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('workspace-card-employees')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-card-self_service')).toBeInTheDocument();
  });

  it('omits the Leave section entirely when leaveMetrics is null (module disabled)', () => {
    state.summary = summary({ leaveMetrics: null });
    renderDashboard();
    expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
  });
});

describe('Dashboard — HR Attention', () => {
  it('renders only the cards the server returned, each linking to its module', () => {
    state.commandCentre = commandCentre({
      attention: [
        { key: 'assets_awaiting_return', count: 2, secondaryCount: null, deepLink: '/assets-dashboard' },
        { key: 'forms_awaiting_review', count: 1, secondaryCount: 3, deepLink: '/forms' },
      ],
    });
    renderDashboard();

    const section = screen.getByTestId('section-hr-attention');
    expect(within(section).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/forms', '/assets-dashboard']);
    expect(screen.getByTestId('card-attention-forms_awaiting_review')).toHaveTextContent('Forms Awaiting HR Review');
    expect(screen.getByTestId('card-attention-forms_awaiting_review')).toHaveTextContent('3 elsewhere in workflow');
    expect(screen.queryByTestId('card-attention-attendance_exceptions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-attention-probation_reviews_due')).not.toBeInTheDocument();
  });

  it('is absent when the caller is authorized for no attention source', () => {
    renderDashboard();
    expect(screen.queryByTestId('section-hr-attention')).not.toBeInTheDocument();
  });
});

describe('Dashboard — Quick Access', () => {
  it('shows only enabled, permitted modules with operational badges', () => {
    state.orgModules = [orgModule('leave'), orgModule('attendance'), orgModule('performance', false)];
    state.summary = summary({ leaveMetrics: LEAVE_METRICS });
    state.commandCentre = commandCentre({
      attention: [{ key: 'attendance_exceptions', count: 0, secondaryCount: null, deepLink: '/attendance-dashboard' }],
    });
    renderDashboard();

    expect(screen.getByTestId('workspace-card-employees')).toHaveAttribute('href', '/employees');
    expect(screen.getByTestId('workspace-badge-leave')).toHaveTextContent('1 pending');
    expect(screen.getByTestId('workspace-badge-attendance')).toHaveTextContent('No pending items');
    expect(screen.getByTestId('workspace-badge-forms')).toHaveTextContent('Open');
    expect(screen.queryByTestId('workspace-card-performance')).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
  });

  it('shows nothing gated while effective permissions are still unknown (fail closed)', () => {
    state.permissions = undefined;
    state.orgModules = [orgModule('leave')];
    renderDashboard();
    expect(screen.queryByTestId('section-workspace')).not.toBeInTheDocument();
  });
});

describe('Dashboard — secondary row', () => {
  it('renders recent HR activity and upcoming holidays when provided', () => {
    state.commandCentre = commandCentre({
      recentActivity: [{ id: 1, occurredAt: '2026-09-13T10:00:00Z', eventType: 'employee.updated', targetType: 'employee', actorName: 'Ama Owusu' }],
      upcomingHolidays: [{ id: 2, name: 'Founders Day', date: '2099-08-04' }],
    });
    renderDashboard();
    expect(screen.getByTestId('card-recent-activity')).toHaveTextContent('Employee updated');
    expect(screen.getByTestId('card-recent-activity')).toHaveTextContent('by Ama Owusu');
    expect(screen.getByTestId('card-upcoming-holidays')).toHaveTextContent('Founders Day');
  });

  it('omits both when the caller may not read them', () => {
    renderDashboard();
    expect(screen.queryByTestId('card-recent-activity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-upcoming-holidays')).not.toBeInTheDocument();
  });

  it('says which authorized sections could not be loaded', () => {
    state.commandCentre = commandCentre({ unavailableSections: ['performance', 'holidays'] });
    renderDashboard();
    expect(screen.getByTestId('text-unavailable-sections')).toHaveTextContent('Performance, Public holidays');
  });
});

// Administration navigation permission gating (2026-09-07): the dashboard
// carries no administrative shortcut for anyone.
describe('Dashboard — no administrative shortcuts', () => {
  it('renders no link to organization administration or the Organisations console for an ordinary employee', () => {
    state.roles = ['employee', 'wwm_employee_inventory_self_service'];
    state.permissions = ['employee.read', 'office_inventory.request'];
    state.orgModules = [orgModule('office_inventory')];
    renderDashboard();
    expect(document.querySelectorAll('a[href^="/admin"]')).toHaveLength(0);
    expect(document.querySelectorAll('a[href="/organizations"]')).toHaveLength(0);
    expect(document.querySelectorAll('a[href="/branches"], a[href="/departments"], a[href="/positions"]')).toHaveLength(0);
    expect(screen.queryByTestId('workspace-card-office_inventory')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-card-employees')).toHaveAttribute('href', '/employees');
  });
});
