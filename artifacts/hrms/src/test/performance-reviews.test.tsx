/**
 * Tests for the Performance Reviews internal HR workspace page (Phase 3C, W80).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceReviews from '@/pages/performance-reviews';
import type {
  PerformanceReview,
  PerformanceReviewCompetency,
  PerformanceGoal,
  Employee,
  PerformanceCycle,
  Department,
  Position,
  MembershipSummary,
} from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    list: { items: [] as PerformanceReview[], total: 0, page: 1, pageSize: 20 },
    listLoading: false,
    listError: undefined as unknown,
    employees: [] as Employee[],
    cycles: [] as PerformanceCycle[],
    departments: [] as Department[],
    positions: [] as Position[],
    detail: undefined as { review: PerformanceReview; competencies: PerformanceReviewCompetency[]; goals: PerformanceGoal[] } | undefined,
    detailLoading: false,
    finalizeMutate: vi.fn() as (...args: unknown[]) => void,
    reopenMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPerformanceReviews: () => ({ data: state.list, isLoading: state.listLoading, error: state.listError, refetch: vi.fn() }),
  getListPerformanceReviewsQueryKey: () => ['reviews'],
  useGetPerformanceReview: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined, refetch: vi.fn() }),
  getGetPerformanceReviewQueryKey: () => ['reviewDetail'],
  useListPerformanceCycles: () => ({ data: state.cycles }),
  getListPerformanceCyclesQueryKey: () => ['cycles'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListPositions: () => ({ data: state.positions }),
  getListPositionsQueryKey: () => ['positions'],
  useFinalizePerformanceReview: () => ({ mutate: state.finalizeMutate, isPending: false }),
  useReopenPerformanceReview: () => ({ mutate: state.reopenMutate, isPending: false }),
  // Evidence/Attachments (W82) — embedded via PerformanceEvidenceSection, not under test on this page's own suite.
  useListPerformanceReviewEvidence: () => ({ data: [], isLoading: false, error: undefined }),
  getListPerformanceReviewEvidenceQueryKey: () => ['performanceReviewEvidence'],
  useAddPerformanceReviewEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  getListTeamPerformanceReviewsQueryKey: () => ['teamReviews'],
  ListPerformanceReviewsStatus: {
    draft: 'draft', self_assessment: 'self_assessment', manager_review: 'manager_review',
    hr_review: 'hr_review', finalized: 'finalized', acknowledged: 'acknowledged',
  },
  ReopenPerformanceReviewInputTargetStage: {
    self_assessment: 'self_assessment', manager_review: 'manager_review', hr_review: 'hr_review',
  },
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, status: 'active', roles, isPrimaryHr: false };
}

function review(overrides: Partial<PerformanceReview> = {}): PerformanceReview {
  return {
    id: 1, organizationId: 10, cycleId: 1, templateId: 1, ratingScaleId: 1, employeeId: 42, reviewerEmployeeId: 7,
    departmentIdSnapshot: 5, positionIdSnapshot: 9,
    goalsWeight: 60, competenciesWeight: 40, scoringPrecisionSnapshot: 2, acknowledgementRequiredSnapshot: true,
    status: 'hr_review', revisionNumber: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function employee(overrides: Partial<Employee> = {}): Employee {
  return { id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '', ...overrides } as Employee;
}
function reviewer(): Employee {
  return { id: 7, firstName: 'Grace', lastName: 'Hopper', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '' } as Employee;
}
function cycle(): PerformanceCycle {
  return {
    id: 1, organizationId: 10, name: '2026 Annual Cycle', cycleType: 'annual', startDate: '2026-01-01', endDate: '2026-12-31',
    templateId: 1, ratingScaleId: 1, applicabilityScope: 'all_active', status: 'open', createdAt: new Date().toISOString(),
  } as PerformanceCycle;
}
function department(): Department {
  return { id: 5, organizationId: 10, name: 'Engineering', code: 'ENG', status: 'active', createdAt: new Date().toISOString() } as Department;
}
function position(): Position {
  return { id: 9, organizationId: 10, title: 'Software Engineer', status: 'active', createdAt: new Date().toISOString() } as Position;
}
function competency(overrides: Partial<PerformanceReviewCompetency> = {}): PerformanceReviewCompetency {
  return { id: 1, organizationId: 10, reviewId: 1, label: 'Delivery', weight: 100, sortOrder: 0, notApplicable: false, ...overrides };
}
function goal(overrides: Partial<PerformanceGoal> = {}): PerformanceGoal {
  return {
    id: 1, organizationId: 10, reviewId: 1, title: 'Ship X', measurementType: 'numeric', weight: 100,
    status: 'completed', originType: 'manager', approvalStatus: 'accepted', notApplicable: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.list = { items: [], total: 0, page: 1, pageSize: 20 };
  state.listLoading = false;
  state.listError = undefined;
  state.employees = [employee(), reviewer()];
  state.cycles = [cycle()];
  state.departments = [department()];
  state.positions = [position()];
  state.detail = undefined;
  state.detailLoading = false;
  state.finalizeMutate = vi.fn();
  state.reopenMutate = vi.fn();
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceReviews />
    </QueryClientProvider>,
  );
}

describe('Performance Reviews (internal HR workspace) page', () => {
  it('shows an empty state when no reviews match', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no reviews found/i)).toBeInTheDocument();
  });

  it('lists reviews with employee, reviewer, department, position and score line', () => {
    resetState();
    state.list = { items: [review({ computedOverallScore: '88' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    const row = screen.getByTestId('row-review-1');
    expect(row).toHaveTextContent('Ada Lovelace');
    expect(row).toHaveTextContent('Grace Hopper');
    expect(row).toHaveTextContent('Engineering');
    expect(row).toHaveTextContent('Software Engineer');
    expect(screen.getByTestId('text-scores-review-1')).toHaveTextContent('Manager score: 88.00 / Final score: 88.00');
  });

  it('never shows an HR override as if it were the manager\'s own score', () => {
    resetState();
    state.list = { items: [review({ computedOverallScore: '88', hrOverrideScore: '92.5' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    expect(screen.getByTestId('text-scores-review-1')).toHaveTextContent('Manager score: 88.00 / HR override: 92.50 / Final score: 92.50');
  });

  it('shows pagination controls only when there is more than one page', () => {
    resetState();
    state.list = { items: [review()], total: 45, page: 1, pageSize: 20 };
    renderPage();
    expect(screen.getByTestId('button-next-page')).toBeInTheDocument();
    expect(screen.getByTestId('button-prev-page')).toBeDisabled();
  });

  it('opens the detail dialog and shows goals and competencies read-only', async () => {
    resetState();
    state.list = { items: [review()], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review(), competencies: [competency()], goals: [goal()] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.getByTestId('row-detail-goal-1')).toHaveTextContent('Ship X');
    expect(screen.getByTestId('row-detail-competency-1')).toHaveTextContent('Delivery');
  });

  it('links to the Team Reviews workspace instead of duplicating manager controls when still in manager_review', async () => {
    resetState();
    state.list = { items: [review({ status: 'manager_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'manager_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.getByTestId('link-go-to-manager-review')).toBeInTheDocument();
    expect(screen.queryByTestId('button-finalize-review')).not.toBeInTheDocument();
  });

  it('shows the finalize control only when the review is in hr_review', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.getByTestId('button-finalize-review')).toBeInTheDocument();
  });

  it('requires an override reason whenever an override score is entered', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.type(screen.getByTestId('input-override-score'), '95');
    expect(screen.getByTestId('button-finalize-review')).toBeDisabled();
    await userEvent.type(screen.getByTestId('input-override-reason'), 'Exceptional impact');
    expect(screen.getByTestId('button-finalize-review')).not.toBeDisabled();
  });

  it('finalizes without an override when no override score is supplied', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.click(screen.getByTestId('button-finalize-review'));
    expect(state.finalizeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: undefined }),
      expect.anything(),
    );
  });

  it('finalizes with an override score and reason together', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.type(screen.getByTestId('input-override-score'), '95');
    await userEvent.type(screen.getByTestId('input-override-reason'), 'Exceptional impact');
    await userEvent.click(screen.getByTestId('button-finalize-review'));
    expect(state.finalizeMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: { hrOverrideScore: 95, hrOverrideReason: 'Exceptional impact' } }),
      expect.anything(),
    );
  });

  it('offers only strictly-earlier reopen target stages for the review\'s current status', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.click(screen.getByTestId('button-open-reopen-dialog'));
    await userEvent.click(screen.getByTestId('select-reopen-target'));
    expect(screen.getByRole('option', { name: 'Self-Assessment' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Manager Review' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'HR Review' })).not.toBeInTheDocument();
  });

  it('requires a reason before confirming a reopen', async () => {
    resetState();
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.click(screen.getByTestId('button-open-reopen-dialog'));
    expect(screen.getByTestId('button-confirm-reopen')).toBeDisabled();
    await userEvent.click(screen.getByTestId('select-reopen-target'));
    await userEvent.click(screen.getByRole('option', { name: 'Manager Review' }));
    await userEvent.type(screen.getByTestId('textarea-reopen-reason'), 'Missing evidence');
    expect(screen.getByTestId('button-confirm-reopen')).not.toBeDisabled();
    await userEvent.click(screen.getByTestId('button-confirm-reopen'));
    expect(state.reopenMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: { targetStage: 'manager_review', reason: 'Missing evidence' } }),
      expect.anything(),
    );
  });

  it('reopen offers all three earlier stages from finalized', async () => {
    resetState();
    state.list = { items: [review({ status: 'finalized' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'finalized' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    await userEvent.click(screen.getByTestId('button-open-reopen-dialog'));
    await userEvent.click(screen.getByTestId('select-reopen-target'));
    expect(screen.getByRole('option', { name: 'Self-Assessment' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Manager Review' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'HR Review' })).toBeInTheDocument();
  });

  it('hides HR decision controls entirely for a non-HR-capable viewer', async () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    state.list = { items: [review({ status: 'hr_review' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'hr_review' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.queryByTestId('button-finalize-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-open-reopen-dialog')).not.toBeInTheDocument();
  });

  it('shows acknowledgement as read-only', async () => {
    resetState();
    state.list = { items: [review({ status: 'acknowledged', acknowledgedAt: '2026-02-01T00:00:00.000Z' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'acknowledged', acknowledgedAt: '2026-02-01T00:00:00.000Z' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.getByText(/Acknowledged on/)).toBeInTheDocument();
  });

  // W83 DoD: status must be the authoritative lifecycle signal — never a
  // nullable timestamp. A review that is NOT status 'acknowledged' must
  // never read as acknowledged, even if acknowledgedAt happens to carry a
  // (stale/inconsistent) value — status alone decides what's displayed.
  it('never infers acknowledgement from acknowledgedAt alone — status is authoritative', async () => {
    resetState();
    state.list = { items: [review({ status: 'finalized', acknowledgedAt: '2026-02-01T00:00:00.000Z' })], total: 1, page: 1, pageSize: 20 };
    state.detail = { review: review({ status: 'finalized', acknowledgedAt: '2026-02-01T00:00:00.000Z' }), competencies: [], goals: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-review-1'));
    expect(screen.getByText(/Not yet acknowledged/)).toBeInTheDocument();
    expect(screen.queryByText(/Acknowledged on/)).not.toBeInTheDocument();
  });
});
