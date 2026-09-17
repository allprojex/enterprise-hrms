/**
 * Tests for the Leave Types page — the archive/reactivate confirmation step
 * for leave types and their policies.
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LeaveTypes from '@/pages/leave-types';

type LeaveTypeRow = { id: number; name: string; code: string; status: 'active' | 'inactive' };
type PolicyRow = {
  id: number;
  name: string;
  status: 'active' | 'inactive';
  annualEntitlementDays: number;
  accrualMethod: string;
  carryForwardAllowed: boolean;
  maxCarryForwardDays: number | null;
};

const { state } = vi.hoisted(() => ({
  state: {
    leaveTypes: [] as LeaveTypeRow[],
    policies: [] as PolicyRow[],
    archiveTypeMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    reactivateTypeMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    archivePolicyMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    reactivatePolicyMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    mutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListLeaveTypes: () => ({ data: state.leaveTypes, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListLeaveTypesQueryKey: () => ['leaveTypes'],
  useCreateLeaveType: () => ({ mutate: state.mutate, isPending: false }),
  useUpdateLeaveType: () => ({ mutate: state.mutate, isPending: false }),
  useArchiveLeaveType: () => ({ mutate: state.mutate, mutateAsync: state.archiveTypeMutateAsync, isPending: false }),
  useReactivateLeaveType: () => ({ mutate: state.mutate, mutateAsync: state.reactivateTypeMutateAsync, isPending: false }),
  useListLeavePolicies: () => ({ data: state.policies }),
  getListLeavePoliciesQueryKey: () => ['leavePolicies'],
  useCreateLeavePolicy: () => ({ mutate: state.mutate, isPending: false }),
  useArchiveLeavePolicy: () => ({ mutate: state.mutate, mutateAsync: state.archivePolicyMutateAsync, isPending: false }),
  useReactivateLeavePolicy: () => ({ mutate: state.mutate, mutateAsync: state.reactivatePolicyMutateAsync, isPending: false }),
  useListBranches: () => ({ data: [] }),
  getListBranchesQueryKey: () => ['branches'],
  useListDepartments: () => ({ data: [] }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListPositions: () => ({ data: [] }),
  getListPositionsQueryKey: () => ['positions'],
}));

type MutationCallbacks = { onSuccess?: (...args: unknown[]) => void; onError?: (err: unknown) => void };

/** mutateAsync stand-in that runs the page's own onSuccess callback and resolves. */
function resolvingMutateAsync() {
  return vi.fn(async (_vars: unknown, opts?: MutationCallbacks) => {
    opts?.onSuccess?.();
  });
}

/** mutateAsync stand-in that runs the page's own onError callback and rejects. */
function rejectingMutateAsync() {
  return vi.fn(async (_vars: unknown, opts?: MutationCallbacks) => {
    const err = { error: 'Server refused' };
    opts?.onError?.(err);
    throw err;
  });
}

let lastQueryClient: QueryClient | null = null;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaveTypes />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.leaveTypes = [{ id: 1, name: 'Annual Leave', code: 'ANNUAL', status: 'active' }];
  state.policies = [];
  state.archiveTypeMutateAsync = resolvingMutateAsync();
  state.reactivateTypeMutateAsync = resolvingMutateAsync();
  state.archivePolicyMutateAsync = resolvingMutateAsync();
  state.reactivatePolicyMutateAsync = resolvingMutateAsync();
  state.mutate = vi.fn();
}

describe('Leave Types page — status confirmations', () => {
  it('clicking Archive opens a confirmation naming the leave type and archives nothing yet', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-toggle-leave-type-status-1'));
    const dialog = screen.getByTestId('dialog-leave-type-status');
    expect(dialog).toHaveTextContent('Archive leave type?');
    expect(dialog).toHaveTextContent('“Annual Leave”');
    expect(screen.getByTestId('dialog-leave-type-status-confirm')).toHaveTextContent('Archive Leave Type');
    expect(state.archiveTypeMutateAsync).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('Cancel archives nothing', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-toggle-leave-type-status-1'));
    await userEvent.click(screen.getByTestId('dialog-leave-type-status-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-leave-type-status')).not.toBeInTheDocument());
    expect(state.archiveTypeMutateAsync).not.toHaveBeenCalled();
  });

  it('Confirm archives exactly once, closes the dialog and refreshes the list', async () => {
    resetState();
    renderPage();
    const invalidateSpy = vi.spyOn(lastQueryClient!, 'invalidateQueries');
    await userEvent.click(screen.getByTestId('button-toggle-leave-type-status-1'));
    await userEvent.click(screen.getByTestId('dialog-leave-type-status-confirm'));
    expect(state.archiveTypeMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.archiveTypeMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    expect(state.reactivateTypeMutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('dialog-leave-type-status')).not.toBeInTheDocument());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['leaveTypes'] });
  });

  it('a failed archive keeps the dialog open and the row in place', async () => {
    resetState();
    state.archiveTypeMutateAsync = rejectingMutateAsync();
    renderPage();
    await userEvent.click(screen.getByTestId('button-toggle-leave-type-status-1'));
    await userEvent.click(screen.getByTestId('dialog-leave-type-status-confirm'));
    expect(state.archiveTypeMutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('dialog-leave-type-status-confirm')).not.toBeDisabled());
    expect(screen.getByTestId('dialog-leave-type-status')).toBeInTheDocument();
    expect(screen.getByTestId('row-leave-type-1')).toBeInTheDocument();
  });

  it('an inactive leave type is reactivated through a restorative confirmation', async () => {
    resetState();
    state.leaveTypes = [{ id: 1, name: 'Annual Leave', code: 'ANNUAL', status: 'inactive' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-toggle-leave-type-status-1'));
    expect(screen.getByTestId('dialog-leave-type-status')).toHaveTextContent('Reactivate leave type?');
    await userEvent.click(screen.getByTestId('dialog-leave-type-status-confirm'));
    expect(state.reactivateTypeMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    expect(state.archiveTypeMutateAsync).not.toHaveBeenCalled();
  });

  it('archiving a leave policy requires confirmation and archives it once on confirm', async () => {
    resetState();
    state.policies = [
      { id: 7, name: 'Standard Annual', status: 'active', annualEntitlementDays: 20, accrualMethod: 'annual', carryForwardAllowed: false, maxCarryForwardDays: null },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-policies-1'));
    await userEvent.click(screen.getByTestId('button-toggle-policy-status-7'));
    const dialog = screen.getByTestId('dialog-policy-status-1');
    expect(dialog).toHaveTextContent('Archive leave policy?');
    expect(dialog).toHaveTextContent('“Standard Annual”');
    expect(state.archivePolicyMutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-policy-status-1-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-policy-status-1')).not.toBeInTheDocument());
    expect(state.archivePolicyMutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('button-toggle-policy-status-7'));
    await userEvent.click(screen.getByTestId('dialog-policy-status-1-confirm'));
    expect(state.archivePolicyMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.archivePolicyMutateAsync).toHaveBeenCalledWith({ organizationId: 10, leaveTypeId: 1, policyId: 7 }, expect.anything());
    await waitFor(() => expect(screen.queryByTestId('dialog-policy-status-1')).not.toBeInTheDocument());
  });
});
