/**
 * Tests for the Performance Review Templates page (Phase 3C, W74).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceTemplates from '@/pages/performance-templates';
import type { PerformanceReviewTemplate, PerformanceRatingScale, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    templates: [] as PerformanceReviewTemplate[],
    templatesLoading: false,
    templatesError: undefined as unknown,
    ratingScales: [] as PerformanceRatingScale[],
    detail: undefined as { template: PerformanceReviewTemplate; competencies: unknown[] } | undefined,
    detailLoading: false,
    createMutate: vi.fn() as (...args: unknown[]) => void,
    updateMutate: vi.fn() as (...args: unknown[]) => void,
    replaceCompetenciesMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPerformanceReviewTemplates: () => ({ data: state.templates, isLoading: state.templatesLoading, error: state.templatesError, refetch: vi.fn() }),
  getListPerformanceReviewTemplatesQueryKey: () => ['templates'],
  useGetPerformanceReviewTemplate: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined }),
  getGetPerformanceReviewTemplateQueryKey: () => ['template'],
  useListPerformanceRatingScales: () => ({ data: state.ratingScales }),
  getListPerformanceRatingScalesQueryKey: () => ['scales'],
  useCreatePerformanceReviewTemplate: () => ({ mutate: state.createMutate, isPending: false }),
  useUpdatePerformanceReviewTemplate: () => ({ mutate: state.updateMutate, isPending: false }),
  useReplacePerformanceTemplateCompetencies: () => ({ mutate: state.replaceCompetenciesMutate, isPending: false }),
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles, isPrimaryHr: false };
}

function scale(id: number, name: string, status: 'active' | 'archived' = 'active'): PerformanceRatingScale {
  return { id, organizationId: 10, name, description: null, status, createdAt: new Date().toISOString() };
}

function template(overrides: Partial<PerformanceReviewTemplate> = {}): PerformanceReviewTemplate {
  return {
    id: 1,
    organizationId: 10,
    name: 'Annual Review',
    description: null,
    ratingScaleId: 1,
    goalsWeight: 60,
    competenciesWeight: 40,
    applicabilityScope: 'all_active',
    applicabilityDepartmentIds: null,
    applicabilityPositionIds: null,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceTemplates />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.templates = [];
  state.templatesLoading = false;
  state.templatesError = undefined;
  state.ratingScales = [scale(1, 'Scale A')];
  state.detail = undefined;
  state.detailLoading = false;
  state.createMutate = vi.fn();
  state.updateMutate = vi.fn();
  state.replaceCompetenciesMutate = vi.fn();
}

describe('Performance Review Templates page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.templatesLoading = true;
    renderPage();
    expect(screen.getByText('Performance Review Templates')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.templatesError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to load templates/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no templates', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no review templates yet/i)).toBeInTheDocument();
  });

  it('renders templates with resolved rating-scale name and weights', () => {
    resetState();
    state.templates = [template()];
    renderPage();
    const row = screen.getByTestId('row-template-1');
    expect(row).toHaveTextContent('Annual Review');
    expect(row).toHaveTextContent('Scale A');
    expect(row).toHaveTextContent('60% / 40%');
  });

  it('hides the Add Template button for a non-HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.queryByTestId('button-add-template')).not.toBeInTheDocument();
  });

  it('disables Add Template when there is no active rating scale', () => {
    resetState();
    state.ratingScales = [scale(1, 'Archived Scale', 'archived')];
    renderPage();
    expect(screen.getByTestId('button-add-template')).toBeDisabled();
  });

  it('submits the create form with the entered fields', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-template'));
    await userEvent.type(screen.getByTestId('input-template-name'), 'Q1 Review');
    await userEvent.click(screen.getByTestId('select-template-rating-scale'));
    await userEvent.click(screen.getByRole('option', { name: 'Scale A' }));
    await userEvent.click(screen.getByTestId('button-submit-template'));
    expect(state.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 10,
        data: expect.objectContaining({ name: 'Q1 Review', ratingScaleId: 1, goalsWeight: 60, competenciesWeight: 40 }),
      }),
      expect.anything(),
    );
  });

  it('opens the manage dialog and shows existing competencies', async () => {
    resetState();
    state.templates = [template()];
    state.detail = { template: template(), competencies: [{ id: 1, templateId: 1, label: 'Communication', description: null, weight: 100, sortOrder: 0 }] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-template-1'));
    expect(screen.getByTestId('input-competency-label-0')).toHaveValue('Communication');
  });

  it('locks all edit controls once a template is archived, until reactivated', async () => {
    resetState();
    state.templates = [template({ status: 'archived' })];
    state.detail = { template: template({ status: 'archived' }), competencies: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-template-1'));
    expect(screen.getByTestId('text-template-archived')).toBeInTheDocument();
    expect(screen.getByTestId('input-edit-template-name')).toBeDisabled();
    expect(screen.getByTestId('button-toggle-template-status')).toHaveTextContent('Reactivate');
  });

  it('replaces competencies via the Save Competencies action', async () => {
    resetState();
    state.templates = [template()];
    state.detail = { template: template(), competencies: [{ id: 1, templateId: 1, label: 'Communication', description: null, weight: 100, sortOrder: 0 }] };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-template-1'));
    await userEvent.click(screen.getByTestId('button-save-competencies'));
    expect(state.replaceCompetenciesMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ competencies: [expect.objectContaining({ label: 'Communication', weight: 100 })] }) }),
      expect.anything(),
    );
  });
});
