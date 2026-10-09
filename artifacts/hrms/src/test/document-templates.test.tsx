/**
 * Document Templates — Deactivate / Activate is a lifecycle change, so both
 * directions go through a confirmation. The copy only promises what the server
 * does (the status is flipped; versions and generated documents are untouched).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import DocumentTemplates from '@/pages/document-templates';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    templates: [] as unknown[],
    hrCapable: true,
  },
  mutations: {
    create: vi.fn(),
    status: vi.fn(),
    statusAsync: vi.fn(),
  },
}));

vi.mock('@/hooks/use-hr-capable', () => ({
  useIsHrCapable: () => state.hrCapable,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListDocumentTemplates: () => ({ data: state.templates, isLoading: false, error: null, refetch: vi.fn() }),
  getListDocumentTemplatesQueryKey: (o: number) => [`/api/organizations/${o}/document-templates`],
  useCreateDocumentTemplate: () => ({ mutate: mutations.create, isPending: false }),
  useUpdateDocumentTemplateStatus: () => ({ mutate: mutations.status, mutateAsync: mutations.statusAsync, isPending: false }),
  useListDocumentTemplateVersions: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  getListDocumentTemplateVersionsQueryKey: (o: number, t: number) => ['dtVersions', o, t],
  useCreateDocumentTemplateVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDocumentTemplateVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useActivateDocumentTemplateVersion: () => ({ mutate: vi.fn(), isPending: false }),
  previewDocumentTemplateVersion: vi.fn(),
  useListDocumentMergeFields: () => ({ data: [], isLoading: false }),
  getListDocumentMergeFieldsQueryKey: (o: number) => ['mergeFields', o],
  useListDocumentCategories: () => ({ data: [{ categoryCode: 'letters', label: 'Letters' }], isLoading: false }),
  getListDocumentCategoriesQueryKey: (o: number) => ['docCategories', o],
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <DocumentTemplates />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const activeTemplate = { id: 8, name: 'Confirmation of employment', categoryCode: 'letters', status: 'active', description: null };

describe('Document Templates — deactivate / activate confirmation', () => {
  beforeEach(() => {
    state.templates = [activeTemplate];
    state.hrCapable = true;
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  it('asks before deactivating, naming the template; Cancel sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('button-toggle-template-8'));

    const dialog = screen.getByTestId('dialog-toggle-document-template');
    expect(dialog).toHaveTextContent('Deactivate document template?');
    expect(dialog).toHaveTextContent('“Confirmation of employment” will be marked inactive');
    expect(screen.getByTestId('dialog-toggle-document-template-confirm')).toHaveTextContent('Deactivate Template');
    expect(mutations.statusAsync).not.toHaveBeenCalled();
    expect(mutations.status).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-toggle-document-template-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-toggle-document-template')).toBeNull());
    expect(mutations.statusAsync).not.toHaveBeenCalled();
    expect(mutations.status).not.toHaveBeenCalled();
  });

  it('deactivates exactly once on confirm, invalidates the list and closes', async () => {
    mutations.statusAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
      return { ...activeTemplate, status: 'inactive' };
    });
    const user = userEvent.setup();
    const { invalidate } = renderPage();
    await user.click(screen.getByTestId('button-toggle-template-8'));
    await user.click(screen.getByTestId('dialog-toggle-document-template-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-toggle-document-template')).toBeNull());
    expect(mutations.statusAsync).toHaveBeenCalledTimes(1);
    expect(mutations.statusAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, templateId: 8, data: { status: 'inactive' } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/organizations/10/document-templates'] });
  });

  it('keeps the dialog open and the template listed when the server refuses', async () => {
    mutations.statusAsync.mockImplementationOnce(async (_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      const err = { error: 'Forbidden' };
      opts?.onError?.(err);
      throw err;
    });
    const user = userEvent.setup();
    const { invalidate } = renderPage();
    await user.click(screen.getByTestId('button-toggle-template-8'));
    await user.click(screen.getByTestId('dialog-toggle-document-template-confirm'));

    await waitFor(() => expect(mutations.statusAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-toggle-document-template-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-toggle-document-template')).toBeInTheDocument();
    expect(screen.getByTestId('row-template-8')).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('confirms activation of an inactive template with a non-destructive dialog', async () => {
    state.templates = [{ ...activeTemplate, status: 'inactive' }];
    mutations.statusAsync.mockResolvedValueOnce(activeTemplate);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('button-toggle-template-8'));

    expect(screen.getByTestId('dialog-toggle-document-template')).toHaveTextContent('Activate document template?');
    expect(screen.getByTestId('dialog-toggle-document-template-confirm')).toHaveTextContent('Activate Template');
    await user.click(screen.getByTestId('dialog-toggle-document-template-confirm'));
    await waitFor(() => expect(mutations.statusAsync).toHaveBeenCalledTimes(1));
    expect(mutations.statusAsync.mock.calls[0]![0]).toEqual({ organizationId: 10, templateId: 8, data: { status: 'active' } });
  });

  it('does not offer the lifecycle toggle to a caller who is not HR-capable', () => {
    state.hrCapable = false;
    renderPage();
    expect(screen.getByTestId('row-template-8')).toBeInTheDocument();
    expect(screen.queryByTestId('button-toggle-template-8')).toBeNull();
  });
});
