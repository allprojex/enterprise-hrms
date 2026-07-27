/**
 * Tests for the Branches page: loading/empty/list states and the create
 * flow. @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Branches from '@/pages/branches';

const mutateMock = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListBranches: vi.fn(),
  getListBranchesQueryKey: (id: number) => ['branches', id],
  useCreateBranch: () => ({ mutate: mutateMock, isPending: false }),
  useUpdateBranch: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveBranch: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateBranch: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { useListBranches } from '@workspace/api-client-react';

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
});
