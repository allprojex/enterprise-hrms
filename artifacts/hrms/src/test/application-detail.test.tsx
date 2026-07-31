/**
 * Tests for the Application detail page (Phase 3A, W51).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import ApplicationDetail from '@/pages/application-detail';
import type { ApplicationDetail as ApplicationDetailType } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    application: undefined as ApplicationDetailType | undefined,
    isLoading: false,
    error: undefined as unknown,
    interviews: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetApplication: () => ({ data: state.application, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetApplicationQueryKey: (orgId: number, id: number) => ['application', orgId, id],
  useGetVacancy: () => ({ data: { id: 100, workflowId: 300 } }),
  getGetVacancyQueryKey: (orgId: number, id: number) => ['vacancy', orgId, id],
  useListRecruitmentStages: () => ({
    data: [
      { id: 1, organizationId: 10, workflowId: 300, name: 'Applied', category: 'applied', displayOrder: 0, isRequired: false, isTerminal: false, isActive: true, createdAt: '', updatedAt: '' },
      { id: 2, organizationId: 10, workflowId: 300, name: 'Screening', category: 'screening', displayOrder: 1, isRequired: false, isTerminal: false, isActive: true, createdAt: '', updatedAt: '' },
    ],
  }),
  getListRecruitmentStagesQueryKey: (orgId: number, workflowId: number) => ['stages', orgId, workflowId],
  useMoveApplicationStage: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectApplication: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawApplication: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenApplication: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitApplicationScore: () => ({ mutate: vi.fn(), isPending: false }),
  useListApplicationInterviews: () => ({ data: state.interviews, refetch: vi.fn() }),
  getListApplicationInterviewsQueryKey: (orgId: number, appId: number) => ['applicationInterviews', orgId, appId],
  useScheduleInterview: () => ({ mutate: vi.fn(), isPending: false }),
}));

function baseApplication(overrides: Partial<ApplicationDetailType> = {}): ApplicationDetailType {
  return {
    id: 1,
    vacancyId: 100,
    vacancyTitle: 'Software Engineer',
    candidateId: 200,
    candidateName: 'Jane Doe',
    candidateEmail: 'jane@example.com',
    candidatePhone: '555-1234',
    currentStageId: null,
    currentStageName: null,
    currentStageCategory: 'applied',
    rejectionReasonCode: null,
    withdrawalReasonCode: null,
    submittedAt: new Date().toISOString(),
    documents: [],
    history: [],
    answers: [],
    scores: [],
    scoreRollup: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/applications/1', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/applications/:id">{() => <ApplicationDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Application detail page', () => {
  it('shows a loading state without crashing', () => {
    state.application = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('badge-application-stage')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.application = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this application/i)).toBeInTheDocument();
  });

  it('renders candidate info and current stage', () => {
    state.application = baseApplication();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-1234')).toBeInTheDocument();
    expect(screen.getByTestId('badge-application-stage')).toHaveTextContent('applied');
  });

  it('shows reject/withdraw actions and the move-stage control for a non-terminal application', () => {
    state.application = baseApplication({ currentStageCategory: 'screening' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-reject-application')).toBeInTheDocument();
    expect(screen.getByTestId('button-withdraw-application')).toBeInTheDocument();
    expect(screen.getByTestId('select-move-target-stage')).toBeInTheDocument();
    expect(screen.queryByTestId('button-reopen-application')).not.toBeInTheDocument();
  });

  it('shows only reopen for a terminal (rejected) application, hiding reject/withdraw/move controls', () => {
    state.application = baseApplication({ currentStageCategory: 'rejected', rejectionReasonCode: 'not_qualified' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-reopen-application')).toBeInTheDocument();
    expect(screen.queryByTestId('button-reject-application')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-withdraw-application')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-move-target-stage')).not.toBeInTheDocument();
    expect(screen.getByText('not_qualified')).toBeInTheDocument();
  });

  it('renders immutable history entries', () => {
    state.application = baseApplication({
      history: [
        { id: 1, organizationId: 10, applicationId: 1, fromStageId: null, toStageId: 1, movedByMembershipId: 5, reason: 'Initial triage', movedAt: new Date().toISOString() },
      ],
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-history-1')).toHaveTextContent('Initial triage');
  });

  it('shows empty states when there is no history or documents', () => {
    state.application = baseApplication();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no movements recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no documents uploaded/i)).toBeInTheDocument();
  });

  it('renders uploaded documents', () => {
    state.application = baseApplication({ documents: [{ id: 1, categoryCode: 'resume', fileName: 'resume.pdf', mimeType: 'application/pdf', fileSize: 1024 }] });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-document-1')).toHaveTextContent('resume.pdf');
  });

  it('renders screening answers, flagging a failed knockout', () => {
    state.application = baseApplication({
      answers: [
        { id: 1, vacancyQuestionId: 10, questionText: 'Authorized to work?', answerText: 'no', knockoutFailed: true, createdAt: new Date().toISOString() },
        { id: 2, vacancyQuestionId: 11, questionText: 'Years of experience?', answerText: '5', knockoutFailed: false, createdAt: new Date().toISOString() },
      ],
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-answer-1')).toHaveTextContent('Authorized to work?');
    expect(screen.getByTestId('badge-knockout-failed-1')).toBeInTheDocument();
    expect(screen.queryByTestId('badge-knockout-failed-2')).not.toBeInTheDocument();
  });

  it('does not render a screening answers card when there are no answers', () => {
    state.application = baseApplication();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByText(/screening answers/i)).not.toBeInTheDocument();
  });

  it('renders score entries and the computed rollup badge', () => {
    state.application = baseApplication({
      scores: [{ id: 1, organizationId: 10, applicationId: 1, scoredByMembershipId: 5, scoreType: 'screening', score: '8.0', notes: 'Strong candidate', createdAt: new Date().toISOString() }],
      scoreRollup: 8,
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-score-1')).toHaveTextContent('Strong candidate');
    expect(screen.getByTestId('badge-score-rollup')).toHaveTextContent('8.0');
  });

  it('shows the score-entry form for a non-terminal application, hidden for a terminal one', () => {
    state.application = baseApplication({ currentStageCategory: 'screening' });
    state.isLoading = false;
    state.error = undefined;
    const { unmount } = renderPage();
    expect(screen.getByTestId('button-submit-score')).toBeInTheDocument();
    unmount();

    state.application = baseApplication({ currentStageCategory: 'rejected' });
    renderPage();
    expect(screen.queryByTestId('button-submit-score')).not.toBeInTheDocument();
  });

  it('shows an empty state when no scores have been submitted yet', () => {
    state.application = baseApplication();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no scores submitted yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('badge-score-rollup')).not.toBeInTheDocument();
  });
});
