/**
 * Tests for the Application detail page (Phase 3A, W51).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    referenceChecks: [] as unknown[],
    backgroundChecks: [] as unknown[],
    backgroundChecksError: undefined as unknown,
    offer: undefined as unknown,
    offerError: undefined as unknown,
    requirements: undefined as unknown,
    convertMutate: vi.fn() as (...args: unknown[]) => void,
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
  useListReferenceChecks: () => ({ data: state.referenceChecks }),
  getListReferenceChecksQueryKey: (orgId: number, appId: number) => ['referenceChecks', orgId, appId],
  useCreateReferenceCheck: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateReferenceCheckStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useListBackgroundChecks: () => ({ data: state.backgroundChecks, error: state.backgroundChecksError }),
  getListBackgroundChecksQueryKey: (orgId: number, appId: number) => ['backgroundChecks', orgId, appId],
  useCreateBackgroundCheck: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBackgroundCheckStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useAttachBackgroundCheckEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  getGetBackgroundCheckEvidenceUrl: (orgId: number, appId: number, id: number) => `/api/organizations/${orgId}/applications/${appId}/background-checks/${id}/evidence`,
  useGetOfferForApplication: () => ({ data: state.offer, error: state.offerError }),
  getGetOfferForApplicationQueryKey: (orgId: number, appId: number) => ['offerForApplication', orgId, appId],
  useCreateOffer: () => ({ mutate: vi.fn(), isPending: false }),
  useListPreEmploymentRequirements: () => ({ data: state.requirements }),
  getListPreEmploymentRequirementsQueryKey: (orgId: number, appId: number) => ['preEmploymentRequirements', orgId, appId],
  useCreatePreEmploymentRequirement: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePreEmploymentRequirementStatus: () => ({ mutate: vi.fn(), isPending: false }),
  useConvertApplicationToEmployee: () => ({ mutate: state.convertMutate, isPending: false }),
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

  describe('Reference Checks section', () => {
    it('shows an empty state and a request button', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.referenceChecks = [];
      renderPage();
      expect(screen.getByText(/no reference checks requested yet/i)).toBeInTheDocument();
      expect(screen.getByTestId('button-request-reference-check')).toBeInTheDocument();
    });

    it('renders a requested reference check with a Record Outcome action', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.referenceChecks = [
        { id: 1, organizationId: 10, applicationId: 1, refereeName: 'Alex Manager', refereeContact: 'alex@example.com', refereeRelationship: 'Former Manager', status: 'requested', notes: null, completedAt: null, createdAt: '', updatedAt: '' },
      ];
      renderPage();
      const row = screen.getByTestId('row-reference-check-1');
      expect(row).toHaveTextContent('Alex Manager');
      expect(row).toHaveTextContent('Former Manager');
      expect(row).toHaveTextContent('requested');
      expect(screen.getByTestId('button-record-outcome-1')).toBeInTheDocument();
    });

    it('hides Record Outcome once a reference check is terminal (completed)', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.referenceChecks = [
        { id: 1, organizationId: 10, applicationId: 1, refereeName: 'Alex Manager', refereeContact: 'alex@example.com', refereeRelationship: null, status: 'completed', notes: 'Positive', completedAt: new Date().toISOString(), createdAt: '', updatedAt: '' },
      ];
      renderPage();
      expect(screen.queryByTestId('button-record-outcome-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('row-reference-check-1')).toHaveTextContent('Positive');
    });
  });

  describe('Background Checks section', () => {
    it('shows an empty state and a request button', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.backgroundChecks = [];
      state.backgroundChecksError = undefined;
      renderPage();
      expect(screen.getByText(/no background checks requested yet/i)).toBeInTheDocument();
      expect(screen.getByTestId('button-request-background-check')).toBeInTheDocument();
    });

    it('renders a requested background check with Record Result and Attach Evidence actions', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.backgroundChecksError = undefined;
      state.backgroundChecks = [
        { id: 1, organizationId: 10, applicationId: 1, checkType: 'identity', status: 'requested', vendorReference: null, resultSummary: null, hasEvidence: false, createdAt: '', updatedAt: '' },
      ];
      renderPage();
      const row = screen.getByTestId('row-background-check-1');
      expect(row).toHaveTextContent('identity');
      expect(row).toHaveTextContent('requested');
      expect(screen.getByTestId('button-record-result-1')).toBeInTheDocument();
      expect(screen.queryByTestId('button-download-evidence-1')).not.toBeInTheDocument();
    });

    it('shows a Download Evidence action once evidence is attached, hides upload/result actions once terminal', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.backgroundChecksError = undefined;
      state.backgroundChecks = [
        { id: 1, organizationId: 10, applicationId: 1, checkType: 'identity', status: 'completed', vendorReference: 'REF-1', resultSummary: 'Verified', hasEvidence: true, createdAt: '', updatedAt: '' },
      ];
      renderPage();
      expect(screen.getByTestId('button-download-evidence-1')).toBeInTheDocument();
      expect(screen.queryByTestId('button-record-result-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('row-background-check-1')).toHaveTextContent('Verified');
    });

    it('renders nothing when the caller lacks background_check access (403)', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.backgroundChecks = [];
      state.backgroundChecksError = { error: 'Forbidden' };
      renderPage();
      expect(screen.queryByText(/background checks/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-request-background-check')).not.toBeInTheDocument();
    });
  });

  describe('Offer section', () => {
    it('shows an empty state and a create button when no offer exists yet (404)', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.offer = undefined;
      state.offerError = { status: 404, message: 'Offer not found' };
      renderPage();
      expect(screen.getByText(/no offer created yet/i)).toBeInTheDocument();
      expect(screen.getByTestId('button-create-offer')).toBeInTheDocument();
    });

    it('renders a link to the offer with its current version status when one exists', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.offerError = undefined;
      state.offer = {
        offer: { id: 7, organizationId: 10, applicationId: 1, currentVersionId: 1, createdAt: '', updatedAt: '' },
        versions: [{ id: 1, organizationId: 10, offerId: 7, versionNumber: 1, proposedStartDate: null, employmentType: null, workplaceType: null, location: null, compensationSummary: null, conditions: null, expiryDate: null, letterTemplateId: null, status: 'draft', createdAt: '', updatedAt: '' }],
      };
      renderPage();
      expect(screen.getByTestId('link-offer')).toHaveAttribute('href', '/offers/7');
      expect(screen.getByTestId('link-offer')).toHaveTextContent('draft');
      expect(screen.queryByTestId('button-create-offer')).not.toBeInTheDocument();
    });

    it('renders nothing when the caller lacks offer access (a non-404 error)', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.offer = undefined;
      state.offerError = { status: 403, message: 'Forbidden' };
      renderPage();
      expect(screen.queryByText(/^offer$/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-create-offer')).not.toBeInTheDocument();
    });
  });

  describe('Pre-Employment Requirements section', () => {
    it('shows an empty state and an add button', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.requirements = { items: [], summary: { totalCount: 0, pendingCount: 0, satisfiedCount: 0, waivedCount: 0, readyForConversion: true } };
      renderPage();
      expect(screen.getByText(/no requirements tracked yet/i)).toBeInTheDocument();
      expect(screen.getByTestId('button-add-requirement')).toBeInTheDocument();
    });

    it('renders a pending requirement with an Update Status action', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.requirements = {
        items: [{ id: 1, organizationId: 10, applicationId: 1, requirementCode: 'right_to_work', status: 'pending', satisfiedAt: null, notes: null, createdAt: '', updatedAt: '' }],
        summary: { totalCount: 1, pendingCount: 1, satisfiedCount: 0, waivedCount: 0, readyForConversion: false },
      };
      renderPage();
      const row = screen.getByTestId('row-requirement-1');
      expect(row).toHaveTextContent('right_to_work');
      expect(row).toHaveTextContent('pending');
      expect(screen.getByTestId('button-update-requirement-1')).toBeInTheDocument();
    });

    it('still shows Update Status once satisfied (no terminal immutability)', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.requirements = {
        items: [{ id: 1, organizationId: 10, applicationId: 1, requirementCode: 'right_to_work', status: 'satisfied', satisfiedAt: new Date().toISOString(), notes: 'Verified', createdAt: '', updatedAt: '' }],
        summary: { totalCount: 1, pendingCount: 0, satisfiedCount: 1, waivedCount: 0, readyForConversion: true },
      };
      renderPage();
      expect(screen.getByTestId('row-requirement-1')).toHaveTextContent('satisfied');
      expect(screen.getByTestId('row-requirement-1')).toHaveTextContent('Verified');
      expect(screen.getByTestId('button-update-requirement-1')).toBeInTheDocument();
    });

    it('shows a resolved-count summary in the section description', () => {
      state.application = baseApplication();
      state.isLoading = false;
      state.error = undefined;
      state.requirements = {
        items: [
          { id: 1, organizationId: 10, applicationId: 1, requirementCode: 'right_to_work', status: 'satisfied', satisfiedAt: new Date().toISOString(), notes: null, createdAt: '', updatedAt: '' },
          { id: 2, organizationId: 10, applicationId: 1, requirementCode: 'medical', status: 'pending', satisfiedAt: null, notes: null, createdAt: '', updatedAt: '' },
        ],
        summary: { totalCount: 2, pendingCount: 1, satisfiedCount: 1, waivedCount: 0, readyForConversion: false },
      };
      renderPage();
      expect(screen.getByText('1 of 2 resolved')).toBeInTheDocument();
    });
  });

  describe('Convert to Employee action', () => {
    it('is hidden when the application is not in a hired-category stage', () => {
      state.application = baseApplication({ currentStageCategory: 'screening' });
      state.isLoading = false;
      state.error = undefined;
      state.requirements = { items: [], summary: { totalCount: 0, pendingCount: 0, satisfiedCount: 0, waivedCount: 0, readyForConversion: true } };
      renderPage();
      expect(screen.queryByTestId('button-convert-to-employee')).not.toBeInTheDocument();
    });

    it('is shown but disabled when hired but pre-employment requirements are not all resolved', () => {
      state.application = baseApplication({ currentStageCategory: 'hired' });
      state.isLoading = false;
      state.error = undefined;
      state.requirements = { items: [], summary: { totalCount: 1, pendingCount: 1, satisfiedCount: 0, waivedCount: 0, readyForConversion: false } };
      renderPage();
      expect(screen.getByTestId('button-convert-to-employee')).toBeDisabled();
    });

    it('is enabled when hired and every requirement is resolved', () => {
      state.application = baseApplication({ currentStageCategory: 'hired' });
      state.isLoading = false;
      state.error = undefined;
      state.requirements = { items: [], summary: { totalCount: 0, pendingCount: 0, satisfiedCount: 0, waivedCount: 0, readyForConversion: true } };
      renderPage();
      expect(screen.getByTestId('button-convert-to-employee')).toBeEnabled();
    });

    it('shows a View Employee link after a successful conversion', () => {
      state.application = baseApplication({ currentStageCategory: 'hired' });
      state.isLoading = false;
      state.error = undefined;
      state.requirements = { items: [], summary: { totalCount: 0, pendingCount: 0, satisfiedCount: 0, waivedCount: 0, readyForConversion: true } };
      state.convertMutate = vi.fn((_vars, opts) => opts.onSuccess({ link: { id: 1 }, employeeId: 77, reusedExistingEmployee: false }));
      renderPage();
      fireEvent.click(screen.getByTestId('button-convert-to-employee'));
      expect(screen.getByTestId('link-converted-employee')).toHaveAttribute('href', '/employees/77');
    });
  });
});
