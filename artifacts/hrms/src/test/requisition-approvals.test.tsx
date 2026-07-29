/**
 * Tests for the Requisition Approvals inbox page (Phase 3A — the frozen
 * plan's own W47; this session's W46). @workspace/api-client-react is
 * mocked at the hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import RequisitionApprovals from '@/pages/requisition-approvals';
import type { JobRequisition } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    pending: undefined as JobRequisition[] | undefined,
    isLoading: false,
    error: undefined as unknown,
    approveMutate: undefined as ((...args: unknown[]) => void) | undefined,
    rejectMutate: undefined as ((...args: unknown[]) => void) | undefined,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListPendingRequisitionApprovals: () => ({ data: state.pending, isLoading: state.isLoading, error: state.error }),
  getListPendingRequisitionApprovalsQueryKey: (orgId: number) => ['pendingRequisitionApprovals', orgId],
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
    status: 'pending_approval',
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
  const { hook } = memoryLocation({ path: '/requisition-approvals', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <RequisitionApprovals />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Requisition Approvals inbox page', () => {
  it('shows a loading state without crashing', () => {
    state.pending = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-pending-requisition-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.pending = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load pending approvals/i)).toBeInTheDocument();
  });

  it('shows the empty state when nothing is pending', () => {
    state.pending = [];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/nothing awaiting a decision/i)).toBeInTheDocument();
  });

  it('renders pending requisitions with approve/reject actions', () => {
    state.pending = [baseRequisition({ id: 1, title: 'Backend Engineer' })];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-pending-requisition-1');
    expect(row).toHaveTextContent('Backend Engineer');
    expect(screen.getByTestId('button-approve-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-1')).toBeInTheDocument();
  });

  it('links each pending requisition to its detail page', () => {
    state.pending = [baseRequisition({ id: 42 })];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-requisition-42')).toHaveAttribute('href', '/requisitions/42');
  });

  it('calls approve when the Approve button is clicked', () => {
    state.pending = [baseRequisition({ id: 1 })];
    state.isLoading = false;
    state.error = undefined;
    const approveMutate = vi.fn();
    state.approveMutate = approveMutate;
    renderPage();
    screen.getByTestId('button-approve-1').click();
    expect(approveMutate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 10, id: 1 }), expect.anything());
    state.approveMutate = undefined;
  });

  it('opens the reject dialog requiring no comment (optional) and submits reject', async () => {
    state.pending = [baseRequisition({ id: 1 })];
    state.isLoading = false;
    state.error = undefined;
    const rejectMutate = vi.fn();
    state.rejectMutate = rejectMutate;
    renderPage();
    fireEvent.click(screen.getByTestId('button-reject-1'));
    const confirmButton = await screen.findByTestId('button-confirm-reject');
    fireEvent.click(confirmButton);
    expect(rejectMutate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 10, id: 1 }), expect.anything());
    state.rejectMutate = undefined;
  });
});
