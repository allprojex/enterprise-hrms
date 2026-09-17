/**
 * Tests for the Office Inventory page's lifecycle confirmations: cancelling a
 * request, revoking an approval delegation, and dismissing an incident. The
 * exported panel components are rendered directly; @workspace/api-client-react
 * is mocked at the hook level — no real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RequestDetailDialog, DelegationPanel, IncidentDetailPanel } from '@/pages/office-inventory';

type MutateOpts = { onSuccess?: (data?: unknown) => void; onError?: (err: unknown) => void };
type AsyncMutation = (vars: unknown, opts?: unknown) => Promise<unknown>;

const { state } = vi.hoisted(() => ({
  state: {
    requestStatus: 'pending' as string,
    cancelRequestAsync: (() => Promise.resolve()) as AsyncMutation,
    revokeDelegationAsync: (() => Promise.resolve()) as AsyncMutation,
    reviewIncidentMutate: (() => undefined) as (...args: unknown[]) => void,
    reviewIncidentAsync: (() => Promise.resolve()) as AsyncMutation,
    delegationsRefetch: (() => undefined) as () => unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetOfficeInventoryRequest: () => ({
    data: {
      request: { id: 12, requestReference: 'REQ-0012', status: state.requestStatus },
      lines: [{ id: 1, itemId: 4, quantityRequested: '2', approvalStatus: 'pending', approvedQuantity: null, rejectionReason: null, actedAsDelegate: false }],
    },
    isLoading: false,
  }),
  getGetOfficeInventoryRequestQueryKey: (orgId: number, id: number) => ['officeInventoryRequest', orgId, id],
  useCancelOfficeInventoryRequest: () => ({ mutate: vi.fn(), mutateAsync: (v: unknown, o?: unknown) => state.cancelRequestAsync(v, o), isPending: false }),
  useListOfficeInventoryDelegations: () => ({ data: [{ id: 3, departmentId: 8, delegateMembershipId: 7, validFrom: new Date().toISOString(), validTo: null }], refetch: state.delegationsRefetch }),
  getListOfficeInventoryDelegationsQueryKey: (orgId: number, departmentId: number) => ['officeInventoryDelegations', orgId, departmentId],
  useListMembers: () => ({ data: [{ membershipId: 7, firstName: 'Kofi', lastName: 'Asante', status: 'active' }] }),
  getListMembersQueryKey: (orgId: number) => ['members', orgId],
  useCreateOfficeInventoryDelegation: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeOfficeInventoryDelegation: () => ({ mutate: vi.fn(), mutateAsync: (v: unknown, o?: unknown) => state.revokeDelegationAsync(v, o), isPending: false }),
  useReviewOfficeInventoryIncident: () => ({
    mutate: (...args: unknown[]) => state.reviewIncidentMutate(...args),
    mutateAsync: (v: unknown, o?: unknown) => state.reviewIncidentAsync(v, o),
    isPending: false,
  }),
  useMarkOfficeInventoryIncidentMissing: () => ({ mutate: vi.fn(), isPending: false }),
  useRecoverOfficeInventoryIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useWriteOffOfficeInventoryIncident: () => ({ mutate: vi.fn(), isPending: false }),
  useListOfficeInventoryStores: () => ({ data: [] }),
  getListOfficeInventoryStoresQueryKey: (orgId: number) => ['officeInventoryStores', orgId],
}));

function resolving() {
  return vi.fn((_vars: unknown, opts?: unknown) => {
    (opts as MutateOpts | undefined)?.onSuccess?.();
    return Promise.resolve();
  });
}

function rejecting() {
  return vi.fn((_vars: unknown, opts?: unknown) => {
    const err = { error: 'boom' };
    (opts as MutateOpts | undefined)?.onError?.(err);
    return Promise.reject(err);
  });
}

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const openIncident = { id: 21, itemId: 4, holderType: 'employee' as const, holderId: 30, incidentType: 'damage' as const, status: 'open' as const };

beforeEach(() => {
  state.requestStatus = 'pending';
  state.cancelRequestAsync = resolving();
  state.revokeDelegationAsync = resolving();
  state.reviewIncidentMutate = vi.fn();
  state.reviewIncidentAsync = resolving();
  state.delegationsRefetch = vi.fn();
});

describe('Office Inventory — cancel request confirmation', () => {
  it('asks before cancelling a request, and Keep Request cancels nothing', async () => {
    const onChanged = vi.fn();
    renderWithClient(<RequestDetailDialog organizationId={10} requestId={12} onChanged={onChanged} />);
    await userEvent.click(screen.getByTestId('button-view-request-12'));
    await userEvent.click(screen.getByTestId('button-cancel-request-12'));

    const dialog = screen.getByTestId('dialog-cancel-inventory-request');
    expect(dialog).toHaveTextContent('Cancel request?');
    expect(dialog).toHaveTextContent('cancel request “REQ-0012”');
    expect(state.cancelRequestAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-cancel-inventory-request-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-cancel-inventory-request')).not.toBeInTheDocument());
    expect(state.cancelRequestAsync).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('cancels exactly once on confirm, notifies the list, and closes', async () => {
    const onChanged = vi.fn();
    renderWithClient(<RequestDetailDialog organizationId={10} requestId={12} onChanged={onChanged} />);
    await userEvent.click(screen.getByTestId('button-view-request-12'));
    await userEvent.click(screen.getByTestId('button-cancel-request-12'));
    await userEvent.click(screen.getByTestId('dialog-cancel-inventory-request-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-cancel-inventory-request')).not.toBeInTheDocument());
    expect(state.cancelRequestAsync).toHaveBeenCalledTimes(1);
    expect(state.cancelRequestAsync).toHaveBeenCalledWith({ organizationId: 10, id: 12 }, expect.anything());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirmation open when cancelling fails', async () => {
    state.cancelRequestAsync = rejecting();
    const onChanged = vi.fn();
    renderWithClient(<RequestDetailDialog organizationId={10} requestId={12} onChanged={onChanged} />);
    await userEvent.click(screen.getByTestId('button-view-request-12'));
    await userEvent.click(screen.getByTestId('button-cancel-request-12'));
    await userEvent.click(screen.getByTestId('dialog-cancel-inventory-request-confirm'));

    await waitFor(() => expect(state.cancelRequestAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dialog-cancel-inventory-request')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('offers no cancel control once the request is no longer pending', async () => {
    state.requestStatus = 'approved';
    renderWithClient(<RequestDetailDialog organizationId={10} requestId={12} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByTestId('button-view-request-12'));
    expect(screen.queryByTestId('button-cancel-request-12')).not.toBeInTheDocument();
  });
});

describe('Office Inventory — revoke delegation confirmation', () => {
  it('asks before revoking, and Cancel revokes nothing', async () => {
    renderWithClient(<DelegationPanel organizationId={10} departmentId={8} />);
    await userEvent.click(screen.getByTestId('button-revoke-delegation-8'));

    const dialog = screen.getByTestId('dialog-revoke-inventory-delegation');
    expect(dialog).toHaveTextContent('Revoke delegation?');
    expect(dialog).toHaveTextContent('“Kofi Asante” will immediately stop being able to approve or reject');
    expect(state.revokeDelegationAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-revoke-inventory-delegation-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-revoke-inventory-delegation')).not.toBeInTheDocument());
    expect(state.revokeDelegationAsync).not.toHaveBeenCalled();
  });

  it('revokes exactly once on confirm, refreshes the delegations, and closes', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderWithClient(<DelegationPanel organizationId={10} departmentId={8} />);
    await userEvent.click(screen.getByTestId('button-revoke-delegation-8'));
    await userEvent.click(screen.getByTestId('dialog-revoke-inventory-delegation-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-revoke-inventory-delegation')).not.toBeInTheDocument());
    expect(state.revokeDelegationAsync).toHaveBeenCalledTimes(1);
    expect(state.revokeDelegationAsync).toHaveBeenCalledWith({ organizationId: 10, id: 3 }, expect.anything());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['officeInventoryDelegations', 10, 8] });
    expect(state.delegationsRefetch).toHaveBeenCalled();
    invalidateSpy.mockRestore();
  });

  it('keeps the dialog open and the delegate shown when revoking fails', async () => {
    state.revokeDelegationAsync = rejecting();
    renderWithClient(<DelegationPanel organizationId={10} departmentId={8} />);
    await userEvent.click(screen.getByTestId('button-revoke-delegation-8'));
    await userEvent.click(screen.getByTestId('dialog-revoke-inventory-delegation-confirm'));

    await waitFor(() => expect(state.revokeDelegationAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dialog-revoke-inventory-delegation')).toBeInTheDocument();
    expect(screen.getByTestId('text-current-delegate-8')).toHaveTextContent('Kofi Asante');
  });
});

describe('Office Inventory — dismiss incident confirmation', () => {
  it('asks before dismissing, and Cancel dismisses nothing', async () => {
    const onChanged = vi.fn();
    renderWithClient(<IncidentDetailPanel organizationId={10} incident={openIncident} onChanged={onChanged} />);
    await userEvent.click(screen.getByTestId('button-dismiss-21'));

    const dialog = screen.getByTestId('dialog-dismiss-inventory-incident');
    expect(dialog).toHaveTextContent('Dismiss incident?');
    expect(dialog).toHaveTextContent('dismiss this damage report');
    expect(state.reviewIncidentAsync).not.toHaveBeenCalled();
    expect(state.reviewIncidentMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-dismiss-inventory-incident-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-dismiss-inventory-incident')).not.toBeInTheDocument());
    expect(state.reviewIncidentAsync).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('dismisses exactly once on confirm with the typed resolution notes, and closes', async () => {
    const onChanged = vi.fn();
    renderWithClient(<IncidentDetailPanel organizationId={10} incident={openIncident} onChanged={onChanged} />);
    await userEvent.type(screen.getByTestId('textarea-resolution-notes-21'), 'Duplicate report');
    await userEvent.click(screen.getByTestId('button-dismiss-21'));
    await userEvent.click(screen.getByTestId('dialog-dismiss-inventory-incident-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-dismiss-inventory-incident')).not.toBeInTheDocument());
    expect(state.reviewIncidentAsync).toHaveBeenCalledTimes(1);
    expect(state.reviewIncidentAsync).toHaveBeenCalledWith(
      { organizationId: 10, id: 21, data: { outcome: 'dismissed', resolutionNotes: 'Duplicate report' } },
      expect.anything(),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open when dismissing fails', async () => {
    state.reviewIncidentAsync = rejecting();
    const onChanged = vi.fn();
    renderWithClient(<IncidentDetailPanel organizationId={10} incident={openIncident} onChanged={onChanged} />);
    await userEvent.click(screen.getByTestId('button-dismiss-21'));
    await userEvent.click(screen.getByTestId('dialog-dismiss-inventory-incident-confirm'));

    await waitFor(() => expect(state.reviewIncidentAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dialog-dismiss-inventory-incident')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('still marks an incident reviewed in one click (not a destructive action)', async () => {
    renderWithClient(<IncidentDetailPanel organizationId={10} incident={openIncident} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByTestId('button-review-21'));
    expect(state.reviewIncidentMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 21, data: { outcome: 'reviewed', resolutionNotes: undefined } },
      expect.anything(),
    );
    expect(screen.queryByTestId('dialog-dismiss-inventory-incident')).not.toBeInTheDocument();
  });
});
