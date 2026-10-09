/**
 * HR-assisted submission UI (WS-26).
 *
 * The control is an exception path, so these tests care most about the things
 * that must NOT happen: it must not appear for a caller without the explicit
 * permission, it must not offer a form whose published version has not opted
 * in, it must not accept a free-typed employee id, and it must not let HR
 * proceed without classifying why assistance was needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createMutate = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: vi.fn(),
  getGetMeQueryKey: () => ['me'],
  useListMyOrganizations: vi.fn(),
  getListMyOrganizationsQueryKey: () => ['myOrgs'],
  useListFormTemplates: vi.fn(),
  getListFormTemplatesQueryKey: (id: number) => ['templates', id],
  useListFormSubmissions: vi.fn(),
  getListFormSubmissionsQueryKey: (id: number) => ['submissions', id],
  useCreateFormSubmission: () => ({ mutate: createMutate, isPending: false }),
  useListEmployees: vi.fn(),
  getListEmployeesQueryKey: (id: number) => ['employees', id],
}));

import {
  useGetMe,
  useListMyOrganizations,
  useListFormTemplates,
  useListFormSubmissions,
  useListEmployees,
} from '@workspace/api-client-react';
import FormsPage from '@/pages/forms';

const PIF = { id: 2, templateKey: 'wwm_personal_information', title: 'Staff Personal Information Form', formType: 'personal_information', status: 'active', currentPublishedVersionId: 2, allowsOnBehalfSubmission: true, versions: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const LEAVE = { ...PIF, id: 1, templateKey: 'wwm_leave_application', title: 'Employee Leave Application Form', formType: 'leave_application', currentPublishedVersionId: 1, allowsOnBehalfSubmission: false };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FormsPage />
    </QueryClientProvider>,
  );
}

function setPermissions(keys: string[]) {
  vi.mocked(useListMyOrganizations).mockReturnValue({
    data: [{ organizationId: 3, permissions: keys }],
  } as never);
}

describe('HR-assisted submission', () => {
  beforeEach(() => {
    createMutate.mockReset();
    vi.mocked(useGetMe).mockReturnValue({ data: { id: 434, organizationId: 3, firstName: 'Gloria', lastName: 'Dordunu' } } as never);
    vi.mocked(useListFormTemplates).mockReturnValue({ data: { templates: [PIF, LEAVE] }, isLoading: false, error: null } as never);
    vi.mocked(useListFormSubmissions).mockReturnValue({ data: { submissions: [] }, isLoading: false, error: null, refetch: vi.fn() } as never);
    vi.mocked(useListEmployees).mockReturnValue({
      data: {
        items: [
          { id: 445, firstName: 'Kwame', lastName: 'Owusu', employeeNumber: 'EMP-0050', linkedApplicationUserId: 900 },
          { id: 446, firstName: 'Adwoa', lastName: 'Asante', employeeNumber: 'EMP-0051', linkedApplicationUserId: null },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    setPermissions(['form_submission.create_on_behalf']);
  });

  it('is hidden for a caller without form_submission.create_on_behalf', () => {
    setPermissions(['form.read', 'form.assess', 'form.approve']);
    renderPage();
    // form.assess is deliberately NOT enough — it no longer authorizes this.
    expect(screen.queryByTestId('button-assisted-submission')).not.toBeInTheDocument();
  });

  it('is hidden when the caller has no permissions at all', () => {
    setPermissions([]);
    renderPage();
    expect(screen.queryByTestId('button-assisted-submission')).not.toBeInTheDocument();
  });

  it('is offered to a caller holding the explicit permission', () => {
    renderPage();
    expect(screen.getByTestId('button-assisted-submission')).toBeInTheDocument();
  });

  it('offers only templates whose published version opts in', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-assisted-submission'));
    await waitFor(() => expect(screen.getByTestId('select-assisted-template')).toBeInTheDocument());
    // The Leave form has allowsOnBehalfSubmission: false and must not be listed.
    expect(screen.queryByText('Employee Leave Application Form')).not.toBeInTheDocument();
  });

  it('offers employees from a server-scoped list rather than a free-text id field', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-assisted-submission'));
    await waitFor(() => expect(screen.getByTestId('select-assisted-employee')).toBeInTheDocument());
    // A select, never an input the caller could type an arbitrary id into.
    expect(screen.getByTestId('select-assisted-employee').tagName).not.toBe('INPUT');
    expect(screen.queryByPlaceholderText(/employee id/i)).not.toBeInTheDocument();
  });

  it('cannot continue until a form, an employee and a reason are all chosen', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-assisted-submission'));
    await waitFor(() => expect(screen.getByTestId('button-assisted-continue')).toBeInTheDocument());
    expect(screen.getByTestId('button-assisted-continue')).toBeDisabled();
  });

  it('never submits without going through the confirmation step', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-assisted-submission'));
    await waitFor(() => expect(screen.getByTestId('button-assisted-continue')).toBeInTheDocument());
    // No confirm button is reachable before Continue.
    expect(screen.queryByTestId('button-assisted-confirm')).not.toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe('assisted marker in the forms list', () => {
  beforeEach(() => {
    vi.mocked(useGetMe).mockReturnValue({ data: { id: 431, organizationId: 3 } } as never);
    setPermissions([]);
    vi.mocked(useListFormTemplates).mockReturnValue({ data: { templates: [] }, isLoading: false, error: null } as never);
    vi.mocked(useListEmployees).mockReturnValue({ data: { items: [] }, isLoading: false } as never);
  });

  const base = {
    id: 7, templateTitle: 'Staff Personal Information Form', versionNumber: 1,
    subjectName: 'Kwame Owusu', status: 'draft', currentStageOrder: null,
    stageCountSnapshot: null, updatedAt: '2026-09-14T00:00:00.000Z',
  };

  it('marks an assisted submission as HR-assisted', () => {
    vi.mocked(useListFormSubmissions).mockReturnValue({
      data: { submissions: [{ ...base, assisted: true, assistanceReason: 'medical_or_incapacity' }] },
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.getByTestId('badge-assisted-7')).toHaveTextContent('HR-assisted');
  });

  it('does not mark a self-completed submission', () => {
    vi.mocked(useListFormSubmissions).mockReturnValue({
      data: { submissions: [{ ...base, assisted: false, assistanceReason: null }] },
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderPage();
    expect(screen.queryByTestId('badge-assisted-7')).not.toBeInTheDocument();
  });

  it('never renders the assistance notes in the list', () => {
    vi.mocked(useListFormSubmissions).mockReturnValue({
      data: { submissions: [{ ...base, assisted: true, assistanceReason: 'medical_or_incapacity' }] },
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const { container } = renderPage();
    // The API never sends notes in a summary; the UI must not invent a place for them.
    expect(container.textContent).not.toMatch(/assistanceNotes|notes:/i);
  });
});

/**
 * B2 — the confirmation step must repeat the account warning, because that is
 * the last moment before a form is created for someone who cannot yet act on
 * it. HR is warned, never blocked: preparing the form early is the point.
 */
describe('assisted confirmation step — unlinked employee (B2)', () => {
  beforeEach(() => {
    createMutate.mockReset();
    vi.mocked(useGetMe).mockReturnValue({ data: { id: 434, organizationId: 3, firstName: 'Gloria', lastName: 'Dordunu' } } as never);
    vi.mocked(useListFormTemplates).mockReturnValue({ data: { templates: [PIF] }, isLoading: false, error: null } as never);
    vi.mocked(useListFormSubmissions).mockReturnValue({ data: { submissions: [] }, isLoading: false, error: null, refetch: vi.fn() } as never);
    // One employee with a login, one without — the picker must tell them apart.
    vi.mocked(useListEmployees).mockReturnValue({
      data: {
        items: [
          { id: 445, firstName: 'Kwame', lastName: 'Owusu', employeeNumber: 'EMP-0050', linkedApplicationUserId: 900 },
          { id: 446, firstName: 'Adwoa', lastName: 'Asante', employeeNumber: 'EMP-0051', linkedApplicationUserId: null },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    setPermissions(['form_submission.create_on_behalf']);
  });

  /** Drives the dialog as HR would: form, employee, reason, then Continue. */
  async function fillTo(employeeTestId: string) {
    renderPage();
    fireEvent.click(screen.getByTestId('button-assisted-submission'));
    await waitFor(() => expect(screen.getByTestId('select-assisted-template')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('select-assisted-template'));
    fireEvent.click(await screen.findByText('Staff Personal Information Form'));

    fireEvent.click(screen.getByTestId('select-assisted-employee'));
    fireEvent.click(await screen.findByTestId(employeeTestId));

    fireEvent.click(screen.getByTestId('select-assisted-reason'));
    fireEvent.click(await screen.findByText('Employee cannot access the system'));

    await waitFor(() => expect(screen.getByTestId('button-assisted-continue')).toBeEnabled());
    fireEvent.click(screen.getByTestId('button-assisted-continue'));
    await waitFor(() => expect(screen.getByTestId('assisted-confirm-panel')).toBeInTheDocument());
  }

  it('warns at the confirmation step when the employee has no account', async () => {
    await fillTo('option-assisted-employee-446');
    expect(screen.getByTestId('panel-confirm-no-account')).toBeInTheDocument();
  });

  it('does not warn when the employee has an account', async () => {
    await fillTo('option-assisted-employee-445');
    expect(screen.queryByTestId('panel-confirm-no-account')).not.toBeInTheDocument();
  });

  it('still lets HR create the form for an employee with no account', async () => {
    await fillTo('option-assisted-employee-446');
    const confirm = screen.getByTestId('button-assisted-confirm');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0].data.subjectEmployeeId).toBe(446);
  });

  it('offers HR no way to sign or confirm for the employee', async () => {
    await fillTo('option-assisted-employee-446');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/applied by the employee from\s+their own account/);
    expect(screen.queryByRole('button', { name: /sign (for|as)/i })).not.toBeInTheDocument();
  });
});
