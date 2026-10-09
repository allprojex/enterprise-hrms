/**
 * WS-13 (§29.17 actions 4 to 8) — the HR Requests and Approvals workspace.
 *
 * §29.17 makes write UI an acceptance criterion, so these tests exercise the
 * decision actions rather than only asserting a queue renders. They also cover
 * the unauthorized case, because "the tab is hidden" is a claim worth proving:
 * a 403 from the endpoint must hide the surface rather than show an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Requests from '@/pages/requests';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    dataRequests: [] as unknown[],
    dataError: null as unknown,
    serviceRequests: [] as unknown[],
    serviceError: null as unknown,
    detail: undefined as unknown,
    fields: [] as unknown[],
  },
  mutations: {
    create: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    ret: vi.fn(),
    reconfirm: vi.fn(),
    apply: vi.fn(),
    acknowledge: vi.fn(),
    approveService: vi.fn(),
    rejectService: vi.fn(),
    rejectServiceAsync: vi.fn(),
    fulfil: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListDataChangeRequests: () => ({
    data: state.dataRequests,
    isLoading: false,
    error: state.dataError,
    refetch: vi.fn(),
  }),
  getListDataChangeRequestsQueryKey: (o: number) => ['dcRequests', o],
  useGetDataChangeRequest: () => ({ data: state.detail, isLoading: false, error: null, refetch: vi.fn() }),
  getGetDataChangeRequestQueryKey: (o: number, r: number) => ['dcRequest', o, r],
  useListDataChangeFields: () => ({ data: state.fields, isLoading: false, error: null, refetch: vi.fn() }),
  getListDataChangeFieldsQueryKey: (o: number) => ['dcFields', o],
  useCreateDataChangeRequest: () => ({ mutate: mutations.create, isPending: false }),
  useDecideDataChangeRequest: () => ({ mutate: mutations.approve, isPending: false }),
  useRejectDataChangeRequest: () => ({ mutate: mutations.reject, isPending: false }),
  useReturnDataChangeRequest: () => ({ mutate: mutations.ret, isPending: false }),
  useReconfirmDataChangeRequest: () => ({ mutate: mutations.reconfirm, isPending: false }),
  useApplyDataChangeRequest: () => ({ mutate: mutations.apply, isPending: false }),
  useListServiceRequests: () => ({
    data: state.serviceRequests,
    isLoading: false,
    error: state.serviceError,
    refetch: vi.fn(),
  }),
  getListServiceRequestsQueryKey: (o: number, p?: unknown) => ['srRequests', o, p],
  useAcknowledgeServiceRequest: () => ({ mutate: mutations.acknowledge, isPending: false }),
  useApproveServiceRequest: () => ({ mutate: mutations.approveService, isPending: false }),
  useRejectServiceRequest: () => ({ mutate: mutations.rejectService, mutateAsync: mutations.rejectServiceAsync, isPending: false }),
  useFulfilServiceRequest: () => ({ mutate: mutations.fulfil, isPending: false }),
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/requests' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Requests />
      </Router>
    </QueryClientProvider>,
  );
}

const pendingDetail = {
  id: 7,
  employeeId: 42,
  origin: 'employee_self_service',
  status: 'pending',
  reason: 'Moved house',
  requestedAt: '2026-08-01T00:00:00.000Z',
  effectiveDate: null,
  currentStageOrder: null,
  stageCountAtRequest: 0,
  fields: [
    {
      fieldKey: 'phoneNumber',
      label: 'Phone number',
      sensitive: false,
      previousValue: '0200000000',
      requestedValue: '0244444444',
      staleDetectedAt: null,
    },
  ],
  events: [],
};

describe('Requests & Approvals (HR)', () => {
  beforeEach(() => {
    state.dataRequests = [
      { id: 7, employeeId: 42, origin: 'employee_self_service', status: 'pending', requestedAt: '2026-08-01T00:00:00.000Z' },
    ];
    state.dataError = null;
    state.serviceRequests = [];
    state.serviceError = null;
    state.detail = undefined;
    state.fields = [
      { fieldKey: 'phoneNumber', label: 'Phone number', kind: 'string', essEligible: true, hrEligible: true, sensitive: false, approvalRequired: false },
    ];
    Object.values(mutations).forEach((m) => m.mockClear());
  });

  it('shows the pending data-change queue', () => {
    renderPage();
    expect(screen.getByTestId('card-data-change-queue')).toBeInTheDocument();
    expect(screen.getByTestId('row-data-change-7')).toBeInTheDocument();
  });

  it('lets HR propose a change for another employee', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-hr-data-change-form'));
    await user.type(screen.getByTestId('input-hr-employee-id'), '42');
    await user.selectOptions(screen.getByTestId('select-hr-field'), 'phoneNumber');
    await user.type(screen.getByTestId('input-hr-value'), '0255555555');
    await user.click(screen.getByTestId('button-submit-hr-data-change'));

    await waitFor(() => expect(mutations.create).toHaveBeenCalledTimes(1));
    const payload = mutations.create.mock.calls[0]![0] as { employeeId: number; data: Record<string, unknown> };
    // The HR route carries the employee explicitly in the PATH — this is not a
    // self-service request, and origin is fixed by the route server-side.
    expect(payload.employeeId).toBe(42);
    expect(payload.data.fields).toEqual([{ fieldKey: 'phoneNumber', requestedValue: '0255555555' }]);
  });

  it('opens a request and offers approve, reject, return and apply', async () => {
    const user = userEvent.setup();
    state.detail = pendingDetail;
    renderPage();

    await user.click(screen.getByTestId('button-open-data-change-7'));
    expect(screen.getByTestId('card-data-change-detail')).toBeInTheDocument();
    expect(screen.getByTestId('row-detail-field-phoneNumber')).toBeInTheDocument();

    await user.click(screen.getByTestId('button-approve-data-change'));
    await waitFor(() => expect(mutations.approve).toHaveBeenCalledTimes(1));

    // Reject and return both require a reason, so they stay disabled until one
    // is typed — the same rule the server enforces.
    expect(screen.getByTestId('button-reject-data-change')).toBeDisabled();
    expect(screen.getByTestId('button-return-data-change')).toBeDisabled();
    await user.type(screen.getByTestId('input-decision-note'), 'Need proof of address');
    expect(screen.getByTestId('button-reject-data-change')).toBeEnabled();

    await user.click(screen.getByTestId('button-return-data-change'));
    await waitFor(() => expect(mutations.ret).toHaveBeenCalledTimes(1));
    expect((mutations.ret.mock.calls[0]![0] as { data: { reason: string } }).data.reason).toBe('Need proof of address');
  });

  it('only offers Apply once a request is approved', async () => {
    const user = userEvent.setup();
    state.detail = pendingDetail;
    renderPage();
    await user.click(screen.getByTestId('button-open-data-change-7'));
    // Pending: approved-only action is unavailable.
    expect(screen.getByTestId('button-apply-data-change')).toBeDisabled();

    state.detail = { ...pendingDetail, status: 'approved' };
    renderPage();
    const applyButtons = screen.getAllByTestId('button-apply-data-change');
    expect(applyButtons[applyButtons.length - 1]).toBeEnabled();
  });

  it('surfaces a stale request and offers re-confirmation instead of applying it', async () => {
    const user = userEvent.setup();
    state.detail = {
      ...pendingDetail,
      status: 'stale',
      fields: [{ ...pendingDetail.fields[0], staleDetectedAt: '2026-08-02T00:00:00.000Z' }],
    };
    renderPage();
    await user.click(screen.getByTestId('button-open-data-change-7'));

    expect(screen.getByText(/changed after this request was raised/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('button-reconfirm'));
    await waitFor(() => expect(mutations.reconfirm).toHaveBeenCalledTimes(1));
    // A stale request cannot be applied.
    expect(screen.getByTestId('button-apply-data-change')).toBeDisabled();
  });

  it('masks a sensitive value in the approval view', async () => {
    const user = userEvent.setup();
    state.detail = {
      ...pendingDetail,
      fields: [
        {
          fieldKey: 'nationalId',
          label: 'National ID',
          sensitive: true,
          previousValue: '*********4567',
          requestedValue: '*********7654',
          staleDetectedAt: null,
        },
      ],
    };
    renderPage();
    await user.click(screen.getByTestId('button-open-data-change-7'));
    expect(screen.getByText('masked')).toBeInTheDocument();
    // The server already masked it; the page shows what it was given.
    expect(screen.getByText('*********7654')).toBeInTheDocument();
  });

  it('records fulfilment with a document reference', async () => {
    const user = userEvent.setup();
    state.serviceRequests = [
      {
        id: 11,
        typeId: 5,
        employeeId: 42,
        subject: 'Employment letter',
        status: 'in_progress',
        approvalStatus: 'not_required',
        submittedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Service requests/i }));
    await user.click(await screen.findByTestId('button-open-fulfil-11'));
    await user.type(screen.getByTestId('input-fulfil-summary'), 'Letter issued');
    await user.type(screen.getByTestId('input-fulfil-document-id'), '77');
    await user.click(screen.getByTestId('button-submit-fulfil'));

    await waitFor(() => expect(mutations.fulfil).toHaveBeenCalledTimes(1));
    const payload = mutations.fulfil.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data.resolutionSummary).toBe('Letter issued');
    expect(payload.data.generatedDocumentId).toBe(77);
  });

  describe('rejecting a service request', () => {
    const pendingService = {
      id: 12,
      typeId: 5,
      employeeId: 42,
      subject: 'Salary confirmation letter',
      status: 'submitted',
      approvalStatus: 'pending',
      submittedAt: '2026-08-01T00:00:00.000Z',
    };

    async function openRejectDialog() {
      const user = userEvent.setup();
      state.serviceRequests = [pendingService];
      renderPage();
      await user.click(screen.getByRole('tab', { name: /Service requests/i }));
      await user.click(await screen.findByTestId('button-reject-service-12'));
      return user;
    }

    it('asks for confirmation instead of rejecting in one click, and Cancel rejects nothing', async () => {
      const user = await openRejectDialog();
      const dialog = screen.getByTestId('dialog-reject-service-request');
      expect(dialog).toHaveTextContent('Reject service request?');
      expect(dialog).toHaveTextContent('“Salary confirmation letter”');
      expect(dialog).toHaveTextContent('This cannot be undone.');
      expect(screen.getByTestId('dialog-reject-service-request-confirm')).toHaveTextContent('Reject Request');
      expect(mutations.rejectService).not.toHaveBeenCalled();
      expect(mutations.rejectServiceAsync).not.toHaveBeenCalled();

      await user.click(screen.getByTestId('dialog-reject-service-request-cancel'));
      await waitFor(() => expect(screen.queryByTestId('dialog-reject-service-request')).toBeNull());
      expect(mutations.rejectServiceAsync).not.toHaveBeenCalled();
      expect(mutations.rejectService).not.toHaveBeenCalled();
    });

    it('rejects exactly once on confirm with the same payload as before, then closes', async () => {
      mutations.rejectServiceAsync.mockResolvedValueOnce({});
      const user = await openRejectDialog();
      await user.click(screen.getByTestId('dialog-reject-service-request-confirm'));
      await waitFor(() => expect(screen.queryByTestId('dialog-reject-service-request')).toBeNull());
      expect(mutations.rejectServiceAsync).toHaveBeenCalledTimes(1);
      expect(mutations.rejectServiceAsync).toHaveBeenCalledWith({ organizationId: 10, requestId: 12, data: { reason: 'Not approved' } });
    });

    it('keeps the dialog open and the request listed when the server refuses', async () => {
      mutations.rejectServiceAsync.mockRejectedValueOnce(new Error('This request is not awaiting approval.'));
      const user = await openRejectDialog();
      await user.click(screen.getByTestId('dialog-reject-service-request-confirm'));
      await waitFor(() => expect(mutations.rejectServiceAsync).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('dialog-reject-service-request-confirm')).toBeEnabled());
      expect(screen.getByTestId('dialog-reject-service-request')).toBeInTheDocument();
      expect(screen.getByTestId('row-service-request-12')).toBeInTheDocument();
    });

    it('offers no Reject button once a request is no longer awaiting approval', async () => {
      const user = userEvent.setup();
      state.serviceRequests = [{ ...pendingService, approvalStatus: 'rejected', status: 'closed' }];
      renderPage();
      await user.click(screen.getByRole('tab', { name: /Service requests/i }));
      expect(await screen.findByTestId('row-service-request-12')).toBeInTheDocument();
      expect(screen.queryByTestId('button-reject-service-12')).toBeNull();
    });
  });

  it('hides the data-change surface entirely from a caller the server refuses', async () => {
    const user = userEvent.setup();
    state.dataError = { status: 403 };
    state.serviceRequests = [];
    renderPage();
    // A 403 hides the tab rather than showing an error: "you may not see this"
    // is not a fault the user can act on.
    expect(screen.queryByTestId('card-data-change-queue')).toBeNull();
    expect(screen.queryByTestId('button-open-hr-data-change-form')).toBeNull();
    expect(screen.queryByRole('tab', { name: /Data changes/i })).toBeNull();
    // The service tab is still available, and is the only one.
    const serviceTab = screen.getByRole('tab', { name: /Service requests/i });
    await user.click(serviceTab);
    expect(await screen.findByTestId('card-service-request-queue')).toBeInTheDocument();
  });

  it('shows nothing at all when the server refuses both surfaces', () => {
    state.dataError = { status: 403 };
    state.serviceError = { status: 403 };
    renderPage();
    expect(screen.getByText(/do not have access to requests/i)).toBeInTheDocument();
    expect(screen.queryByTestId('card-data-change-queue')).toBeNull();
    expect(screen.queryByTestId('card-service-request-queue')).toBeNull();
  });

  it('does not aggregate other modules — this is not the HR Action Centre', () => {
    renderPage();
    // §29.17 forbids pulling Leave, Recruitment, Onboarding, Employee Relations
    // or Payroll approvals into this workspace; WS-15 owns that surface. The
    // tab list is the whole surface, so it is the thing to assert on.
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent ?? '');
    expect(tabs).toEqual(['Data changes', 'Service requests']);
    for (const foreign of ['Leave approvals', 'Recruitment approvals', 'Onboarding', 'Grievances', 'Payroll']) {
      expect(screen.queryByRole('tab', { name: foreign })).toBeNull();
    }
  });
});
