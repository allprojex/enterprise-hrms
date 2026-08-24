/**
 * Tests for the Performance Cycles page (Phase 3C, W75).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceCycles from '@/pages/performance-cycles';
import type { PerformanceCycle, PerformanceReviewTemplate, PerformanceRatingScale, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    cycles: [] as PerformanceCycle[],
    cyclesLoading: false,
    cyclesError: undefined as unknown,
    templates: [] as PerformanceReviewTemplate[],
    ratingScales: [] as PerformanceRatingScale[],
    detail: undefined as PerformanceCycle | undefined,
    detailLoading: false,
    createMutate: vi.fn() as (...args: unknown[]) => void,
    updateMutate: vi.fn() as (...args: unknown[]) => void,
    generateMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPerformanceCycles: () => ({ data: state.cycles, isLoading: state.cyclesLoading, error: state.cyclesError, refetch: vi.fn() }),
  getListPerformanceCyclesQueryKey: () => ['cycles'],
  useGetPerformanceCycle: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined }),
  getGetPerformanceCycleQueryKey: () => ['cycle'],
  useListPerformanceReviewTemplates: () => ({ data: state.templates }),
  getListPerformanceReviewTemplatesQueryKey: () => ['templates'],
  useListPerformanceRatingScales: () => ({ data: state.ratingScales }),
  getListPerformanceRatingScalesQueryKey: () => ['scales'],
  useCreatePerformanceCycle: () => ({ mutate: state.createMutate, isPending: false }),
  useUpdatePerformanceCycle: () => ({ mutate: state.updateMutate, isPending: false }),
  useGeneratePerformanceReviews: () => ({ mutate: state.generateMutate, isPending: false }),
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, isPrimaryHr: false };
}

function scale(id: number, name: string): PerformanceRatingScale {
  return { id, organizationId: 10, name, description: null, status: 'active', createdAt: new Date().toISOString() };
}

function template(overrides: Partial<PerformanceReviewTemplate> = {}): PerformanceReviewTemplate {
  return {
    id: 1, organizationId: 10, name: 'Annual Template', description: null, ratingScaleId: 1,
    goalsWeight: 60, competenciesWeight: 40, applicabilityScope: 'all_active',
    applicabilityDepartmentIds: null, applicabilityPositionIds: null, status: 'active',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function cycle(overrides: Partial<PerformanceCycle> = {}): PerformanceCycle {
  return {
    id: 1, organizationId: 10, name: '2026 Annual Cycle', cycleType: 'annual',
    startDate: '2026-01-01', endDate: '2026-12-31',
    selfAssessmentWindowStart: null, selfAssessmentWindowEnd: null,
    managerReviewWindowStart: null, managerReviewWindowEnd: null,
    hrFinalizationWindowStart: null, hrFinalizationWindowEnd: null,
    templateId: 1, ratingScaleId: 1, applicabilityScope: 'all_active',
    applicabilityDepartmentIds: null, applicabilityPositionIds: null,
    status: 'draft', createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceCycles />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.cycles = [];
  state.cyclesLoading = false;
  state.cyclesError = undefined;
  state.templates = [template()];
  state.ratingScales = [scale(1, 'Scale A')];
  state.detail = undefined;
  state.detailLoading = false;
  state.createMutate = vi.fn();
  state.updateMutate = vi.fn();
  state.generateMutate = vi.fn();
}

describe('Performance Cycles page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.cyclesLoading = true;
    renderPage();
    expect(screen.getByText('Performance Cycles')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.cyclesError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to load cycles/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no cycles', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no performance cycles yet/i)).toBeInTheDocument();
  });

  it('renders cycles with resolved template name and status badge', () => {
    resetState();
    state.cycles = [cycle()];
    renderPage();
    const row = screen.getByTestId('row-cycle-1');
    expect(row).toHaveTextContent('2026 Annual Cycle');
    expect(row).toHaveTextContent('Annual Template');
    expect(row).toHaveTextContent('draft');
  });

  it('hides the Add Cycle button for a non-HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.queryByTestId('button-add-cycle')).not.toBeInTheDocument();
  });

  it('disables Add Cycle when there is no active template or rating scale', () => {
    resetState();
    state.templates = [];
    renderPage();
    expect(screen.getByTestId('button-add-cycle')).toBeDisabled();
  });

  it('submits the create form with the entered fields', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-cycle'));
    await userEvent.type(screen.getByTestId('input-cycle-name'), 'Q1 Cycle');
    await userEvent.type(screen.getByTestId('input-cycle-start'), '2026-01-01');
    await userEvent.type(screen.getByTestId('input-cycle-end'), '2026-03-31');
    await userEvent.click(screen.getByTestId('select-cycle-template'));
    await userEvent.click(screen.getByRole('option', { name: 'Annual Template' }));
    await userEvent.click(screen.getByTestId('select-cycle-scale'));
    await userEvent.click(screen.getByRole('option', { name: 'Scale A' }));
    await userEvent.click(screen.getByTestId('button-submit-cycle'));
    expect(state.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 10,
        data: expect.objectContaining({ name: 'Q1 Cycle', templateId: 1, ratingScaleId: 1, applicabilityScope: 'all_active' }),
      }),
      expect.anything(),
    );
  });

  it('shows a department-id input only when applicability scope is department', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-cycle'));
    expect(screen.queryByTestId('input-cycle-dept-ids')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('select-cycle-scope'));
    await userEvent.click(screen.getByRole('option', { name: 'Specific departments' }));
    expect(screen.getByTestId('input-cycle-dept-ids')).toBeInTheDocument();
  });

  it('opens the manage dialog and offers Generate Reviews for a draft cycle', async () => {
    resetState();
    state.cycles = [cycle()];
    state.detail = cycle();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-cycle-1'));
    expect(screen.getByTestId('text-manage-cycle-status')).toHaveTextContent('draft');
    expect(screen.getByTestId('button-generate-reviews')).toBeInTheDocument();
  });

  it('submits generate-reviews for an all_active cycle with no employeeIds', async () => {
    resetState();
    state.cycles = [cycle()];
    state.detail = cycle();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-cycle-1'));
    await userEvent.click(screen.getByTestId('button-generate-reviews'));
    expect(state.generateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: {} }),
      expect.anything(),
    );
  });

  it('requires employeeIds before enabling Generate Reviews for a manual-scope cycle', async () => {
    resetState();
    state.cycles = [cycle({ applicabilityScope: 'manual' })];
    state.detail = cycle({ applicabilityScope: 'manual' });
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-cycle-1'));
    expect(screen.getByTestId('button-generate-reviews')).toBeDisabled();
    await userEvent.type(screen.getByTestId('input-manual-employee-ids'), '1, 2');
    expect(screen.getByTestId('button-generate-reviews')).not.toBeDisabled();
  });

  it('shows a Close Cycle action, not Generate Reviews, once the cycle is open', async () => {
    resetState();
    state.cycles = [cycle({ status: 'open' })];
    state.detail = cycle({ status: 'open' });
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-cycle-1'));
    expect(screen.queryByTestId('button-generate-reviews')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-close-cycle')).toBeInTheDocument();
  });
});
