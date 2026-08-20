/**
 * Tests for the My Team Reviews page (Phase 3C, W78).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceTeam from '@/pages/performance-team';
import type { PerformanceReview, PerformanceReviewCompetency, PerformanceGoal, Employee } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    teamReviews: [] as PerformanceReview[],
    teamReviewsLoading: false,
    teamReviewsError: undefined as unknown,
    employees: [] as Employee[],
    detail: undefined as { review: PerformanceReview; competencies: PerformanceReviewCompetency[]; goals: PerformanceGoal[] } | undefined,
    detailLoading: false,
    ratingScale: { scale: { id: 1, name: 'Standard' }, levels: [{ id: 1, ratingScaleId: 1, value: 1, label: 'Low', sortOrder: 0 }, { id: 2, ratingScaleId: 1, value: 5, label: 'High', sortOrder: 1 }] },
    rateMutate: vi.fn() as (...args: unknown[]) => void,
    createGoalMutate: vi.fn() as (...args: unknown[]) => void,
    updateGoalMutate: vi.fn() as (...args: unknown[]) => void,
    acceptMutate: vi.fn() as (...args: unknown[]) => void,
    rejectMutate: vi.fn() as (...args: unknown[]) => void,
    submitMutate: vi.fn() as (...args: unknown[]) => void,
    submitPending: false,
    submitError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListTeamPerformanceReviews: () => ({ data: state.teamReviews, isLoading: state.teamReviewsLoading, error: state.teamReviewsError, refetch: vi.fn() }),
  getListTeamPerformanceReviewsQueryKey: () => ['teamReviews'],
  useGetPerformanceReview: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined, refetch: vi.fn() }),
  getGetPerformanceReviewQueryKey: () => ['reviewDetail'],
  useGetPerformanceRatingScale: () => ({ data: state.ratingScale }),
  getGetPerformanceRatingScaleQueryKey: () => ['ratingScale'],
  useRateCompetency: () => ({ mutate: state.rateMutate, isPending: false }),
  useCreatePerformanceReviewGoal: () => ({ mutate: state.createGoalMutate, isPending: false }),
  useUpdatePerformanceReviewGoal: () => ({ mutate: state.updateGoalMutate, isPending: false }),
  useAcceptPerformanceReviewGoal: () => ({ mutate: state.acceptMutate, isPending: false }),
  useRejectPerformanceReviewGoal: () => ({ mutate: state.rejectMutate, isPending: false }),
  useSubmitManagerReview: () => ({ mutate: state.submitMutate, isPending: state.submitPending, isError: !!state.submitError, error: state.submitError }),
  // Evidence/Attachments (W82) — embedded via PerformanceEvidenceSection, not under test on this page's own suite.
  useListPerformanceReviewEvidence: () => ({ data: [], isLoading: false, error: undefined }),
  getListPerformanceReviewEvidenceQueryKey: () => ['performanceReviewEvidence'],
  useAddPerformanceReviewEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  CreatePerformanceReviewGoalInputMeasurementType: {
    numeric: 'numeric', percentage: 'percentage', currency: 'currency', boolean: 'boolean', rating: 'rating', qualitative: 'qualitative',
  },
}));

function review(overrides: Partial<PerformanceReview> = {}): PerformanceReview {
  return {
    id: 1, organizationId: 10, cycleId: 1, templateId: 1, ratingScaleId: 1, employeeId: 42, reviewerEmployeeId: 7,
    goalsWeight: 60, competenciesWeight: 40, scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true,
    status: 'manager_review', revisionNumber: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function competency(overrides: Partial<PerformanceReviewCompetency> = {}): PerformanceReviewCompetency {
  return { id: 1, organizationId: 10, reviewId: 1, label: 'Delivery', weight: 100, sortOrder: 0, notApplicable: false, ...overrides };
}
function goal(overrides: Partial<PerformanceGoal> = {}): PerformanceGoal {
  return {
    id: 1, organizationId: 10, reviewId: 1, title: 'Ship X', measurementType: 'numeric', weight: 100,
    status: 'not_started', originType: 'manager', approvalStatus: 'accepted', notApplicable: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function employee(overrides: Partial<Employee> = {}): Employee {
  return { id: 42, firstName: 'Ada', lastName: 'Lovelace' } as Employee;
}

function resetState() {
  state.teamReviews = [];
  state.teamReviewsLoading = false;
  state.teamReviewsError = undefined;
  state.employees = [employee()];
  state.detail = undefined;
  state.detailLoading = false;
  state.rateMutate = vi.fn();
  state.createGoalMutate = vi.fn();
  state.updateGoalMutate = vi.fn();
  state.acceptMutate = vi.fn();
  state.rejectMutate = vi.fn();
  state.submitMutate = vi.fn();
  state.submitPending = false;
  state.submitError = undefined;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceTeam />
    </QueryClientProvider>,
  );
}

describe('My Team Reviews page', () => {
  it('shows an empty state when no reviews are assigned', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no team reviews assigned/i)).toBeInTheDocument();
  });

  it('lists assigned reviews with the resolved employee name', () => {
    resetState();
    state.teamReviews = [review()];
    renderPage();
    const row = screen.getByTestId('row-team-review-1');
    expect(row).toHaveTextContent('Ada Lovelace');
  });

  it('opens a review and shows its goals and competencies', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [competency()], goals: [goal()] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    expect(screen.getByTestId('row-manager-goal-1')).toHaveTextContent('Ship X');
    expect(screen.getByTestId('row-manager-competency-1')).toHaveTextContent('Delivery');
  });

  it('shows accept/reject controls for a proposed goal, not for an accepted one', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [goal({ id: 1, approvalStatus: 'proposed', originType: 'employee_proposed' }), goal({ id: 2, approvalStatus: 'accepted' })] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    expect(screen.getByTestId('button-accept-goal-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-goal-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-accept-goal-2')).not.toBeInTheDocument();
  });

  it('accepts a proposed goal through the W76 accept API', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [goal({ approvalStatus: 'proposed', originType: 'employee_proposed' })] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('button-accept-goal-1'));
    expect(state.acceptMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, goalId: 1 }),
      expect.anything(),
    );
  });

  it('rejects a proposed goal with a required reason', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [goal({ approvalStatus: 'proposed', originType: 'employee_proposed' })] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('button-reject-goal-1'));
    await userEvent.type(screen.getByTestId('input-reject-reason-1'), 'Not aligned');
    await userEvent.click(screen.getByTestId('button-confirm-reject-goal-1'));
    expect(state.rejectMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, goalId: 1, data: { reason: 'Not aligned' } }),
      expect.anything(),
    );
  });

  it('saves an official goal actual result', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [goal()] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.type(screen.getByTestId('input-goal-actual-1'), '8');
    await userEvent.click(screen.getByTestId('button-save-goal-result-1'));
    expect(state.updateGoalMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, goalId: 1, data: expect.objectContaining({ actualResult: 8 }) }),
      expect.anything(),
    );
  });

  it('saves a competency manager rating using the real configured scale levels, not hardcoded 1-5', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [competency()], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('select-manager-rating-1'));
    await userEvent.click(screen.getByRole('option', { name: /High/i }));
    await userEvent.click(screen.getByTestId('button-save-manager-competency-1'));
    expect(state.rateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, competencyId: 1, data: expect.objectContaining({ managerRatingValue: 5 }) }),
      expect.anything(),
    );
  });

  it('marks a competency not applicable with a required reason before Save is enabled', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [competency()], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('checkbox-competency-na-1'));
    expect(screen.getByTestId('button-save-manager-competency-1')).toBeDisabled();
    await userEvent.type(screen.getByTestId('input-competency-na-reason-1'), 'Role changed');
    expect(screen.getByTestId('button-save-manager-competency-1')).not.toBeDisabled();
  });

  it('shows every readiness problem on a blocked submission', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [competency()], goals: [] };
    state.submitError = { error: 'not ready', problems: ['Competency "Delivery" is missing your rating', 'Something else'] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    const problems = screen.getByTestId('text-manager-submission-problems');
    expect(problems).toHaveTextContent('Delivery');
    expect(problems).toHaveTextContent('Something else');
  });

  it('submits the manager review', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('button-submit-manager-review'));
    expect(state.submitMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1 }),
      expect.anything(),
    );
  });

  it('locks all controls once the review has moved to hr_review', async () => {
    resetState();
    state.teamReviews = [review({ status: 'hr_review' })];
    state.detail = { review: review({ status: 'hr_review' }), competencies: [competency({ managerRatingValue: '5' })], goals: [goal({ actualResult: '8' })] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    expect(screen.queryByTestId('button-submit-manager-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-create-official-goal')).not.toBeInTheDocument();
    expect(screen.getByTestId('select-manager-rating-1')).toBeDisabled();
  });

  it('adds an official goal directly through the create-goal API', async () => {
    resetState();
    state.teamReviews = [review()];
    state.detail = { review: review(), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('row-team-review-1'));
    await userEvent.click(screen.getByTestId('button-create-official-goal'));
    await userEvent.type(screen.getByTestId('input-manager-goal-title'), 'Reduce backlog');
    await userEvent.click(screen.getByTestId('select-manager-goal-type'));
    await userEvent.click(screen.getByRole('option', { name: 'Qualitative' }));
    await userEvent.click(screen.getByTestId('button-submit-create-official-goal'));
    expect(state.createGoalMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ title: 'Reduce backlog', measurementType: 'qualitative' }) }),
      expect.anything(),
    );
  });
});
