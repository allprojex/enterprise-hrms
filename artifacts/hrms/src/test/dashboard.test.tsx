/**
 * Tests for the Dashboard page (W18 — Dashboard Completion: remove all
 * hardcoded values; W40 — HR Operations Dashboard: real Leave metrics;
 * Permission-Aware Dashboard Reconciliation: every card now follows the
 * backend's own null-vs-real-data permission gate, and the module registry
 * section is org-enablement-aware and HR-capable-only).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '@/pages/dashboard';
import type { DashboardSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    summary: undefined as DashboardSummary | undefined,
    isLoading: false,
    error: undefined as unknown,
    roles: ['org_admin'] as string[],
    orgModules: [] as Record<string, unknown>[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, firstName: 'Ada', activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetDashboardSummary: () => ({ data: state.summary, isLoading: state.isLoading, error: state.error }),
  getGetDashboardSummaryQueryKey: () => ['dashboardSummary'],
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, roles: state.roles }] }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListOrganizationModules: () => ({ data: state.orgModules }),
  getListOrganizationModulesQueryKey: () => ['organizationModules', 10],
}));

const LEAVE_METRICS: NonNullable<DashboardSummary['leaveMetrics']> = {
  employeesOnLeave: 2,
  upcomingApprovedLeave: 4,
  pendingApprovalCount: 1,
  upcomingPublicHolidays: 3,
  leaveUtilizationPercent: 42.5,
  expiringCarryForwardBalances: 1,
  requestsByStatus: { pending: 1, approved: 5, rejected: 0, cancelled: 2 },
};

function orgModule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    key: 'attendance',
    name: 'Attendance',
    description: 'Clock-in/out tracking.',
    category: 'hr-operations',
    version: '1.0.0',
    status: 'active',
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
    enabled: true,
    ...overrides,
  };
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

describe('Dashboard page', () => {
  it('renders stats from the real summary, with no Pending Requests tile', () => {
    state.roles = ['org_admin'];
    state.orgModules = [];
    state.summary = { totalEmployees: 12, activeModules: 1, unreadNotifications: 3, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
    state.isLoading = false;
    state.error = undefined;
    renderDashboard();
    expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('12');
    expect(screen.getByTestId('card-stat-active-modules')).toHaveTextContent('1');
    expect(screen.getByTestId('card-stat-unread-notifications')).toHaveTextContent('3');
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('renders the always-available foundation capabilities with working links, regardless of role', () => {
    state.roles = ['employee'];
    state.orgModules = [];
    state.summary = { totalEmployees: null, activeModules: 1, unreadNotifications: 3, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
    state.isLoading = false;
    state.error = undefined;
    renderDashboard();
    const employeesLink = screen.getByTestId('link-module-employee-records');
    expect(employeesLink).toHaveAttribute('href', '/employees');
    expect(screen.getAllByText('Available').length).toBeGreaterThanOrEqual(4);
  });

  describe('Total Employees (Permission-Aware Dashboard Reconciliation)', () => {
    it('omits the Total Employees tile when null — caller lacks employee.write', () => {
      state.roles = ['employee'];
      state.orgModules = [];
      state.summary = { totalEmployees: null, activeModules: 0, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('card-stat-total-employees')).not.toBeInTheDocument();
    });

    it('shows the Total Employees tile with its real value when non-null', () => {
      state.roles = ['org_admin'];
      state.orgModules = [];
      state.summary = { totalEmployees: 9, activeModules: 0, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('9');
    });
  });

  describe('Available Modules registry (Permission-Aware Dashboard Reconciliation)', () => {
    it('is hidden entirely from a caller who is not HR-capable — informational/administrative surface only', () => {
      state.roles = ['employee'];
      state.orgModules = [orgModule({ key: 'attendance', name: 'Attendance', enabled: true })];
      state.summary = { totalEmployees: null, activeModules: 1, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('card-module-attendance')).not.toBeInTheDocument();
    });

    it('shows only ORG-ENABLED modules to an HR-capable caller — a module disabled for this organization never reads as Available', () => {
      state.roles = ['org_admin'];
      state.orgModules = [
        orgModule({ id: 1, key: 'attendance', name: 'Attendance', enabled: true }),
        orgModule({ id: 2, key: 'payroll', name: 'Payroll', enabled: false }),
      ];
      state.summary = { totalEmployees: 5, activeModules: 1, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.getByTestId('card-module-attendance')).toBeInTheDocument();
      expect(screen.queryByTestId('card-module-payroll')).not.toBeInTheDocument();
    });

    it('never shows a "Coming Soon" card — a module is either enabled (shown) or omitted, never advertised as unavailable', () => {
      state.roles = ['org_admin'];
      state.orgModules = [orgModule({ id: 1, key: 'payroll', name: 'Payroll', enabled: false })];
      state.summary = { totalEmployees: 5, activeModules: 0, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();
    });
  });

  describe('Leave metrics (W40)', () => {
    it('shows a loading state without crashing, and no Leave section while loading', () => {
      state.roles = ['org_admin'];
      state.orgModules = [];
      state.summary = undefined;
      state.isLoading = true;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
    });

    it('omits the Leave section entirely (not zero-filled) when leaveMetrics is null — leave module disabled', () => {
      state.roles = ['org_admin'];
      state.orgModules = [];
      state.summary = { totalEmployees: 5, activeModules: 0, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
      expect(screen.queryByText('Leave')).not.toBeInTheDocument();
    });

    it('renders every required Leave tile and the requests-by-status breakdown when leaveMetrics is present', () => {
      state.roles = ['org_admin'];
      state.orgModules = [];
      state.summary = { totalEmployees: 5, activeModules: 1, unreadNotifications: 0, leaveMetrics: LEAVE_METRICS, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.getByTestId('section-leave-metrics')).toBeInTheDocument();
      expect(screen.getByTestId('card-leave-stat-employees-on-leave')).toHaveTextContent('2');
      expect(screen.getByTestId('card-leave-stat-upcoming-approved-leave')).toHaveTextContent('4');
      expect(screen.getByTestId('card-leave-stat-pending-approvals')).toHaveTextContent('1');
      expect(screen.getByTestId('card-leave-stat-upcoming-public-holidays')).toHaveTextContent('3');
      expect(screen.getByTestId('card-leave-stat-leave-utilization')).toHaveTextContent('42.5%');
      expect(screen.getByTestId('card-leave-stat-expiring-carry-forward')).toHaveTextContent('1');
      expect(screen.getByTestId('card-leave-requests-by-status')).toHaveTextContent('Pending: 1');
      expect(screen.getByTestId('card-leave-requests-by-status')).toHaveTextContent('Approved: 5');
      expect(screen.getByTestId('card-leave-requests-by-status')).toHaveTextContent('Rejected: 0');
      expect(screen.getByTestId('card-leave-requests-by-status')).toHaveTextContent('Cancelled: 2');
    });

    it('does not crash on an error state', () => {
      state.roles = ['org_admin'];
      state.orgModules = [];
      state.summary = undefined;
      state.isLoading = false;
      state.error = { error: 'boom' };
      expect(() => renderDashboard()).not.toThrow();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
    });
  });

  describe('Attendance/Asset/Inventory dashboard cards (WWM Presentation Readiness; Permission-Aware Dashboard Reconciliation)', () => {
    it('omits all three cards when their metrics are null — module disabled OR caller lacks the reporting permission, never zero-filled', () => {
      state.roles = ['employee'];
      state.orgModules = [];
      state.summary = { totalEmployees: null, activeModules: 0, unreadNotifications: 0, leaveMetrics: null, attendanceMetrics: null, assetMetrics: null, inventoryMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('card-stat-present-today')).not.toBeInTheDocument();
      expect(screen.queryByTestId('card-stat-active-assets')).not.toBeInTheDocument();
      expect(screen.queryByTestId('card-stat-inventory-items')).not.toBeInTheDocument();
    });

    it('renders each card with its real value when its metrics are present — the backend already resolved permission, frontend just follows data presence', () => {
      state.roles = ['employee']; // deliberately not org_admin/hr_manager: proves this isn't a role-heuristic gate
      state.orgModules = [];
      state.summary = {
        totalEmployees: null,
        activeModules: 3,
        unreadNotifications: 0,
        leaveMetrics: null,
        attendanceMetrics: { presentToday: 4, totalEmployeesInScope: 5 },
        assetMetrics: { activeAssets: 7 },
        inventoryMetrics: { totalItems: 13 },
      };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.getByTestId('card-stat-present-today')).toHaveTextContent('4');
      expect(screen.getByTestId('card-stat-active-assets')).toHaveTextContent('7');
      expect(screen.getByTestId('card-stat-inventory-items')).toHaveTextContent('13');
    });
  });
});
