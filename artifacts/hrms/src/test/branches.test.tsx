/**
 * Tests for the Branches page: loading/empty/list states and the create
 * flow. @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Branches from '@/pages/branches';

const mutateMock = vi.fn();

// Archive/reactivate go through a confirmation dialog; mutateAsync runs the
// page's per-call callbacks, then resolves or rejects like TanStack Query.
const { spies, outcome, toastSpy } = vi.hoisted(() => {
  const outcome = { fail: false };
  const asyncMutation = () =>
    vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      if (outcome.fail) {
        const err = { error: 'Branch still has dependents and cannot be archived' };
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
  useListBranches: vi.fn(),
  getListBranchesQueryKey: (id: number) => ['branches', id],
  useCreateBranch: () => ({ mutate: mutateMock, isPending: false }),
  useUpdateBranch: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveBranch: () => ({ mutate: vi.fn(), mutateAsync: spies.archive, isPending: false }),
  useReactivateBranch: () => ({ mutate: vi.fn(), mutateAsync: spies.reactivate, isPending: false }),
}));

import { useListBranches, useListMyOrganizations } from '@workspace/api-client-react';

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Branches />
    </QueryClientProvider>,
  );
}

describe('Branches page', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    outcome.fail = false;
    toastSpy.mockClear();
    spies.archive.mockClear();
    spies.reactivate.mockClear();
    vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['org_admin'] }] } as never);
  });

  it('shows a loading state', () => {
    vi.mocked(useListBranches).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never);

    renderWithClient();
    expect(screen.getByLabelText(/loading branches/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no branches', () => {
    vi.mocked(useListBranches).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);

    renderWithClient();
    expect(screen.getByText(/no branches yet/i)).toBeInTheDocument();
  });

  it('renders a list of branches', () => {
    vi.mocked(useListBranches).mockReturnValue({
      data: [
        { id: 1, organizationId: 10, name: 'Head Office', code: 'HQ', status: 'active', createdAt: '2026-01-01' },
        { id: 2, organizationId: 10, name: 'Warehouse', code: 'WH', status: 'inactive', createdAt: '2026-01-02' },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);

    renderWithClient();
    expect(screen.getByTestId('row-branch-1')).toBeInTheDocument();
    expect(screen.getByText('Head Office')).toBeInTheDocument();
    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });

  it('submits the create-branch form', async () => {
    vi.mocked(useListBranches).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);

    renderWithClient();

    fireEvent.click(screen.getByTestId('button-add-branch'));
    fireEvent.change(screen.getByTestId('input-branch-name'), { target: { value: 'New Branch' } });
    fireEvent.change(screen.getByTestId('input-branch-code'), { target: { value: 'NB' } });
    fireEvent.click(screen.getByTestId('button-submit-branch'));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith(
        { organizationId: 10, data: { name: 'New Branch', code: 'NB' } },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });
  });

  it('never shows Add/Edit/Archive controls to a plain employee (access-control bug regression)', () => {
    vi.mocked(useListBranches).mockReturnValue({
      data: [{ id: 1, organizationId: 10, name: 'Head Office', code: 'HQ', status: 'active', createdAt: '2026-01-01' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['employee'] }] } as never);

    renderWithClient();

    expect(screen.queryByTestId('button-add-branch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-branch-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-toggle-branch-status-1')).not.toBeInTheDocument();
  });

  describe('archive / reactivate confirmation', () => {
    const DIALOG = 'dialog-branch-status';
    const withBranches = () =>
      vi.mocked(useListBranches).mockReturnValue({
        data: [
          { id: 1, organizationId: 10, name: 'Head Office', code: 'HQ', status: 'active', createdAt: '2026-01-01' },
          { id: 2, organizationId: 10, name: 'Warehouse', code: 'WH', status: 'inactive', createdAt: '2026-01-02' },
        ],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);

    it('opens a confirmation instead of archiving, and Cancel runs nothing', async () => {
      const user = userEvent.setup();
      withBranches();
      renderWithClient();

      await user.click(screen.getByTestId('button-toggle-branch-status-1'));
      const dialog = screen.getByTestId(DIALOG);
      expect(dialog).toHaveTextContent('Archive branch?');
      expect(dialog).toHaveTextContent('“Head Office” will be archived (marked inactive)');
      expect(dialog.textContent ?? '').not.toMatch(/delete/i);
      expect(spies.archive).not.toHaveBeenCalled();

      await user.click(screen.getByTestId(`${DIALOG}-cancel`));
      await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
      expect(spies.archive).not.toHaveBeenCalled();
    });

    it('archives exactly once on confirm, then closes and reports success', async () => {
      const user = userEvent.setup();
      withBranches();
      renderWithClient();

      await user.click(screen.getByTestId('button-toggle-branch-status-1'));
      await user.click(screen.getByTestId(`${DIALOG}-confirm`));

      await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
      expect(spies.archive).toHaveBeenCalledTimes(1);
      expect(spies.archive.mock.calls[0]![0]).toEqual({ organizationId: 10, id: 1 });
      expect(toastSpy).toHaveBeenCalledWith({ title: 'Branch archived' });
    });

    it('stays open with the row still listed when the server refuses', async () => {
      const user = userEvent.setup();
      outcome.fail = true;
      withBranches();
      renderWithClient();

      await user.click(screen.getByTestId('button-toggle-branch-status-1'));
      await user.click(screen.getByTestId(`${DIALOG}-confirm`));

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not update branch status', variant: 'destructive' })),
      );
      expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
      expect(screen.getByTestId('row-branch-1')).toBeInTheDocument();
    });

    it('confirms reactivation of an inactive branch with the reactivate mutation', async () => {
      const user = userEvent.setup();
      withBranches();
      renderWithClient();

      await user.click(screen.getByTestId('button-toggle-branch-status-2'));
      expect(screen.getByTestId(DIALOG)).toHaveTextContent('Reactivate branch?');
      await user.click(screen.getByTestId(`${DIALOG}-confirm`));

      await waitFor(() => expect(spies.reactivate).toHaveBeenCalledTimes(1));
      expect(spies.reactivate.mock.calls[0]![0]).toEqual({ organizationId: 10, id: 2 });
      expect(spies.archive).not.toHaveBeenCalled();
    });
  });
});
