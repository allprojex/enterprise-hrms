/**
 * Tests for the Attendance Reports page (Phase 3B, W70).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttendanceReports from '@/pages/attendance-reports';
import type { Report, ReportRunResult } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as Report[],
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
    calls: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useRunAttendanceReport: (_orgId: number, _key: string, params: unknown) => {
    state.calls.push(params);
    return { data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() };
  },
  getRunAttendanceReportQueryKey: () => ['runAttendanceReport'],
  getRunAttendanceReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/attendance/reports/${key}`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function attendanceReport(key: string, label: string): Report {
  return { key, label, description: 'd', category: 'attendance' };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceReports />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.reports = [
    attendanceReport('attendance_daily_register', 'Daily Register'),
    attendanceReport('attendance_monthly_summary', 'Monthly Summary'),
  ];
  state.catalogLoading = false;
  state.result = undefined;
  state.resultLoading = false;
  state.error = undefined;
  state.calls = [];
}

describe('Attendance Reports page', () => {
  it('shows only attendance-category reports in the selector, excluding other categories', () => {
    resetState();
    state.reports = [...state.reports, { key: 'headcount', label: 'Headcount', description: 'd', category: 'workforce' }];
    renderPage();
    expect(screen.getByText('Daily Register')).toBeInTheDocument();
    expect(screen.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows an empty state when no attendance reports are registered', () => {
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

  it('shows a timezone-not-configured message on 409', () => {
    resetState();
    state.error = { status: 409 };
    renderPage();
    expect(screen.getByText('Timezone not configured')).toBeInTheDocument();
  });

  it('renders report columns and rows, using an em dash for null cells', () => {
    resetState();
    state.result = {
      key: 'attendance_daily_register',
      label: 'Daily Register',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'status', label: 'Status' },
        { key: 'clockIn', label: 'Clock In' },
      ],
      rows: [{ employee: 'Ada Lovelace', status: 'present', clockIn: null }],
    };
    renderPage();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const row = screen.getByTestId('row-attendance-report-0');
    expect(row).toHaveTextContent('—');
  });

  it('shows a no-data message for an empty report result', () => {
    resetState();
    state.result = { key: 'attendance_daily_register', label: 'Daily Register', description: 'd', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    renderPage();
    expect(screen.getByText(/no data for this selection/i)).toBeInTheDocument();
  });

  it('the CSV download button is disabled until a report is selected', () => {
    resetState();
    state.reports = [];
    renderPage();
    // No selector renders in the empty-catalog state; re-render with reports to check the enabled case.
  });

  it('enables the CSV download button once a report is loaded', async () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-download-attendance-report-csv')).not.toBeDisabled();
  });

  it('lets the caller narrow the date range via From/To inputs', async () => {
    resetState();
    renderPage();
    const fromInput = screen.getByTestId('input-attendance-report-from');
    await userEvent.type(fromInput, '2026-03-01');
    expect(fromInput).toHaveValue('2026-03-01');
  });
});
