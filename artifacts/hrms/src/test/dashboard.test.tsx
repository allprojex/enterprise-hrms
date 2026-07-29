/**
 * Tests for the Dashboard page (W18 — Dashboard Completion: remove all
 * hardcoded values; W40 — HR Operations Dashboard: real Leave metrics).
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
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, firstName: 'Ada', organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetDashboardSummary: () => ({ data: state.summary, isLoading: state.isLoading, error: state.error }),
  getGetDashboardSummaryQueryKey: () => ['dashboardSummary'],
  useListModules: () => ({
    data: [
      { id: 1, key: 'recruitment', name: 'Recruitment', description: 'Hiring workflows.', category: 'hr-operations', version: '1.0.0', status: 'hidden', defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
      { id: 2, key: 'attendance', name: 'Attendance', description: 'Clock-in/out tracking.', category: 'hr-operations', version: '1.0.0', status: 'active', defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
    ],
  }),
  getListModulesQueryKey: () => ['modules'],
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
    state.summary = { totalEmployees: 12, activeModules: 1, unreadNotifications: 3, leaveMetrics: null };
    state.isLoading = false;
    state.error = undefined;
    renderDashboard();
    expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('12');
    expect(screen.getByTestId('card-stat-active-modules')).toHaveTextContent('1');
    expect(screen.getByTestId('card-stat-unread-notifications')).toHaveTextContent('3');
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('renders the always-available foundation capabilities with working links', () => {
    state.summary = { totalEmployees: 12, activeModules: 1, unreadNotifications: 3, leaveMetrics: null };
    state.isLoading = false;
    state.error = undefined;
    renderDashboard();
    const employeesLink = screen.getByTestId('link-module-employee-records');
    expect(employeesLink).toHaveAttribute('href', '/employees');
    expect(screen.getAllByText('Available').length).toBeGreaterThanOrEqual(4);
  });

  it('renders registered modules from the real module registry, not a hardcoded list', () => {
    state.summary = { totalEmployees: 12, activeModules: 1, unreadNotifications: 3, leaveMetrics: null };
    state.isLoading = false;
    state.error = undefined;
    renderDashboard();
    expect(screen.getByText('Recruitment')).toBeInTheDocument();
    expect(screen.getByText('Attendance')).toBeInTheDocument();
    expect(screen.getByTestId('card-module-recruitment')).toHaveTextContent('Coming Soon');
    expect(screen.getByTestId('card-module-attendance')).toHaveTextContent('Available');
  });

  describe('Leave metrics (W40)', () => {
    it('shows a loading state without crashing, and no Leave section while loading', () => {
      state.summary = undefined;
      state.isLoading = true;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
    });

    it('omits the Leave section entirely (not zero-filled) when leaveMetrics is null — leave module disabled', () => {
      state.summary = { totalEmployees: 5, activeModules: 0, unreadNotifications: 0, leaveMetrics: null };
      state.isLoading = false;
      state.error = undefined;
      renderDashboard();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
      expect(screen.queryByText('Leave')).not.toBeInTheDocument();
    });

    it('renders every required Leave tile and the requests-by-status breakdown when leaveMetrics is present', () => {
      state.summary = { totalEmployees: 5, activeModules: 1, unreadNotifications: 0, leaveMetrics: LEAVE_METRICS };
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
      state.summary = undefined;
      state.isLoading = false;
      state.error = { error: 'boom' };
      expect(() => renderDashboard()).not.toThrow();
      expect(screen.queryByTestId('section-leave-metrics')).not.toBeInTheDocument();
    });
  });
});
