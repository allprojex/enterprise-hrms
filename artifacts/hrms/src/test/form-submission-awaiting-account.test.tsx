/**
 * The pending Employee Confirmation & Signature view (WS-26, B2).
 *
 * A stage that resolves to the subject employee has no actor at all until that
 * employee's record is linked to a login. Before this, the form simply sat
 * there saying it was "awaiting" a person who had no way to reach it. HR needs
 * to be told why — and must still not be given any way to sign in their place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const detail = vi.fn();

vi.mock('wouter', () => ({
  useParams: () => ({ id: '77' }),
  useRoute: () => [true, { submissionId: '77' }],
  Link: ({ children }: { children: React.ReactNode }) => <a href="/forms">{children}</a>,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 434, organizationId: 3, firstName: 'Gloria', lastName: 'Dordunu' } }),
  getGetMeQueryKey: () => ['me'],
  useGetFormSubmission: () => detail(),
  getGetFormSubmissionQueryKey: () => ['submission', 77],
  getListFormSubmissionsQueryKey: () => ['submissions', 3],
  useSaveFormSubmissionDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitFormSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  useActOnFormSubmissionStage: () => ({ mutate: vi.fn(), isPending: false }),
  useFinalizeFormSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveFormSubmission: () => ({ mutate: vi.fn(), isPending: false }),
  useListFormSubmissionSignatures: () => ({ data: { items: [] } }),
  getListFormSubmissionSignaturesQueryKey: () => ['signatures', 77],
  downloadFormSubmissionDocument: vi.fn(),
  downloadFormTemplateBlank: vi.fn(),
}));

import FormSubmissionPage from '@/pages/form-submission';

const CONFIRMATION_STAGE = {
  id: 1,
  stageOrder: 1,
  name: 'Employee Confirmation & Signature',
  participant: 'employee',
  resolver: 'subject_employee',
  editableSectionKeys: [],
  allowedActions: ['complete'],
  signatureSlotKey: 'employee_signature',
};

function payload(over: Record<string, unknown> = {}) {
  return {
    data: {
      submission: {
        id: 77,
        organizationId: 3,
        templateTitle: 'Staff Personal Information Form',
        templateKey: 'wwm_personal_information',
        formType: 'personal_information',
        versionNumber: 1,
        subjectEmployeeId: 446,
        subjectName: 'Adwoa Asante',
        status: 'pending_approval',
        currentStageOrder: 1,
        stageCountSnapshot: 2,
        createdByMembershipId: 434,
        assisted: true,
        assistanceReason: 'system_access_unavailable',
        currentStageName: 'Employee Confirmation & Signature',
        createdAt: '2026-09-15T00:00:00.000Z',
        updatedAt: '2026-09-15T00:00:00.000Z',
      },
      subjectHasAccount: false,
      template: { id: 2, templateKey: 'wwm_personal_information', title: 'Staff Personal Information Form', formType: 'personal_information' },
      version: { id: 2, versionNumber: 1, definition: { header: { lines: ['Staff Personal Information Form'] }, sections: [] }, signaturePolicy: { slots: [] }, definitionSha256: 'abc' },
      stages: [CONFIRMATION_STAGE],
      currentRevision: { id: 9, revisionNumber: 1, kind: 'submitted', answers: {}, autofillSnapshot: {}, computed: {}, stageOrder: 1, savedAt: '2026-09-15T00:00:00.000Z' },
      revisions: [],
      events: [],
      viewer: { canEdit: false, editableSectionKeys: [], canSubmit: false, availableActions: [], canFinalize: false, canArchive: false, isSubject: false },
      redactedFieldKeys: [],
      ...over,
    },
    isLoading: false,
    error: null,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FormSubmissionPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  detail.mockReset();
});

describe('subject employee has no linked account', () => {
  beforeEach(() => detail.mockReturnValue(payload()));

  it('explains that the form is waiting for the account, not for the person', () => {
    renderPage();
    const note = screen.getByTestId('text-awaiting-account');
    expect(note).toHaveTextContent(/waiting for adwoa asante/i);
    expect(note).toHaveTextContent(/account to be linked/i);
  });

  it('says plainly that nobody can sign in their place', () => {
    renderPage();
    expect(screen.getByTestId('text-awaiting-account')).toHaveTextContent(/nobody else can sign in their place/i);
  });

  it('gives HR no action to take on the employee’s behalf', () => {
    renderPage();
    expect(screen.queryByTestId('button-stage-complete')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign (for|as|on behalf)/i })).not.toBeInTheDocument();
  });

  it('exposes no internal identifier', () => {
    renderPage();
    const text = screen.getByTestId('text-awaiting-account').textContent ?? '';
    for (const jargon of ['subject_employee', 'membership', 'resolver', 'application_user', '446']) {
      expect(text).not.toContain(jargon);
    }
  });
});

describe('subject employee does have a linked account', () => {
  it('keeps the ordinary awaiting message', () => {
    detail.mockReturnValue(payload({ subjectHasAccount: true }));
    renderPage();
    expect(screen.queryByTestId('text-awaiting-account')).not.toBeInTheDocument();
    expect(screen.getByTestId('panel-awaiting-employee-signature')).toHaveTextContent('Awaiting Employee Confirmation & Signature');
  });
});
