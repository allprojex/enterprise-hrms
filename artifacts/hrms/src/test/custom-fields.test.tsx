/**
 * WS-8 Custom Fields — Archive / Restore is a lifecycle change (an archived
 * field refuses new values; captured values are never deleted), so both
 * directions go through a confirmation before the request is sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import CustomFields from '@/pages/custom-fields';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    fields: [] as unknown[],
    listError: null as unknown,
    refetch: vi.fn(),
  },
  mutations: {
    create: vi.fn(),
    version: vi.fn(),
    archive: vi.fn(),
    archiveAsync: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useGetCustomFieldMeta: () => ({
    data: { fieldTypes: [{ type: 'short_text', label: 'Short text' }], scopes: [{ scope: 'employee', label: 'Employee', bindable: true }] },
    isLoading: false,
    error: null,
  }),
  getGetCustomFieldMetaQueryKey: (o: number) => ['cfMeta', o],
  useListCustomFields: () => ({ data: { fields: state.fields }, isLoading: false, error: state.listError, refetch: state.refetch }),
  getListCustomFieldsQueryKey: (o: number, p?: unknown) => ['cfList', o, p],
  useCreateCustomField: () => ({ mutate: mutations.create, isPending: false }),
  useCreateCustomFieldVersion: () => ({ mutate: mutations.version, isPending: false }),
  useArchiveCustomField: () => ({ mutate: mutations.archive, mutateAsync: mutations.archiveAsync, isPending: false }),
  useGetCustomField: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  getGetCustomFieldQueryKey: (o: number, id: number) => ['cf', o, id],
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomFields />
    </QueryClientProvider>,
  );
}

function field(status: 'active' | 'archived') {
  return {
    definition: { id: 3, fieldKey: 'church_branch', status },
    version: { label: 'Church branch', required: false, sensitivity: 'normal', visibility: null, fieldType: 'short_text', versionNumber: 1, helpText: null },
  };
}

async function clickRowAction(name: 'Archive' | 'Restore') {
  const user = userEvent.setup();
  renderPage();
  const row = await screen.findByTestId('row-field-church_branch');
  await user.click(within(row).getByRole('button', { name }));
  return user;
}

describe('Custom Fields — archive / restore confirmation', () => {
  beforeEach(() => {
    state.fields = [field('active')];
    state.listError = null;
    state.refetch.mockReset();
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  it('asks before archiving, naming the field and what happens to values; Cancel sends nothing', async () => {
    const user = await clickRowAction('Archive');
    const dialog = screen.getByTestId('dialog-archive-custom-field');
    expect(dialog).toHaveTextContent('Archive custom field?');
    expect(dialog).toHaveTextContent('“Church branch” will no longer accept new entries. Values already captured are kept');
    expect(screen.getByTestId('dialog-archive-custom-field-confirm')).toHaveTextContent('Archive Field');
    expect(mutations.archiveAsync).not.toHaveBeenCalled();
    expect(mutations.archive).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-archive-custom-field-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-archive-custom-field')).toBeNull());
    expect(mutations.archiveAsync).not.toHaveBeenCalled();
    expect(mutations.archive).not.toHaveBeenCalled();
  });

  it('archives exactly once on confirm, refetches the list and closes', async () => {
    mutations.archiveAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
      return {};
    });
    const user = await clickRowAction('Archive');
    await user.click(screen.getByTestId('dialog-archive-custom-field-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-archive-custom-field')).toBeNull());
    expect(mutations.archiveAsync).toHaveBeenCalledTimes(1);
    expect(mutations.archiveAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, definitionId: 3, data: { archived: true } });
    expect(state.refetch).toHaveBeenCalled();
  });

  it('keeps the dialog open and the row in place when archiving fails', async () => {
    mutations.archiveAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      const err = new Error('Forbidden');
      opts?.onError?.(err);
      throw err;
    });
    const user = await clickRowAction('Archive');
    await user.click(screen.getByTestId('dialog-archive-custom-field-confirm'));

    await waitFor(() => expect(mutations.archiveAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-archive-custom-field-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-archive-custom-field')).toBeInTheDocument();
    expect(screen.getByTestId('row-field-church_branch')).toBeInTheDocument();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it('confirms a restore with a non-destructive dialog and sends archived: false', async () => {
    state.fields = [field('archived')];
    mutations.archiveAsync.mockResolvedValueOnce({});
    const user = await clickRowAction('Restore');
    expect(screen.getByTestId('dialog-archive-custom-field')).toHaveTextContent('Restore custom field?');
    expect(screen.getByTestId('dialog-archive-custom-field-confirm')).toHaveTextContent('Restore Field');
    await user.click(screen.getByTestId('dialog-archive-custom-field-confirm'));
    await waitFor(() => expect(mutations.archiveAsync).toHaveBeenCalledTimes(1));
    expect(mutations.archiveAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, definitionId: 3, data: { archived: false } });
  });

  it('shows no field controls to a caller the server refuses', async () => {
    state.listError = { status: 403 };
    renderPage();
    expect(screen.queryByTestId('row-field-church_branch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });
});
