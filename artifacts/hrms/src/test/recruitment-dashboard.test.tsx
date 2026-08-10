/**
 * Tests for the Recruitment Dashboard page (Phase 3A, W61).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import RecruitmentDashboard from '@/pages/recruitment-dashboard';
import type { RecruitmentDashboard as RecruitmentDashboardDto } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    data: undefined as RecruitmentDashboardDto | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetRecruitmentDashboard: () => ({ data: state.data, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetRecruitmentDashboardQueryKey: (orgId: number) => ['recruitment-dashboard', orgId],
}));

function emptyDashboard(overrides: Partial<RecruitmentDashboardDto> = {}): RecruitmentDashboardDto {
  return {
    openRequisitionsCount: 0,
    openVacanciesCount: 0,
    totalApplicantsCount: 0,
    candidatesByStage: [],
    recruiterWorkload: [],
    hiringManagerWorkload: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/recruitment', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <RecruitmentDashboard />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Recruitment Dashboard page', () => {
  it('shows a loading state without crashing', () => {
    state.data = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('recruitment-dashboard-tiles')).not.toBeInTheDocument();
  });

  it('shows a generic error state for a non-403 failure', () => {
    state.data = undefined;
    state.isLoading = false;
    state.error = { status: 500, error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load the dashboard/i)).toBeInTheDocument();
  });

  it('shows a denied state for a 403', () => {
    state.data = undefined;
    state.isLoading = false;
    state.error = { status: 403, error: 'Forbidden' };
    renderPage();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it('renders real zeros for an empty organization, not an error', () => {
    state.data = emptyDashboard();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const tiles = screen.getByTestId('recruitment-dashboard-tiles');
    expect(tiles).toHaveTextContent('0');
    expect(screen.getByText(/no applicants in scope yet/i)).toBeInTheDocument();
  });

  it('renders tiles, stage breakdown, and workload tables with real data', () => {
    state.data = emptyDashboard({
      openRequisitionsCount: 3,
      openVacanciesCount: 2,
      totalApplicantsCount: 15,
      candidatesByStage: [{ stageId: 1, stageName: 'Screening', category: 'screening', count: 5 }],
      recruiterWorkload: [{ employeeId: 7, employeeName: 'Ama Recruiter', openRequisitionsCount: 2 }],
      hiringManagerWorkload: [{ employeeId: 8, employeeName: 'Kofi Manager', openRequisitionsCount: 1 }],
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();

    expect(screen.getByTestId('tile-open-requisitions')).toHaveTextContent('3');
    expect(screen.getByTestId('tile-open-vacancies')).toHaveTextContent('2');
    expect(screen.getByTestId('tile-total-applicants')).toHaveTextContent('15');
    expect(screen.getByTestId('card-candidates-by-stage')).toHaveTextContent('Screening: 5');
    expect(screen.getByTestId('row-recruiter-workload-7')).toHaveTextContent('Ama Recruiter');
    expect(screen.getByTestId('row-hiring-manager-workload-8')).toHaveTextContent('Kofi Manager');
  });
});
