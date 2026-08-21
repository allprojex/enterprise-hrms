/**
 * Tests for the Learning Dashboard page (Phase 3D, W92).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LearningDashboard from '@/pages/learning-dashboard';
import type { LearningDashboard as LearningDashboardDto } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    dashboard: undefined as LearningDashboardDto | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetLearningDashboard: () => ({ data: state.dashboard, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetLearningDashboardQueryKey: () => ['learningDashboard'],
}));

function dashboardDto(overrides: Partial<LearningDashboardDto> = {}): LearningDashboardDto {
  return {
    activeCourseCount: 3,
    enrollmentsAssignedCount: 5,
    statusBreakdown: [
      { status: 'assigned', count: 2 },
      { status: 'in_progress', count: 1 },
      { status: 'completed', count: 1 },
      { status: 'failed', count: 0 },
      { status: 'cancelled', count: 1 },
    ],
    pendingApprovalCount: 1,
    overdueCount: 1,
    certificatesExpiringSoonCount: 2,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningDashboard />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.dashboard = undefined;
  state.isLoading = false;
  state.error = undefined;
}

describe('Learning Dashboard page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.isLoading = true;
    renderPage();
    expect(screen.getByText('Learning Dashboard')).toBeInTheDocument();
  });

  it('shows an access-denied message on 403', () => {
    resetState();
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('shows a generic error state with retry otherwise', () => {
    resetState();
    state.error = { status: 500 };
    renderPage();
    expect(screen.getByText(/could not load the dashboard/i)).toBeInTheDocument();
  });

  it('renders every tile with the backend-authoritative counts, zero-filled', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.getByTestId('card-active-courses')).toHaveTextContent('3');
    expect(screen.getByTestId('card-enrollments-assigned')).toHaveTextContent('5');
    expect(screen.getByTestId('card-overdue')).toHaveTextContent('1');
    expect(screen.getByTestId('card-certificates-expiring-soon')).toHaveTextContent('2');
    expect(screen.getByTestId('tile-pending-approval')).toHaveTextContent('Pending approval: 1');
    expect(screen.getByTestId('status-badge-assigned')).toHaveTextContent('Assigned: 2');
    expect(screen.getByTestId('status-badge-failed')).toHaveTextContent('Failed: 0');
    expect(screen.getByTestId('status-badge-cancelled')).toHaveTextContent('Cancelled: 1');
  });

  it('never shows a fabricated completion-rate or compliance-percentage tile', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.queryByText(/completion rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/compliance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
