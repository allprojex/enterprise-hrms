/**
 * Tests for the Job Requisitions list page (Phase 3A, W45).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Requisitions from '@/pages/requisitions';
import type { JobRequisitionListResponse, JobRequisition } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    result: undefined as JobRequisitionListResponse | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListJobRequisitions: () => ({ data: state.result, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListJobRequisitionsQueryKey: (orgId: number, params: unknown) => ['jobRequisitions', orgId, params],
  useCreateJobRequisition: () => ({ mutate: vi.fn(), isPending: false }),
}));

function baseRequisition(overrides: Partial<JobRequisition> = {}): JobRequisition {
  return {
    id: 1,
    organizationId: 10,
    title: 'Software Engineer',
    requisitionType: 'new_role',
    positionId: null,
    departmentId: null,
    branchId: null,
    hiringManagerEmployeeId: null,
    recruiterEmployeeId: null,
    requestedHeadcount: 1,
    filledCount: 0,
    employmentType: null,
    workplaceType: null,
    expectedStartDate: null,
    salaryRangeMin: null,
    salaryRangeMax: null,
    salaryCurrency: null,
    justification: null,
    replacementEmployeeId: null,
    status: 'draft',
    cancellationReason: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/requisitions', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Requisitions />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Job Requisitions list page', () => {
  it('shows a loading state without crashing', () => {
    state.result = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-requisition-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.result = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load job requisitions/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no requisitions', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no job requisitions found/i)).toBeInTheDocument();
  });

  it('renders requisitions with title, type, openings, and status', () => {
    state.result = { items: [baseRequisition({ id: 1, title: 'Software Engineer', status: 'pending_approval', filledCount: 0, requestedHeadcount: 2 })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-requisition-1');
    expect(row).toHaveTextContent('Software Engineer');
    expect(row).toHaveTextContent('0 / 2');
    expect(row).toHaveTextContent('pending approval');
  });

  it('links each requisition to its detail page', () => {
    state.result = { items: [baseRequisition({ id: 42 })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-requisition-42')).toHaveAttribute('href', '/requisitions/42');
  });

  it('renders the new-requisition dialog trigger', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-new-requisition')).toBeInTheDocument();
  });
});
