/**
 * Tests for the Performance Dashboard page (Phase 3C, W81).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceDashboard from '@/pages/performance-dashboard';
import type { PerformanceDashboard as PerformanceDashboardDto, PerformanceCycle } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    dashboard: undefined as PerformanceDashboardDto | undefined,
    isLoading: false,
    error: undefined as unknown,
    cycles: [] as PerformanceCycle[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListPerformanceCycles: () => ({ data: state.cycles }),
  getListPerformanceCyclesQueryKey: () => ['cycles'],
  useGetPerformanceDashboard: () => ({ data: state.dashboard, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetPerformanceDashboardQueryKey: () => ['performanceDashboard'],
}));

function dashboardDto(overrides: Partial<PerformanceDashboardDto> = {}): PerformanceDashboardDto {
  return {
    cycleId: null,
    activeCycleCount: 1,
    employeesAssignedCount: 2,
    statusBreakdown: [
      { status: 'draft', count: 0 },
      { status: 'self_assessment', count: 1 },
      { status: 'manager_review', count: 1 },
      { status: 'hr_review', count: 0 },
      { status: 'finalized', count: 0 },
      { status: 'acknowledged', count: 0 },
    ],
    selfAssessmentPendingCount: 1,
    selfAssessmentSubmittedCount: 1,
    managerReviewPendingCount: 1,
    managerReviewSubmittedCount: 0,
    proposedGoalsAwaitingDecisionCount: 2,
    finalizedCount: 0,
    acknowledgedCount: 0,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceDashboard />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.dashboard = undefined;
  state.isLoading = false;
  state.error = undefined;
  state.cycles = [];
}

describe('Performance Dashboard page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.isLoading = true;
    renderPage();
    expect(screen.getByText('Performance Dashboard')).toBeInTheDocument();
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
    expect(screen.getByTestId('card-active-cycles')).toHaveTextContent('1');
    expect(screen.getByTestId('card-employees-assigned')).toHaveTextContent('2');
    expect(screen.getByTestId('card-proposed-goals')).toHaveTextContent('2');
    expect(screen.getByTestId('tile-self-assessment-pending')).toHaveTextContent('Pending: 1');
    expect(screen.getByTestId('tile-self-assessment-submitted')).toHaveTextContent('Submitted: 1');
    expect(screen.getByTestId('tile-manager-review-pending')).toHaveTextContent('Pending: 1');
    expect(screen.getByTestId('tile-manager-review-submitted')).toHaveTextContent('Submitted: 0');
    expect(screen.getByTestId('status-badge-draft')).toHaveTextContent('Draft: 0');
    expect(screen.getByTestId('status-badge-hr_review')).toHaveTextContent('HR Review: 0');
    expect(screen.getByTestId('status-badge-finalized')).toHaveTextContent('Finalized: 0');
    expect(screen.getByTestId('status-badge-acknowledged')).toHaveTextContent('Acknowledged: 0');
  });

  it('never shows a fabricated average-score or completion-percentage tile', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.queryByText(/average score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/completion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
