/**
 * WS-8 Form Builder — Archive / Restore of a form is a lifecycle change (an
 * archived form refuses new submissions and new versions; captured submissions
 * are kept), so both directions go through a confirmation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import CustomForms from '@/pages/custom-forms';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    detail: undefined as unknown,
    formsError: null as unknown,
    formsRefetch: vi.fn(),
    detailRefetch: vi.fn(),
  },
  mutations: {
    create: vi.fn(),
    version: vi.fn(),
    publish: vi.fn(),
    archive: vi.fn(),
    archiveAsync: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useGetCustomFieldMeta: () => ({ data: { fieldTypes: [], scopes: [{ scope: 'employee', label: 'Employee', bindable: true }] }, isLoading: false, error: null }),
  getGetCustomFieldMetaQueryKey: (o: number) => ['cfMeta', o],
  useListCustomFields: () => ({ data: { fields: [] }, isLoading: false, error: null, refetch: vi.fn() }),
  getListCustomFieldsQueryKey: (o: number, p?: unknown) => ['cfList', o, p],
  useListCustomForms: () => ({
    data: { forms: [{ id: 4, formKey: 'new_starter_details', formType: 'internal_hr', scope: 'employee', status: 'active' }] },
    isLoading: false,
    error: state.formsError,
    refetch: state.formsRefetch,
  }),
  getListCustomFormsQueryKey: (o: number) => ['forms', o],
  useCreateCustomForm: () => ({ mutate: mutations.create, isPending: false }),
  useGetCustomForm: () => ({ data: state.detail, isLoading: false, error: null, refetch: state.detailRefetch }),
  getGetCustomFormQueryKey: (o: number, id: number) => ['form', o, id],
  useCreateCustomFormVersion: () => ({ mutate: mutations.version, isPending: false }),
  usePublishCustomFormVersion: () => ({ mutate: mutations.publish, isPending: false }),
  useArchiveCustomForm: () => ({ mutate: mutations.archive, mutateAsync: mutations.archiveAsync, isPending: false }),
  useListCustomFormSubmissions: () => ({ data: { submissions: [] }, isLoading: false, error: null }),
  getListCustomFormSubmissionsQueryKey: (o: number, p?: unknown) => ['formSubs', o, p],
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomForms />
    </QueryClientProvider>,
  );
}

function detailWith(status: 'active' | 'archived') {
  return {
    form: { id: 4, formKey: 'new_starter_details', formType: 'internal_hr', scope: 'employee', status },
    publishedVersion: { id: 9, versionNumber: 1 },
    versions: [{ id: 9, versionNumber: 1, title: 'New Starter Details', status: 'published', description: null, layout: { sections: [] } }],
  };
}

async function clickLifecycle(name: 'Archive' | 'Restore') {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name }));
  return user;
}

describe('Form Builder — archive / restore confirmation', () => {
  beforeEach(() => {
    state.detail = detailWith('active');
    state.formsError = null;
    state.formsRefetch.mockReset();
    state.detailRefetch.mockReset();
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  it('asks before archiving a form; Cancel sends nothing', async () => {
    const user = await clickLifecycle('Archive');
    const dialog = screen.getByTestId('dialog-archive-custom-form');
    expect(dialog).toHaveTextContent('Archive form?');
    expect(dialog).toHaveTextContent('“new_starter_details” will no longer accept new submissions or new versions. Existing submissions are kept');
    expect(screen.getByTestId('dialog-archive-custom-form-confirm')).toHaveTextContent('Archive Form');
    expect(mutations.archiveAsync).not.toHaveBeenCalled();
    expect(mutations.archive).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-archive-custom-form-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-archive-custom-form')).toBeNull());
    expect(mutations.archiveAsync).not.toHaveBeenCalled();
    expect(mutations.archive).not.toHaveBeenCalled();
  });

  it('archives exactly once on confirm, refetches the list and the detail, and closes', async () => {
    mutations.archiveAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
      return {};
    });
    const user = await clickLifecycle('Archive');
    await user.click(screen.getByTestId('dialog-archive-custom-form-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-archive-custom-form')).toBeNull());
    expect(mutations.archiveAsync).toHaveBeenCalledTimes(1);
    expect(mutations.archiveAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, formId: 4, data: { archived: true } });
    expect(state.formsRefetch).toHaveBeenCalled();
    expect(state.detailRefetch).toHaveBeenCalled();
  });

  it('keeps the dialog open and the form in place when archiving fails', async () => {
    mutations.archiveAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      const err = new Error('Forbidden');
      opts?.onError?.(err);
      throw err;
    });
    const user = await clickLifecycle('Archive');
    await user.click(screen.getByTestId('dialog-archive-custom-form-confirm'));

    await waitFor(() => expect(mutations.archiveAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-archive-custom-form-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-archive-custom-form')).toBeInTheDocument();
    expect(screen.getByTestId('row-form-new_starter_details')).toBeInTheDocument();
    expect(state.formsRefetch).not.toHaveBeenCalled();
  });

  it('confirms a restore with a non-destructive dialog and sends archived: false', async () => {
    state.detail = detailWith('archived');
    mutations.archiveAsync.mockResolvedValueOnce({});
    const user = await clickLifecycle('Restore');
    expect(screen.getByTestId('dialog-archive-custom-form')).toHaveTextContent('Restore form?');
    expect(screen.getByTestId('dialog-archive-custom-form-confirm')).toHaveTextContent('Restore Form');
    await user.click(screen.getByTestId('dialog-archive-custom-form-confirm'));
    await waitFor(() => expect(mutations.archiveAsync).toHaveBeenCalledTimes(1));
    expect(mutations.archiveAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, formId: 4, data: { archived: false } });
  });

  it('shows no form controls to a caller the server refuses', () => {
    state.formsError = { status: 403 };
    renderPage();
    expect(screen.getByText('You do not have access to forms')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });
});
