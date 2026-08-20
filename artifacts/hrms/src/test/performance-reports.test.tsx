/**
 * Tests for the Performance Reports page (Phase 3C, W81).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceReports from '@/pages/performance-reports';
import type { Report, ReportRunResult, PerformanceCycle, Employee, Department, Position } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as Report[],
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
    cycles: [] as PerformanceCycle[],
    employees: [] as Employee[],
    departments: [] as Department[],
    positions: [] as Position[],
    calls: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useListPerformanceCycles: () => ({ data: state.cycles }),
  getListPerformanceCyclesQueryKey: () => ['cycles'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListPositions: () => ({ data: state.positions }),
  getListPositionsQueryKey: () => ['positions'],
  useRunPerformanceReport: (_orgId: number, _key: string, params: unknown) => {
    state.calls.push(params);
    return { data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() };
  },
  getRunPerformanceReportQueryKey: () => ['runPerformanceReport'],
  getRunPerformanceReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/performance/reports/${key}`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function performanceReport(key: string, label: string): Report {
  return { key, label, description: 'd', category: 'performance' };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceReports />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.reports = [
    performanceReport('performance_review_status', 'Review Status'),
    performanceReport('performance_scores', 'Performance Scores'),
    performanceReport('performance_goal_results', 'Goal Results'),
  ];
  state.catalogLoading = false;
  state.result = undefined;
  state.resultLoading = false;
  state.error = undefined;
  state.cycles = [];
  state.employees = [];
  state.departments = [];
  state.positions = [];
  state.calls = [];
}

describe('Performance Reports page', () => {
  it('shows only performance-category reports in the selector, excluding other categories', () => {
    resetState();
    state.reports = [...state.reports, { key: 'headcount', label: 'Headcount', description: 'd', category: 'workforce' }];
    renderPage();
    expect(screen.getByText('Review Status')).toBeInTheDocument();
    expect(screen.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows an empty state when no performance reports are registered', () => {
    resetState();
    state.reports = [];
    renderPage();
    expect(screen.getByText('No reports available')).toBeInTheDocument();
  });

  it('shows an access-denied message on 403', () => {
    resetState();
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('renders report columns and rows, using an em dash for null cells', () => {
    resetState();
    state.result = {
      key: 'performance_scores',
      label: 'Performance Scores',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'managerScore', label: 'Manager Score' },
        { key: 'hrOverrideScore', label: 'HR Override' },
      ],
      rows: [{ employee: 'Ada Lovelace', managerScore: '88.00', hrOverrideScore: null }],
    };
    renderPage();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const row = screen.getByTestId('row-performance-report-0');
    expect(row).toHaveTextContent('—');
  });

  it('shows a no-data message for an empty report result', () => {
    resetState();
    state.result = { key: 'performance_review_status', label: 'Review Status', description: 'd', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    renderPage();
    expect(screen.getByText(/no data for this selection/i)).toBeInTheDocument();
  });

  it('enables the CSV download button once a report is loaded', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-download-performance-report-csv')).not.toBeDisabled();
  });

  it('offers cycle/status/department/position/reviewer/employee filters', async () => {
    resetState();
    state.cycles = [{ id: 1, organizationId: 10, name: '2026 Cycle', cycleType: 'annual', startDate: '2026-01-01', endDate: '2026-12-31', templateId: 1, ratingScaleId: 1, applicabilityScope: 'all_active', status: 'open', createdAt: new Date().toISOString() } as PerformanceCycle];
    state.employees = [{ id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '' } as Employee];
    state.departments = [{ id: 100, organizationId: 10, name: 'Engineering', code: 'ENG', status: 'active', createdAt: new Date().toISOString() } as Department];
    state.positions = [{ id: 200, organizationId: 10, title: 'Software Engineer', status: 'active', createdAt: new Date().toISOString() } as Position];
    renderPage();
    await userEvent.click(screen.getByTestId('select-performance-report-cycle'));
    expect(screen.getByRole('option', { name: '2026 Cycle' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId('select-performance-report-department'));
    expect(screen.getByRole('option', { name: 'Engineering' })).toBeInTheDocument();
  });
});
