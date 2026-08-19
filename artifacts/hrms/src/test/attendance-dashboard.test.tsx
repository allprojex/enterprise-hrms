/**
 * Tests for the Attendance Dashboard page (Phase 3B, W70).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttendanceDashboard from '@/pages/attendance-dashboard';
import type { AttendanceDashboard as AttendanceDashboardDto } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    dashboard: undefined as AttendanceDashboardDto | undefined,
    isLoading: false,
    error: undefined as unknown,
    calls: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetAttendanceDashboard: (_orgId: number, params: unknown) => {
    state.calls.push(params);
    return { data: state.dashboard, isLoading: state.isLoading, error: state.error, refetch: vi.fn() };
  },
  getGetAttendanceDashboardQueryKey: () => ['attendanceDashboard'],
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceDashboard />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.dashboard = undefined;
  state.isLoading = false;
  state.error = undefined;
  state.calls = [];
}

describe('Attendance Dashboard page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.isLoading = true;
    renderPage();
    expect(screen.getByText('Attendance Dashboard')).toBeInTheDocument();
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

  it('shows a generic error state with retry otherwise', () => {
    resetState();
    state.error = { status: 500 };
    renderPage();
    expect(screen.getByText(/could not load the dashboard/i)).toBeInTheDocument();
  });

  it('renders the total-employees tile and a zero-filled status breakdown', () => {
    resetState();
    state.dashboard = {
      date: '2026-03-02',
      totalEmployeesCount: 3,
      statusBreakdown: [
        { status: 'present', count: 1 },
        { status: 'late', count: 0 },
        { status: 'partial', count: 0 },
        { status: 'absent', count: 2 },
        { status: 'on_leave', count: 0 },
        { status: 'holiday', count: 0 },
        { status: 'non_working_day', count: 0 },
        { status: null, count: 0 },
      ],
    };
    renderPage();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-present')).toHaveTextContent('Present: 1');
    expect(screen.getByTestId('status-badge-absent')).toHaveTextContent('Absent: 2');
    expect(screen.getByTestId('status-badge-late')).toHaveTextContent('Late: 0');
    expect(screen.getByTestId('status-badge-not_applicable')).toHaveTextContent('Not Applicable: 0');
  });

  it('shows an empty-scope message when totalEmployeesCount is zero', () => {
    resetState();
    state.dashboard = { date: '2026-03-02', totalEmployeesCount: 0, statusBreakdown: [] };
    renderPage();
    expect(screen.getByText(/no employees in scope for this date/i)).toBeInTheDocument();
  });

  it('displays the backend-resolved date, not a browser-computed one, until the caller picks one', () => {
    resetState();
    state.dashboard = { date: '2026-03-02', totalEmployeesCount: 1, statusBreakdown: [] };
    renderPage();
    expect(screen.getByTestId('input-attendance-dashboard-date')).toHaveValue('2026-03-02');
  });
});
