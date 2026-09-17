/**
 * Positions page — archive / reactivate go through a confirmation step.
 * Mirrors branches.test.tsx: @workspace/api-client-react is mocked at the hook
 * level, so no real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Positions from '@/pages/positions';

const { spies, outcome, toastSpy } = vi.hoisted(() => {
  const outcome = { fail: false };
  const asyncMutation = () =>
    vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      if (outcome.fail) {
        const err = { error: 'Position not found' };
        opts?.onError?.(err);
        return Promise.reject(err);
      }
      opts?.onSuccess?.();
      return Promise.resolve({});
    });
  return { outcome, toastSpy: vi.fn(), spies: { archive: asyncMutation(), reactivate: asyncMutation() } };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: vi.fn(),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListPositions: () => ({
    data: [
      { id: 1, organizationId: 10, title: 'Ward Sister', departmentId: null, status: 'active', createdAt: '2026-01-01' },
      { id: 2, organizationId: 10, title: 'Night Porter', departmentId: null, status: 'inactive', createdAt: '2026-01-02' },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListPositionsQueryKey: (id: number) => ['positions', id],
  useListDepartments: () => ({ data: [], isLoading: false }),
  getListDepartmentsQueryKey: (id: number) => ['departments', id],
  useCreatePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useRestructurePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useArchivePosition: () => ({ mutate: vi.fn(), mutateAsync: spies.archive, isPending: false }),
  useReactivatePosition: () => ({ mutate: vi.fn(), mutateAsync: spies.reactivate, isPending: false }),
}));

import { useListMyOrganizations } from '@workspace/api-client-react';

const DIALOG = 'dialog-position-status';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Positions />
    </QueryClientProvider>,
  );
}

describe('Positions page — archive / reactivate confirmation', () => {
  beforeEach(() => {
    outcome.fail = false;
    toastSpy.mockClear();
    spies.archive.mockClear();
    spies.reactivate.mockClear();
    vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['org_admin'] }] } as never);
  });

  it('opens a confirmation instead of archiving, and Cancel runs nothing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-position-status-1'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Archive position?');
    expect(dialog).toHaveTextContent('“Ward Sister” will be archived (marked inactive)');
    expect(screen.getByTestId(`${DIALOG}-confirm`)).toHaveTextContent('Archive Position');
    expect(spies.archive).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
    expect(spies.archive).not.toHaveBeenCalled();
  });

  it('archives exactly once on confirm, then closes and reports success', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-position-status-1'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(spies.archive.mock.calls[0]![0]).toEqual({ organizationId: 10, id: 1 });
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Position archived' });
  });

  it('stays open with the row still listed when the server refuses', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderPage();

    await user.click(screen.getByTestId('button-toggle-position-status-1'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not update position status', variant: 'destructive' })),
    );
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('row-position-1')).toBeInTheDocument();
  });

  it('confirms reactivation of an inactive position with the reactivate mutation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-position-status-2'));
    expect(screen.getByTestId(DIALOG)).toHaveTextContent('Reactivate position?');
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(spies.reactivate).toHaveBeenCalledTimes(1));
    expect(spies.reactivate.mock.calls[0]![0]).toEqual({ organizationId: 10, id: 2 });
    expect(spies.archive).not.toHaveBeenCalled();
  });

  it('never shows the archive control to a plain employee', () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['employee'] }] } as never);
    renderPage();

    expect(screen.queryByTestId('button-toggle-position-status-1')).not.toBeInTheDocument();
  });
});
