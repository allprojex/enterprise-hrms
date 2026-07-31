/**
 * Tests for the Interview Scorecard page (Phase 3A, W55 — Interview
 * Scorecards). @workspace/api-client-react is mocked at the hook level — no
 * real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import InterviewScorecard from '@/pages/interview-scorecard';
import type { Interview, InterviewScorecardListResponse } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    interview: undefined as Interview | undefined,
    interviewLoading: false,
    interviewError: undefined as unknown,
    result: undefined as InterviewScorecardListResponse | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetInterview: () => ({ data: state.interview, isLoading: state.interviewLoading, error: state.interviewError, refetch: vi.fn() }),
  getGetInterviewQueryKey: (orgId: number, id: number) => ['interview', orgId, id],
  useListInterviewScorecards: () => ({ data: state.result, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListInterviewScorecardsQueryKey: (orgId: number, id: number) => ['interviewScorecards', orgId, id],
  useSaveInterviewScorecard: () => ({ mutate: vi.fn(), isPending: false }),
  useFinalizeInterviewScorecard: () => ({ mutate: vi.fn(), isPending: false }),
  useListMembers: () => ({
    data: [
      { membershipId: 5, applicationUserId: 1, email: 'me@example.com', firstName: 'My', lastName: 'Self', status: 'active', roles: [], isPrimaryHr: false },
      { membershipId: 6, applicationUserId: 2, email: 'colleague@example.com', firstName: 'Col', lastName: 'League', status: 'active', roles: [], isPrimaryHr: false },
    ],
  }),
  getListMembersQueryKey: (orgId: number) => ['members', orgId],
}));

function baseInterview(overrides: Partial<Interview> = {}): Interview {
  return {
    id: 1,
    organizationId: 10,
    applicationId: 500,
    interviewType: 'virtual',
    scheduledAt: new Date().toISOString(),
    durationMinutes: 45,
    location: null,
    meetingLink: null,
    status: 'scheduled',
    outcome: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    panelMembers: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/interviews/1/scorecard', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/interviews/:id/scorecard">{() => <InterviewScorecard />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Interview Scorecard page', () => {
  it('shows a loading state without crashing', () => {
    state.interview = undefined;
    state.interviewLoading = true;
    state.interviewError = undefined;
    state.result = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('select-recommendation')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.interview = undefined;
    state.interviewLoading = false;
    state.interviewError = { error: 'boom' };
    state.result = undefined;
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/could not load this scorecard/i)).toBeInTheDocument();
  });

  it('shows a cancelled-interview notice and hides the evaluation form', () => {
    state.interview = baseInterview({ status: 'cancelled' });
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = { scorecards: [], panelSummary: null };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('notice-interview-cancelled')).toBeInTheDocument();
    expect(screen.queryByTestId('select-recommendation')).not.toBeInTheDocument();
  });

  it('shows a blank draft evaluation form for a panel member with no scorecard yet', () => {
    state.interview = baseInterview();
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = { scorecards: [], panelSummary: null };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('select-recommendation')).toBeInTheDocument();
    expect(screen.getByTestId('button-save-draft')).toBeInTheDocument();
    expect(screen.getByTestId('button-open-submit-confirm')).toBeInTheDocument();
  });

  it('shows a submit confirmation dialog warning about immutability before submitting', () => {
    state.interview = baseInterview();
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = { scorecards: [], panelSummary: null };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    fireEvent.click(screen.getByTestId('button-open-submit-confirm'));
    expect(screen.getByText(/immutable and cannot be changed/i)).toBeInTheDocument();
  });

  it('renders my own submitted scorecard as read-only, disabling form inputs', () => {
    state.interview = baseInterview();
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = {
      scorecards: [
        {
          id: 1,
          organizationId: 10,
          interviewId: 1,
          interviewerMembershipId: 5,
          recommendation: 'yes',
          overallComment: 'Good candidate',
          submittedAt: new Date().toISOString(),
          finalizedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          responses: [{ id: 1, organizationId: 10, scorecardId: 1, criterion: 'Communication', rating: 4, comment: null, createdAt: new Date().toISOString() }],
        },
      ],
      panelSummary: null,
    };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('select-recommendation')).toBeDisabled();
    expect(screen.queryByTestId('button-save-draft')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-open-submit-confirm')).not.toBeInTheDocument();
  });

  it('shows the panel completion summary and per-evaluator list for a read_all holder', () => {
    state.interview = baseInterview();
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = {
      scorecards: [
        {
          id: 1,
          organizationId: 10,
          interviewId: 1,
          interviewerMembershipId: 6,
          recommendation: 'strong_yes',
          overallComment: null,
          submittedAt: new Date().toISOString(),
          finalizedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          responses: [],
        },
      ],
      panelSummary: { totalPanelMembers: 2, submittedCount: 1, pendingCount: 1, recommendationCounts: { strong_yes: 1, yes: 0, no: 0, strong_no: 0 } },
    };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('text-total-panel-members')).toHaveTextContent('2');
    expect(screen.getByTestId('text-submitted-count')).toHaveTextContent('1');
    expect(screen.getByTestId('text-pending-count')).toHaveTextContent('1');
    expect(screen.getByTestId('row-evaluator-scorecard-1')).toHaveTextContent('Col League');
    expect(screen.getByTestId('button-finalize-1')).toBeInTheDocument();
  });

  it('hides the finalize button for an already-finalized scorecard', () => {
    state.interview = baseInterview();
    state.interviewLoading = false;
    state.interviewError = undefined;
    state.result = {
      scorecards: [
        {
          id: 1,
          organizationId: 10,
          interviewId: 1,
          interviewerMembershipId: 6,
          recommendation: 'yes',
          overallComment: null,
          submittedAt: new Date().toISOString(),
          finalizedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          responses: [],
        },
      ],
      panelSummary: { totalPanelMembers: 1, submittedCount: 1, pendingCount: 0, recommendationCounts: { strong_yes: 0, yes: 1, no: 0, strong_no: 0 } },
    };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-finalize-1')).not.toBeInTheDocument();
    expect(screen.getByText(/finalized/i)).toBeInTheDocument();
  });
});
