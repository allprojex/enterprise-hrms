/**
 * WS-26A — the Forms list (start a form, list visible submissions) and the
 * Form Templates admin page (create from JSON, publish, blank download).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const { state, spies } = vi.hoisted(() => ({
  state: {
    templates: [] as Record<string, unknown>[],
    submissions: [] as Record<string, unknown>[],
    // WWM Employee Access Remediation (2026-09-07): role keys drive the
    // /form-templates admin gate (same heuristic as the sidebar).
    roles: ['hr_manager'] as string[],
    rolesLoading: false,
    failMutations: false,
  },
  spies: {
    createSubmission: vi.fn(),
    createTemplate: vi.fn(),
    publish: vi.fn(),
    archiveTemplate: vi.fn(),
    downloadBlank: vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
  },
}));

function mutation(spy: (vars: unknown) => unknown, result: () => unknown) {
  return () => ({
    isPending: false,
    mutate: (vars: unknown, opts: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) => {
      spy(vars);
      opts.onSuccess?.(result());
    },
    mutateAsync: async (vars: unknown, opts?: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) => {
      spy(vars);
      if (state.failMutations) {
        const err = { data: { error: 'Template is archived' } };
        opts?.onError?.(err);
        throw err;
      }
      const data = result();
      opts?.onSuccess?.(data);
      return data;
    },
  });
}

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.rolesLoading ? undefined : [{ organizationId: 10, roles: state.roles }], isLoading: state.rolesLoading }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListFormTemplates: () => ({ data: { templates: state.templates }, isLoading: false, error: null, refetch: vi.fn() }),
  getListFormTemplatesQueryKey: (o: number) => ['formTemplates', o],
  useListFormSubmissions: () => ({ data: { submissions: state.submissions }, isLoading: false, error: null, refetch: vi.fn() }),
  getListFormSubmissionsQueryKey: (o: number) => ['formSubmissions', o],
  useCreateFormSubmission: mutation(spies.createSubmission, () => ({ submission: { id: 42 }, template: { title: 'Employee Leave Application Form' } })),
  useCreateFormTemplate: mutation(spies.createTemplate, () => ({})),
  useCreateFormTemplateVersion: mutation(vi.fn(), () => ({})),
  usePublishFormTemplateVersion: mutation(spies.publish, () => ({})),
  useArchiveFormTemplate: mutation(spies.archiveTemplate, () => ({})),
  downloadFormTemplateBlank: spies.downloadBlank,
}));

const { default: FormsPage } = await import('@/pages/forms');
const { default: FormTemplatesPage } = await import('@/pages/form-templates');

function wrap(ui: React.ReactElement, path: string) {
  const { hook, navigate, history } = memoryLocation({ path, record: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={hook}>{ui}</Router>
    </QueryClientProvider>,
  );
  return { navigate, hook, history };
}

const publishedTemplate = {
  id: 1,
  templateKey: 'wwm_leave_application',
  formType: 'leave_application',
  moduleKey: 'leave',
  title: 'Employee Leave Application Form',
  description: null,
  status: 'active',
  currentPublishedVersionId: 2,
  createdAt: '2026-09-06T10:00:00Z',
  updatedAt: '2026-09-06T10:00:00Z',
  versions: [
    { id: 2, templateId: 1, versionNumber: 2, status: 'published', publishedAt: '2026-09-06T10:00:00Z', firstUsedAt: null, definitionSha256: 'a'.repeat(64), changeNote: null, createdAt: '2026-09-06T10:00:00Z' },
    { id: 3, templateId: 1, versionNumber: 3, status: 'draft', publishedAt: null, firstUsedAt: null, definitionSha256: 'b'.repeat(64), changeNote: 'v3', createdAt: '2026-09-06T10:00:00Z' },
  ],
};

beforeEach(() => {
  state.templates = [publishedTemplate];
  state.submissions = [];
  state.roles = ['hr_manager'];
  state.rolesLoading = false;
  state.failMutations = false;
  Object.values(spies).forEach((s) => s.mockClear());
  if (typeof URL.createObjectURL !== 'function') {
    Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
  }
});

describe('FormsPage', () => {
  it('shows an empty state and lets the employee start a published form', async () => {
    const user = userEvent.setup();
    wrap(<FormsPage />, '/forms');
    expect(await screen.findByText('No forms yet')).toBeInTheDocument();
    expect(screen.getByTestId('button-start-form')).toBeDisabled();
    await user.click(screen.getByTestId('select-form-template'));
    await user.click(await screen.findByRole('option', { name: 'Employee Leave Application Form' }));
    await user.click(screen.getByTestId('button-start-form'));
    expect(spies.createSubmission).toHaveBeenCalledWith({ organizationId: 10, data: { templateId: 1 } });
  });

  it('lists visible submissions with status and stage', async () => {
    state.submissions = [
      { id: 7, organizationId: 10, templateId: 1, templateKey: 'wwm_leave_application', templateTitle: 'Employee Leave Application Form', formType: 'leave_application', templateVersionId: 2, versionNumber: 2, subjectEmployeeId: 3, subjectName: 'Ama Boateng', status: 'pending_approval', currentStageOrder: 1, stageCountSnapshot: 1, createdByMembershipId: 5, submittedAt: null, approvedAt: null, finalizedAt: null, finalDocumentId: null, finalSha256: null, archivedAt: null, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z' },
    ];
    wrap(<FormsPage />, '/forms');
    const row = await screen.findByTestId('row-form-7');
    expect(row).toHaveTextContent('Ama Boateng');
    expect(row).toHaveTextContent('Pending approval');
    expect(row).toHaveTextContent('1 of 1');
    expect(screen.getByTestId('link-form-7')).toHaveAttribute('href', '/forms/7');
  });
});

describe('FormTemplatesPage', () => {
  // WWM Employee Access Remediation (2026-09-07): the administrative page is
  // never shown to an ordinary employee, even by typing the URL directly —
  // the sidebar already hides it; this closes the direct-route path. The
  // backend's form_template.manage/.publish gates remain authoritative.
  it('redirects an ordinary employee to /unauthorized and never renders New template', async () => {
    state.roles = ['employee'];
    const { history } = wrap(<FormTemplatesPage />, '/form-templates');
    await waitFor(() => expect(history?.at(-1)).toBe('/unauthorized'));
    expect(screen.queryByTestId('button-new-template')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-version-3')).not.toBeInTheDocument();
  });

  it('shows a skeleton (no redirect, no admin controls) while the role lookup is still loading', async () => {
    state.rolesLoading = true;
    const { history } = wrap(<FormTemplatesPage />, '/form-templates');
    expect(screen.queryByTestId('button-new-template')).not.toBeInTheDocument();
    expect(history?.at(-1)).toBe('/form-templates');
  });

  it('renders the admin page for an HR-capable caller', async () => {
    state.roles = ['org_admin'];
    const { history } = wrap(<FormTemplatesPage />, '/form-templates');
    expect(await screen.findByTestId('button-new-template')).toBeInTheDocument();
    expect(history?.at(-1)).toBe('/form-templates');
  });

  it('lists versions, publishes a draft and downloads the blank form', async () => {
    const user = userEvent.setup();
    wrap(<FormTemplatesPage />, '/form-templates');
    expect(await screen.findByTestId('row-version-3')).toHaveTextContent('v3');
    await user.click(screen.getByTestId('button-publish-3'));
    expect(spies.publish).toHaveBeenCalledWith({ organizationId: 10, versionId: 3 });
    await user.click(screen.getByTestId('button-blank-2'));
    await waitFor(() => expect(spies.downloadBlank).toHaveBeenCalledWith(10, 2));
  });

  describe('archive confirmation', () => {
    it('opens a confirmation naming the template instead of archiving on click, and Cancel archives nothing', async () => {
      const user = userEvent.setup();
      wrap(<FormTemplatesPage />, '/form-templates');
      await user.click(await screen.findByTestId('button-archive-template-1'));
      const dialog = screen.getByTestId('dialog-archive-template');
      expect(dialog).toHaveTextContent('Archive form template?');
      expect(dialog).toHaveTextContent('“Employee Leave Application Form” will no longer be available for new forms');
      expect(dialog).toHaveTextContent('cannot be restored from here');
      expect(screen.getByTestId('dialog-archive-template-confirm')).toHaveTextContent('Archive Template');
      expect(spies.archiveTemplate).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('dialog-archive-template-cancel'));
      await waitFor(() => expect(screen.queryByTestId('dialog-archive-template')).not.toBeInTheDocument());
      expect(spies.archiveTemplate).not.toHaveBeenCalled();
    });

    it('archives exactly once on confirm, refreshes the list and closes', async () => {
      const user = userEvent.setup();
      const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      wrap(<FormTemplatesPage />, '/form-templates');
      await user.click(await screen.findByTestId('button-archive-template-1'));
      await user.click(screen.getByTestId('dialog-archive-template-confirm'));
      await waitFor(() => expect(screen.queryByTestId('dialog-archive-template')).not.toBeInTheDocument());
      expect(spies.archiveTemplate).toHaveBeenCalledTimes(1);
      expect(spies.archiveTemplate).toHaveBeenCalledWith({ organizationId: 10, templateId: 1 });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['formTemplates', 10] });
      invalidate.mockRestore();
    });

    it('keeps the dialog open and the template listed when archiving fails', async () => {
      const user = userEvent.setup();
      state.failMutations = true;
      wrap(<FormTemplatesPage />, '/form-templates');
      await user.click(await screen.findByTestId('button-archive-template-1'));
      await user.click(screen.getByTestId('dialog-archive-template-confirm'));
      await waitFor(() => expect(spies.archiveTemplate).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('dialog-archive-template-confirm')).toBeEnabled());
      expect(screen.getByTestId('dialog-archive-template')).toBeInTheDocument();
      expect(screen.getByTestId('card-template-1')).toBeInTheDocument();
    });
  });

  it('creates a template from JSON and rejects invalid JSON before any request', async () => {
    const user = userEvent.setup();
    wrap(<FormTemplatesPage />, '/form-templates');
    await user.click(await screen.findByTestId('button-new-template'));
    await user.type(screen.getByTestId('input-template-key'), 'my_form');
    await user.type(screen.getByTestId('input-template-title'), 'My Form');
    await user.click(screen.getByTestId('input-template-definition'));
    await user.paste('{not json');
    await user.click(screen.getByTestId('button-save-template'));
    expect(await screen.findByTestId('template-form-error')).toHaveTextContent(/valid JSON/);
    expect(spies.createTemplate).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('input-template-definition'));
    await user.click(screen.getByTestId('input-template-definition'));
    await user.paste('{"header":{"lines":["X"],"logo":"none"},"sections":[]}');
    await user.click(screen.getByTestId('button-save-template'));
    expect(spies.createTemplate).toHaveBeenCalledTimes(1);
    const vars = spies.createTemplate.mock.calls[0][0] as { data: { templateKey: string; title: string; definition: unknown } };
    expect(vars.data.templateKey).toBe('my_form');
    expect(vars.data.title).toBe('My Form');
    expect(vars.data.definition).toEqual({ header: { lines: ['X'], logo: 'none' }, sections: [] });
  });
});
