/**
 * Tests for the Dashboard page (W18 — Dashboard Completion: remove all
 * hardcoded values). @workspace/api-client-react is mocked at the hook
 * level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '@/pages/dashboard';

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, firstName: 'Ada', organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetDashboardSummary: () => ({
    data: { totalEmployees: 12, activeModules: 1, unreadNotifications: 3 },
    isLoading: false,
  }),
  getGetDashboardSummaryQueryKey: () => ['dashboardSummary'],
  useListModules: () => ({
    data: [
      { id: 1, key: 'recruitment', name: 'Recruitment', description: 'Hiring workflows.', category: 'hr-operations', version: '1.0.0', status: 'hidden', defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
      { id: 2, key: 'attendance', name: 'Attendance', description: 'Clock-in/out tracking.', category: 'hr-operations', version: '1.0.0', status: 'active', defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] },
    ],
  }),
  getListModulesQueryKey: () => ['modules'],
}));

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
    renderDashboard();
    expect(screen.getByTestId('card-stat-total-employees')).toHaveTextContent('12');
    expect(screen.getByTestId('card-stat-active-modules')).toHaveTextContent('1');
    expect(screen.getByTestId('card-stat-unread-notifications')).toHaveTextContent('3');
    expect(screen.queryByText(/pending requests/i)).not.toBeInTheDocument();
  });

  it('renders the always-available foundation capabilities with working links', () => {
    renderDashboard();
    const employeesLink = screen.getByTestId('link-module-employee-records');
    expect(employeesLink).toHaveAttribute('href', '/employees');
    expect(screen.getAllByText('Available').length).toBeGreaterThanOrEqual(4);
  });

  it('renders registered modules from the real module registry, not a hardcoded list', () => {
    renderDashboard();
    expect(screen.getByText('Recruitment')).toBeInTheDocument();
    expect(screen.getByText('Attendance')).toBeInTheDocument();
    expect(screen.getByTestId('card-module-recruitment')).toHaveTextContent('Coming Soon');
    expect(screen.getByTestId('card-module-attendance')).toHaveTextContent('Available');
  });
});
