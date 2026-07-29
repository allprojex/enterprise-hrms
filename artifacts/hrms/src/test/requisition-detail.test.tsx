/**
 * Tests for the Job Requisition detail page (Phase 3A, W45).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import RequisitionDetail from '@/pages/requisition-detail';
import type { JobRequisition } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    requisition: undefined as JobRequisition | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetJobRequisition: () => ({ data: state.requisition, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetJobRequisitionQueryKey: (orgId: number, id: number) => ['jobRequisition', orgId, id],
  useUpdateJobRequisition: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitJobRequisition: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelJobRequisition: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveJobRequisition: () => ({ mutate: vi.fn(), isPending: false }),
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
  const { hook } = memoryLocation({ path: '/requisitions/1', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <RequisitionDetail />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Job Requisition detail page', () => {
  it('shows a loading state without crashing', () => {
    state.requisition = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-edit-requisition')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.requisition = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this requisition/i)).toBeInTheDocument();
  });

  it('shows edit and submit-for-approval actions for a draft requisition', () => {
    state.requisition = baseRequisition({ status: 'draft' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-edit-requisition')).toBeInTheDocument();
    expect(screen.getByTestId('button-submit-for-approval')).toBeInTheDocument();
    expect(screen.getByTestId('button-cancel-requisition')).toBeInTheDocument();
    expect(screen.getByTestId('button-archive-requisition')).toBeInTheDocument();
  });

  it('hides edit and submit actions once the requisition is no longer a draft', () => {
    state.requisition = baseRequisition({ status: 'pending_approval' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-edit-requisition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-submit-for-approval')).not.toBeInTheDocument();
    // Still cancellable while pending.
    expect(screen.getByTestId('button-cancel-requisition')).toBeInTheDocument();
    expect(screen.queryByTestId('button-archive-requisition')).not.toBeInTheDocument();
  });

  it('shows no cancel or archive action for a closed requisition', () => {
    state.requisition = baseRequisition({ status: 'closed' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-cancel-requisition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-archive-requisition')).not.toBeInTheDocument();
  });

  it('renders requisition fields', () => {
    state.requisition = baseRequisition({ title: 'Backend Engineer', requestedHeadcount: 3, filledCount: 1 });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
  });
});
