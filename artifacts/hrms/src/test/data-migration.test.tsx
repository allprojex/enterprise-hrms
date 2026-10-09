/**
 * WS-7 Data Migration — Cancel is terminal in the batch state machine (a
 * cancelled migration cannot resume), so it goes through a confirmation. A
 * refused cancel keeps the dialog open rather than looking like it worked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import DataMigration from '@/pages/data-migration';

const { state, mutations, refetches } = vi.hoisted(() => ({
  state: {
    migration: null as Record<string, unknown> | null,
    listError: null as unknown,
  },
  mutations: {
    cancelAsync: vi.fn(),
  },
  refetches: {
    list: vi.fn(async () => ({})),
    detail: vi.fn(async () => ({})),
  },
}));

vi.mock('@workspace/api-client-react', () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
    getGetMeQueryKey: () => ['getMe'],
    useListMigrations: () => ({
      data: state.migration ? { migrations: [state.migration] } : { migrations: [] },
      isLoading: false,
      error: state.listError,
      refetch: refetches.list,
    }),
    getListMigrationsQueryKey: (o: number) => ['migrations', o],
    useListMigrationEntityTypes: () => ({ data: { entityTypes: [] }, isLoading: false, error: null }),
    getListMigrationEntityTypesQueryKey: (o: number) => ['migrationEntityTypes', o],
    useGetMigration: () => ({
      data: state.migration ? { migration: state.migration, sources: [], executionPolicy: undefined } : undefined,
      isLoading: false,
      error: null,
      refetch: refetches.detail,
    }),
    getGetMigrationQueryKey: (o: number, id: number) => ['migration', o, id],
    useGetMigrationIssues: () => ({ data: { issues: [] }, isLoading: false, error: null, refetch: vi.fn(async () => ({})) }),
    getGetMigrationIssuesQueryKey: (o: number, id: number) => ['migrationIssues', o, id],
    useGetMigrationReconciliation: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn(async () => ({})) }),
    getGetMigrationReconciliationQueryKey: (o: number, id: number) => ['migrationRecon', o, id],
    useCreateMigration: idle,
    useUploadMigrationSource: idle,
    useSetMigrationSourceMapping: idle,
    useValidateMigration: idle,
    useApproveMigration: idle,
    useExecuteMigration: idle,
    useCancelMigration: () => ({ mutateAsync: mutations.cancelAsync, isPending: false }),
    getGetMigrationTemplateUrl: () => '/template.csv',
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DataMigration />
    </QueryClientProvider>,
  );
}

async function clickCancel() {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  return user;
}

describe('Data Migration — cancel confirmation', () => {
  beforeEach(() => {
    state.migration = { id: 21, name: 'Head office historical records', status: 'validated', createdAt: '2026-09-01T00:00:00.000Z' };
    state.listError = null;
    mutations.cancelAsync.mockReset();
    refetches.list.mockClear();
    refetches.detail.mockClear();
  });

  it('asks before cancelling, naming the migration; Keep Migration sends nothing', async () => {
    const user = await clickCancel();
    const dialog = screen.getByTestId('dialog-cancel-migration');
    expect(dialog).toHaveTextContent('Cancel migration?');
    expect(dialog).toHaveTextContent('“Head office historical records”');
    expect(dialog).toHaveTextContent('cannot be resumed');
    expect(screen.getByTestId('dialog-cancel-migration-confirm')).toHaveTextContent('Cancel Migration');
    expect(screen.getByTestId('dialog-cancel-migration-cancel')).toHaveTextContent('Keep Migration');
    expect(mutations.cancelAsync).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-cancel-migration-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-cancel-migration')).toBeNull());
    expect(mutations.cancelAsync).not.toHaveBeenCalled();
  });

  it('cancels exactly once on confirm, refetches and closes', async () => {
    mutations.cancelAsync.mockResolvedValueOnce({ ...state.migration, status: 'cancelled' });
    const user = await clickCancel();
    await user.click(screen.getByTestId('dialog-cancel-migration-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-cancel-migration')).toBeNull());
    expect(mutations.cancelAsync).toHaveBeenCalledTimes(1);
    expect(mutations.cancelAsync).toHaveBeenCalledWith({ organizationId: 10, migrationId: 21 });
    expect(refetches.list).toHaveBeenCalled();
    expect(refetches.detail).toHaveBeenCalled();
  });

  it('keeps the dialog open and does not refetch when the server refuses', async () => {
    mutations.cancelAsync.mockRejectedValueOnce(new Error('A migration in "running" cannot be cancelled'));
    const user = await clickCancel();
    await user.click(screen.getByTestId('dialog-cancel-migration-confirm'));

    await waitFor(() => expect(mutations.cancelAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-cancel-migration-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-cancel-migration')).toBeInTheDocument();
    expect(screen.getByTestId('row-migration-21')).toBeInTheDocument();
    expect(refetches.list).not.toHaveBeenCalled();
  });

  it('keeps Cancel disabled once a migration has started', async () => {
    state.migration = { ...state.migration!, status: 'running' };
    renderPage();
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows no migration controls to a caller the server refuses', () => {
    state.listError = { status: 403 };
    renderPage();
    expect(screen.getByText('You do not have access to data migration')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});
