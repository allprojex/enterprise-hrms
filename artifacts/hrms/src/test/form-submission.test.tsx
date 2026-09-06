/**
 * WS-26A — the submission page: actions follow the server's viewer flags,
 * only editable-section answers are sent, downloads go through the
 * authenticated client, and the history is shown read-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const { state, spies } = vi.hoisted(() => ({
  state: { detail: null as Record<string, unknown> | null, error: null as unknown },
  spies: {
    saveDraft: vi.fn(),
    submit: vi.fn(),
    stage: vi.fn(),
    finalize: vi.fn(),
    downloadDoc: vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    downloadBlank: vi.fn(async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
  },
}));

function mutation(spy: (vars: unknown) => unknown) {
  return () => ({
    isPending: false,
    mutate: (vars: unknown, opts: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) => {
      spy(vars);
      opts.onSuccess?.(state.detail);
    },
  });
}

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useGetFormSubmission: () => ({ data: state.detail, isLoading: false, error: state.error }),
  getGetFormSubmissionQueryKey: (o: number, id: number) => ['formSubmission', o, id],
  getListFormSubmissionsQueryKey: (o: number) => ['formSubmissions', o],
  useSaveFormSubmissionDraft: mutation(spies.saveDraft),
  useSubmitFormSubmission: mutation(spies.submit),
  useActOnFormSubmissionStage: mutation(spies.stage),
  useFinalizeFormSubmission: mutation(spies.finalize),
  useArchiveFormSubmission: mutation(vi.fn()),
  downloadFormSubmissionDocument: spies.downloadDoc,
  downloadFormTemplateBlank: spies.downloadBlank,
}));

const { default: FormSubmissionPage } = await import('@/pages/form-submission');

const definition = {
  header: { logo: 'organization', lines: ['WORLDWIDE WORD MINISTRIES', 'EMPLOYEE LEAVE APPLICATION FORM'] },
  sections: [
    { key: 'leave_period', title: 'LEAVE PERIOD & CONTACT INFORMATION', layout: 'grid', items: [{ kind: 'field', key: 'from_date', label: 'From', type: 'date', width: 'half' }] },
    { key: 'approval', title: 'APPROVAL SECTION - TO BE COMPLETED BY MANAGER / SUPERVISOR', layout: 'grid', editableBy: ['supervisor'], items: [{ kind: 'field', key: 'approved_by', label: 'Approved By', type: 'short_text', width: 'half' }] },
  ],
};

function detailFor(overrides: Record<string, unknown> = {}) {
  return {
    submission: { id: 7, organizationId: 10, templateId: 1, templateKey: 'wwm_leave_application', templateTitle: 'Employee Leave Application Form', formType: 'leave_application', templateVersionId: 2, versionNumber: 1, subjectEmployeeId: 3, subjectName: 'Ama Boateng', status: 'draft', currentStageOrder: null, stageCountSnapshot: null, createdByMembershipId: 5, submittedAt: null, approvedAt: null, finalizedAt: null, finalDocumentId: null, finalSha256: null, archivedAt: null, createdAt: '2026-09-06T10:00:00Z', updatedAt: '2026-09-06T10:00:00Z' },
    template: { id: 1, templateKey: 'wwm_leave_application', title: 'Employee Leave Application Form', formType: 'leave_application' },
    version: { id: 2, versionNumber: 1, definition, signaturePolicy: null, definitionSha256: 'abc' },
    stages: [{ id: 1, stageOrder: 1, name: 'Manager / Supervisor approval', participant: 'supervisor', resolver: 'reporting_manager', editableSectionKeys: ['approval'], allowedActions: ['approve', 'return', 'reject'], signatureSlotKey: null }],
    currentRevision: { id: 11, revisionNumber: 1, kind: 'draft', answers: { from_date: '2026-10-01', approved_by: 'Old' }, autofillSnapshot: {}, computed: {}, stageOrder: null, savedAt: '2026-09-06T10:00:00Z' },
    revisions: [],
    events: [{ id: 1, eventType: 'created', stageOrder: null, stageName: null, revisionId: 11, notes: null, details: null, actorUserId: 1, actorMembershipId: 5, actorName: 'Ama Boateng', occurredAt: '2026-09-06T10:00:00Z' }],
    viewer: { canEdit: true, editableSectionKeys: ['leave_period'], canSubmit: true, availableActions: [], canFinalize: false, canArchive: false, isSubject: true },
    ...overrides,
  };
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/forms/7', static: true });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={hook}>
        <Route path="/forms/:submissionId" component={FormSubmissionPage} />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.detail = detailFor();
  state.error = null;
  Object.values(spies).forEach((s) => s.mockClear());
  if (typeof URL.createObjectURL !== 'function') {
    Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
  }
});

describe('FormSubmissionPage', () => {
  it('renders the form, the status and the history, and lets the employee save only their own sections', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Employee Leave Application Form')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByTestId('form-history')).toHaveTextContent('Created');
    expect(screen.getByTestId('section-approval')).toHaveAttribute('data-editable', 'false');

    await user.clear(screen.getByTestId('input-from_date'));
    await user.type(screen.getByTestId('input-from_date'), '2026-10-02');
    await user.click(screen.getByTestId('button-save-draft'));
    expect(spies.saveDraft).toHaveBeenCalledTimes(1);
    const vars = spies.saveDraft.mock.calls[0][0] as { data: { answers: Record<string, unknown> } };
    expect(vars.data.answers).toEqual({ from_date: '2026-10-02' });
    expect(vars.data.answers.approved_by).toBeUndefined();
  });

  it('shows stage actions only when the server says the caller is the actor, and requires notes to return or reject', async () => {
    const user = userEvent.setup();
    state.detail = detailFor({
      submission: { ...detailFor().submission, status: 'pending_approval', currentStageOrder: 1, stageCountSnapshot: 1 },
      viewer: { canEdit: true, editableSectionKeys: ['approval'], canSubmit: false, availableActions: ['approve', 'return', 'reject'], canFinalize: false, canArchive: false, isSubject: false },
    });
    renderPage();
    expect(await screen.findByTestId('button-stage-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('button-submit-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-stage-return')).toBeDisabled();
    await user.type(screen.getByTestId('input-stage-notes'), 'Please add the email');
    expect(screen.getByTestId('button-stage-return')).toBeEnabled();
    await user.click(screen.getByTestId('button-stage-return'));
    const vars = spies.stage.mock.calls[0][0] as { data: { action: string; notes: string } };
    expect(vars.data.action).toBe('return');
    expect(vars.data.notes).toBe('Please add the email');
  });

  it('offers finalize to HR on an approved form and downloads through the authenticated client', async () => {
    const user = userEvent.setup();
    state.detail = detailFor({
      submission: { ...detailFor().submission, status: 'approved' },
      viewer: { canEdit: false, editableSectionKeys: [], canSubmit: false, availableActions: [], canFinalize: true, canArchive: false, isSubject: false },
    });
    renderPage();
    await user.click(await screen.findByTestId('button-finalize'));
    expect(spies.finalize).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('button-download-current'));
    await waitFor(() => expect(spies.downloadDoc).toHaveBeenCalledWith(10, 7, { kind: 'approved' }));
    await user.click(screen.getByTestId('button-download-blank'));
    await waitFor(() => expect(spies.downloadBlank).toHaveBeenCalledWith(10, 2));
  });

  it('shows a not-found state instead of a form when the server hides the submission', async () => {
    state.detail = null;
    state.error = { status: 404 };
    renderPage();
    expect(await screen.findByText('Form not found')).toBeInTheDocument();
    expect(screen.queryByTestId('form-renderer')).not.toBeInTheDocument();
  });
});
