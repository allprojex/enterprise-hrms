/**
 * Tests for the Public Holidays page — the confirmation step for
 * deactivating, reactivating and (hard) deleting a holiday.
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicHolidays from '@/pages/public-holidays';
import type { MembershipSummary, PublicHoliday } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    holidays: [] as PublicHoliday[],
    deactivateMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    reactivateMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    deleteMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    mutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPublicHolidays: () => ({ data: state.holidays, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListPublicHolidaysQueryKey: () => ['publicHolidays'],
  useCreatePublicHoliday: () => ({ mutate: state.mutate, isPending: false }),
  useUpdatePublicHoliday: () => ({ mutate: state.mutate, isPending: false }),
  useDeactivatePublicHoliday: () => ({ mutate: state.mutate, mutateAsync: state.deactivateMutateAsync, isPending: false }),
  useReactivatePublicHoliday: () => ({ mutate: state.mutate, mutateAsync: state.reactivateMutateAsync, isPending: false }),
  useDeletePublicHoliday: () => ({ mutate: state.mutate, mutateAsync: state.deleteMutateAsync, isPending: false }),
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

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, permissions: [], isPrimaryHr: false };
}

function holiday(overrides: Partial<PublicHoliday> = {}): PublicHoliday {
  return {
    id: 1,
    organizationId: 10,
    name: 'Independence Day',
    date: '2026-03-06',
    recurring: true,
    effectiveYear: null,
    observedDate: null,
    description: null,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PublicHoliday;
}

let lastQueryClient: QueryClient | null = null;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicHolidays />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.holidays = [holiday()];
  state.deactivateMutateAsync = resolvingMutateAsync();
  state.reactivateMutateAsync = resolvingMutateAsync();
  state.deleteMutateAsync = resolvingMutateAsync();
  state.mutate = vi.fn();
}

describe('Public Holidays page — confirmations', () => {
  it('hides every management action for a role that cannot manage holidays', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.getByTestId('row-holiday-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-deactivate-holiday-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-delete-holiday-1')).not.toBeInTheDocument();
  });

  it('Deactivate opens a confirmation and deactivates nothing until confirmed', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-deactivate-holiday-1'));
    const dialog = screen.getByTestId('dialog-holiday-status');
    expect(dialog).toHaveTextContent('Deactivate public holiday?');
    expect(dialog).toHaveTextContent('“Independence Day”');
    expect(state.deactivateMutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-holiday-status-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-holiday-status')).not.toBeInTheDocument());
    expect(state.deactivateMutateAsync).not.toHaveBeenCalled();

    const invalidateSpy = vi.spyOn(lastQueryClient!, 'invalidateQueries');
    await userEvent.click(screen.getByTestId('button-deactivate-holiday-1'));
    await userEvent.click(screen.getByTestId('dialog-holiday-status-confirm'));
    expect(state.deactivateMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.deactivateMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    await waitFor(() => expect(screen.queryByTestId('dialog-holiday-status')).not.toBeInTheDocument());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['publicHolidays'] });
  });

  it('an inactive holiday is reactivated through a restorative confirmation', async () => {
    resetState();
    state.holidays = [holiday({ status: 'inactive' })];
    renderPage();
    await userEvent.click(screen.getByTestId('button-reactivate-holiday-1'));
    expect(screen.getByTestId('dialog-holiday-status')).toHaveTextContent('Reactivate public holiday?');
    expect(state.reactivateMutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('dialog-holiday-status-confirm'));
    expect(state.reactivateMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.reactivateMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    expect(state.deactivateMutateAsync).not.toHaveBeenCalled();
  });

  it('Delete warns that it is permanent, and Cancel deletes nothing', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-delete-holiday-1'));
    const dialog = screen.getByTestId('dialog-delete-holiday');
    expect(dialog).toHaveTextContent('Delete public holiday?');
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(state.deleteMutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('dialog-delete-holiday-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-delete-holiday')).not.toBeInTheDocument());
    expect(state.deleteMutateAsync).not.toHaveBeenCalled();
  });

  it('confirming Delete deletes once and closes the dialog', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-delete-holiday-1'));
    await userEvent.click(screen.getByTestId('dialog-delete-holiday-confirm'));
    expect(state.deleteMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.deleteMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    await waitFor(() => expect(screen.queryByTestId('dialog-delete-holiday')).not.toBeInTheDocument());
  });

  it('a failed delete keeps the dialog open and the holiday listed', async () => {
    resetState();
    state.deleteMutateAsync = rejectingMutateAsync();
    renderPage();
    await userEvent.click(screen.getByTestId('button-delete-holiday-1'));
    await userEvent.click(screen.getByTestId('dialog-delete-holiday-confirm'));
    expect(state.deleteMutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('dialog-delete-holiday-confirm')).not.toBeDisabled());
    expect(screen.getByTestId('dialog-delete-holiday')).toBeInTheDocument();
    expect(screen.getByTestId('row-holiday-1')).toBeInTheDocument();
  });
});
