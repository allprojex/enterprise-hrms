/**
 * Tests for the Performance Rating Scales page (Phase 3C, W74).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PerformanceRatingScales from '@/pages/performance-rating-scales';
import type { PerformanceRatingScale, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    scales: [] as PerformanceRatingScale[],
    scalesLoading: false,
    scalesError: undefined as unknown,
    detail: undefined as { scale: PerformanceRatingScale; levels: unknown[]; levelsLocked: boolean } | undefined,
    detailLoading: false,
    createMutate: vi.fn() as (...args: unknown[]) => void,
    updateMutate: vi.fn() as (...args: unknown[]) => void,
    replaceLevelsMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPerformanceRatingScales: () => ({ data: state.scales, isLoading: state.scalesLoading, error: state.scalesError, refetch: vi.fn() }),
  getListPerformanceRatingScalesQueryKey: () => ['scales'],
  useGetPerformanceRatingScale: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined }),
  getGetPerformanceRatingScaleQueryKey: () => ['scale'],
  useCreatePerformanceRatingScale: () => ({ mutate: state.createMutate, isPending: false }),
  useUpdatePerformanceRatingScale: () => ({ mutate: state.updateMutate, isPending: false }),
  useReplacePerformanceRatingScaleLevels: () => ({ mutate: state.replaceLevelsMutate, isPending: false }),
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles, isPrimaryHr: false };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceRatingScales />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.scales = [];
  state.scalesLoading = false;
  state.scalesError = undefined;
  state.detail = undefined;
  state.detailLoading = false;
  state.createMutate = vi.fn();
  state.updateMutate = vi.fn();
  state.replaceLevelsMutate = vi.fn();
}

describe('Performance Rating Scales page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.scalesLoading = true;
    renderPage();
    expect(screen.getByText('Performance Rating Scales')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.scalesError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to load rating scales/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no scales', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no rating scales yet/i)).toBeInTheDocument();
  });

  it('renders scales in a table with status badges', () => {
    resetState();
    state.scales = [{ id: 1, organizationId: 10, name: 'Scale A', description: 'desc', status: 'active', createdAt: new Date().toISOString() }];
    renderPage();
    const row = screen.getByTestId('row-rating-scale-1');
    expect(row).toHaveTextContent('Scale A');
    expect(row).toHaveTextContent('active');
  });

  it('hides the Add Rating Scale button for a non-HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.queryByTestId('button-add-rating-scale')).not.toBeInTheDocument();
  });

  it('submits the create form with the entered name', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-rating-scale'));
    await userEvent.type(screen.getByTestId('input-scale-name'), '5-Point Scale');
    await userEvent.click(screen.getByTestId('button-submit-rating-scale'));
    expect(state.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, data: expect.objectContaining({ name: '5-Point Scale' }) }),
      expect.anything(),
    );
  });

  it('opens the manage dialog and shows existing levels', async () => {
    resetState();
    state.scales = [{ id: 1, organizationId: 10, name: 'Scale A', description: null, status: 'active', createdAt: new Date().toISOString() }];
    state.detail = {
      scale: state.scales[0],
      levels: [{ id: 1, ratingScaleId: 1, value: 5, label: 'Excellent', description: null, sortOrder: 0 }],
      levelsLocked: false,
    };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-rating-scale-1'));
    expect(screen.getByTestId('input-level-label-0')).toHaveValue('Excellent');
  });

  it('shows a locked message instead of the level editor once the scale has been used', async () => {
    resetState();
    state.scales = [{ id: 1, organizationId: 10, name: 'Scale A', description: null, status: 'active', createdAt: new Date().toISOString() }];
    state.detail = {
      scale: state.scales[0],
      levels: [{ id: 1, ratingScaleId: 1, value: 5, label: 'Excellent', description: null, sortOrder: 0 }],
      levelsLocked: true,
    };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-rating-scale-1'));
    expect(screen.getByTestId('text-levels-locked')).toBeInTheDocument();
    expect(screen.queryByTestId('input-level-label-0')).not.toBeInTheDocument();
  });

  it('archiving is still offered even when levels are locked', async () => {
    resetState();
    state.scales = [{ id: 1, organizationId: 10, name: 'Scale A', description: null, status: 'active', createdAt: new Date().toISOString() }];
    state.detail = { scale: state.scales[0], levels: [], levelsLocked: true };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-rating-scale-1'));
    const toggle = screen.getByTestId('button-toggle-scale-status');
    expect(toggle).toHaveTextContent('Archive');
    await userEvent.click(toggle);
    expect(state.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ status: 'archived' }) }),
      expect.anything(),
    );
  });

  it('starts with one blank draft row when the scale has no levels yet, and Add Level appends another', async () => {
    resetState();
    state.scales = [{ id: 1, organizationId: 10, name: 'Scale A', description: null, status: 'active', createdAt: new Date().toISOString() }];
    state.detail = { scale: state.scales[0], levels: [], levelsLocked: false };
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-rating-scale-1'));
    expect(screen.getByTestId('row-level-draft-0')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-add-level'));
    expect(screen.getByTestId('row-level-draft-1')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-remove-level-1'));
    expect(screen.queryByTestId('row-level-draft-1')).not.toBeInTheDocument();
  });
});
