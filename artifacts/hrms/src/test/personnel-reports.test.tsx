/**
 * Tests for the Personnel Reports page (Phase 3H, W119).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PersonnelReports from '@/pages/personnel-reports';
import type { Report, ReportRunResult, Employee } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as Report[],
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
    employees: [] as Employee[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useListEmployees: () => ({ data: { items: state.employees, total: state.employees.length, page: 1, pageSize: 200 } }),
  getListEmployeesQueryKey: () => ['employees'],
  useRunPersonnelReport: () => ({ data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() }),
  getRunPersonnelReportQueryKey: () => ['runPersonnelReport'],
  getRunPersonnelReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/personnel-records/reports/${key}`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function personnelReport(key: string, label: string): Report {
  return { key, label, description: 'd', category: 'personnel_records' };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PersonnelReports />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.reports = [
    personnelReport('personnel_current_staff_number_allocations', 'Current Staff-Number Allocations'),
    personnelReport('personnel_historical_staff_number_allocations', 'Historical Staff-Number Allocations'),
  ];
  state.catalogLoading = false;
  state.result = undefined;
  state.resultLoading = false;
  state.error = undefined;
  state.employees = [];
}

describe('Personnel Reports page', () => {
  it('shows only personnel_records-category reports in the selector, excluding other categories', () => {
    resetState();
    state.reports = [...state.reports, { key: 'headcount', label: 'Headcount', description: 'd', category: 'workforce' }];
    renderPage();
    expect(screen.getByText('Current Staff-Number Allocations')).toBeInTheDocument();
    expect(screen.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows an empty state when no personnel reports are registered', () => {
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

  it("renders each report's own CURRENT-vs-HISTORICAL description, never inventing its own framing", () => {
    resetState();
    state.result = {
      key: 'personnel_historical_staff_number_allocations',
      label: 'Historical Staff-Number Allocations',
      description: 'HISTORICAL — a reused number always appears as separate rows.',
      generatedAt: new Date().toISOString(),
      columns: [{ key: 'staffNumber', label: 'Staff Number' }],
      rows: [{ staffNumber: 'EMP-0007' }],
    };
    renderPage();
    expect(screen.getByText(/HISTORICAL — a reused number/)).toBeInTheDocument();
  });

  it('renders report columns and rows, using an em dash for null cells', () => {
    resetState();
    state.result = {
      key: 'personnel_current_staff_number_allocations',
      label: 'Current Staff-Number Allocations',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'staffNumber', label: 'Staff Number' },
        { key: 'pifNumber', label: 'PIF Number' },
      ],
      rows: [{ employee: 'Ama Boateng', staffNumber: 'EMP-0001', pifNumber: null }],
    };
    renderPage();
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument();
    const row = screen.getByTestId('row-personnel-report-0');
    expect(row).toHaveTextContent('—');
  });

  it('shows a no-data message for an empty report result', () => {
    resetState();
    state.result = { key: 'personnel_current_staff_number_allocations', label: 'Current Staff-Number Allocations', description: 'd', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    renderPage();
    expect(screen.getByText(/no data for this selection/i)).toBeInTheDocument();
  });

  it('enables the CSV download button once a report is selected', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-download-personnel-report-csv')).not.toBeDisabled();
  });

  it('lists employees in the employee filter for narrowing a report', async () => {
    resetState();
    state.employees = [{ id: 7, organizationId: 10, firstName: 'Kojo', lastName: 'Mensah' } as Employee];
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('select-personnel-report-employee'));
    expect(screen.getByRole('option', { name: 'Kojo Mensah' })).toBeInTheDocument();
  });
});
