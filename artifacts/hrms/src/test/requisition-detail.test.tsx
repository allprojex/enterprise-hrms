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
import type { JobRequisition, RequisitionApproval } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    requisition: undefined as JobRequisition | undefined,
    isLoading: false,
    error: undefined as unknown,
    approvalHistory: undefined as RequisitionApproval[] | undefined,
    approveMutate: undefined as ((...args: unknown[]) => void) | undefined,
    rejectMutate: undefined as ((...args: unknown[]) => void) | undefined,
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
  useListRequisitionApprovals: () => ({ data: state.approvalHistory }),
  getListRequisitionApprovalsQueryKey: (orgId: number, id: number) => ['requisitionApprovals', orgId, id],
  useApproveJobRequisition: () => ({ mutate: state.approveMutate ?? vi.fn(), isPending: false }),
  useRejectJobRequisition: () => ({ mutate: state.rejectMutate ?? vi.fn(), isPending: false }),
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

  it('shows approve/reject actions only while pending_approval', () => {
    state.requisition = baseRequisition({ status: 'draft' });
    state.isLoading = false;
    state.error = undefined;
    const { unmount } = renderPage();
    expect(screen.queryByTestId('button-approve-requisition')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-reject-requisition')).not.toBeInTheDocument();
    unmount();

    state.requisition = baseRequisition({ status: 'pending_approval' });
    renderPage();
    expect(screen.getByTestId('button-approve-requisition')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-requisition')).toBeInTheDocument();
  });

  it('calls approve when the Approve button is clicked', async () => {
    state.requisition = baseRequisition({ status: 'pending_approval' });
    state.isLoading = false;
    state.error = undefined;
    const approveMutate = vi.fn();
    state.approveMutate = approveMutate;
    renderPage();
    screen.getByTestId('button-approve-requisition').click();
    expect(approveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10 }),
      expect.anything(),
    );
    state.approveMutate = undefined;
  });

  it('renders immutable approval history when present', () => {
    state.requisition = baseRequisition({ status: 'rejected' });
    state.isLoading = false;
    state.error = undefined;
    state.approvalHistory = [
      { id: 1, organizationId: 10, requisitionId: 1, sequence: 1, approverMembershipId: 5, decision: 'rejected', decidedAt: new Date().toISOString(), comment: 'Budget not approved', createdAt: new Date().toISOString() },
    ];
    renderPage();
    expect(screen.getByTestId('row-approval-step-1')).toBeInTheDocument();
    expect(screen.getByText('Budget not approved')).toBeInTheDocument();
    state.approvalHistory = undefined;
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
