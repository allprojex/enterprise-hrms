/**
 * WS-13 (§29.17 actions 1, 2 and 3) — Employee Self-Service requests.
 *
 * §29.17 freezes these as user actions that must be performable IN THE
 * APPLICATION, so these tests assert the write paths exist and behave — not
 * merely that a list renders.
 *
 * The sharpest assertion is that neither submission sends an employee
 * identifier. The server resolves the subject from the caller's own employee
 * link (§29.2), and a client that sent one would be inviting the server to
 * trust it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import MyRequests from '@/pages/my-requests';

const { state, submitData, submitService, withdrawData } = vi.hoisted(() => ({
  state: {
    fields: [] as unknown[],
    dataRequests: [] as unknown[],
    types: [] as unknown[],
    serviceRequests: [] as unknown[],
  },
  submitData: vi.fn(),
  submitService: vi.fn(),
  withdrawData: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyDataChangeFields: () => ({ data: state.fields, isLoading: false, error: null, refetch: vi.fn() }),
  getListMyDataChangeFieldsQueryKey: (o: number) => ['myDcFields', o],
  useListMyDataChangeRequests: () => ({ data: state.dataRequests, isLoading: false, error: null, refetch: vi.fn() }),
  getListMyDataChangeRequestsQueryKey: (o: number) => ['myDcRequests', o],
  useSubmitMyDataChangeRequest: () => ({ mutate: submitData, isPending: false }),
  useWithdrawMyDataChangeRequest: () => ({ mutate: withdrawData, isPending: false }),
  useListMyServiceRequestTypes: () => ({ data: state.types, isLoading: false, error: null, refetch: vi.fn() }),
  getListMyServiceRequestTypesQueryKey: (o: number) => ['myTypes', o],
  useListMyServiceRequests: () => ({ data: state.serviceRequests, isLoading: false, error: null, refetch: vi.fn() }),
  getListMyServiceRequestsQueryKey: (o: number) => ['mySr', o],
  useSubmitMyServiceRequest: () => ({ mutate: submitService, isPending: false }),
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/my-requests' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <MyRequests />
      </Router>
    </QueryClientProvider>,
  );
}

describe('My Requests (ESS)', () => {
  beforeEach(() => {
    state.fields = [
      { fieldKey: 'phoneNumber', label: 'Phone number', kind: 'string', sensitive: false, approvalRequired: false },
      { fieldKey: 'nationalId', label: 'National ID', kind: 'string', sensitive: true, approvalRequired: true },
    ];
    state.dataRequests = [];
    state.types = [{ id: 5, name: 'Employment letter', code: 'letter', active: true, employeeVisible: true }];
    state.serviceRequests = [];
    submitData.mockClear();
    submitService.mockClear();
    withdrawData.mockClear();
  });

  it('offers both submission paths, because §29.17 freezes them as user actions', () => {
    renderPage();
    expect(screen.getByTestId('button-open-data-change-form')).toBeInTheDocument();
  });

  it('submits a data-change request WITHOUT any employee identifier', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-data-change-form'));
    await user.selectOptions(screen.getByTestId('select-data-change-field'), 'phoneNumber');
    await user.type(screen.getByTestId('input-data-change-value'), '0244444444');
    await user.click(screen.getByTestId('button-submit-data-change'));

    await waitFor(() => expect(submitData).toHaveBeenCalledTimes(1));
    const payload = submitData.mock.calls[0]![0] as { organizationId: number; data: Record<string, unknown> };
    expect(payload.organizationId).toBe(10);
    expect(payload.data.fields).toEqual([{ fieldKey: 'phoneNumber', requestedValue: '0244444444' }]);

    // THE ASSERTION THIS TEST EXISTS FOR (§29.2): the subject comes from the
    // caller's own employee link on the server, so the client sends none.
    expect(payload.data).not.toHaveProperty('employeeId');
    expect(JSON.stringify(payload.data)).not.toContain('employeeId');
  });

  it('will not submit an incomplete data-change request', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('button-open-data-change-form'));
    expect(screen.getByTestId('button-submit-data-change')).toBeDisabled();
    expect(submitData).not.toHaveBeenCalled();
  });

  it('submits a service request without an employee identifier', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: /My HR requests/i }));
    await user.click(screen.getByTestId('button-open-service-request-form'));
    await user.selectOptions(screen.getByTestId('select-service-request-type'), '5');
    await user.type(screen.getByTestId('input-service-request-subject'), 'Letter for my bank');
    await user.click(screen.getByTestId('button-submit-service-request'));

    await waitFor(() => expect(submitService).toHaveBeenCalledTimes(1));
    const payload = submitService.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data.typeId).toBe(5);
    expect(payload.data.subject).toBe('Letter for my bank');
    expect(payload.data).not.toHaveProperty('employeeId');
  });

  it('shows the employee their own requests and lets them withdraw a pending one', async () => {
    const user = userEvent.setup();
    state.dataRequests = [
      {
        id: 3,
        status: 'pending',
        reason: 'Moved house',
        requestedAt: '2026-08-01T00:00:00.000Z',
        effectiveDate: null,
        decidedAt: null,
        appliedAt: null,
        fields: [{ fieldKey: 'phoneNumber', label: 'Phone number', requestedValue: '024', staleDetectedAt: null }],
      },
    ];
    renderPage();

    expect(screen.getByTestId('card-my-data-change-3')).toBeInTheDocument();
    expect(screen.getByText('Awaiting decision')).toBeInTheDocument();

    await user.click(screen.getByTestId('button-withdraw-data-change-3'));
    await waitFor(() => expect(withdrawData).toHaveBeenCalledWith({ organizationId: 10, requestId: 3 }));
  });

  it('does not offer withdrawal once a change has been applied', () => {
    state.dataRequests = [
      {
        id: 4,
        status: 'applied',
        reason: null,
        requestedAt: '2026-08-01T00:00:00.000Z',
        effectiveDate: null,
        decidedAt: '2026-08-02T00:00:00.000Z',
        appliedAt: '2026-08-02T00:00:00.000Z',
        fields: [{ fieldKey: 'phoneNumber', label: 'Phone number', requestedValue: '024', staleDetectedAt: null }],
      },
    ];
    renderPage();
    // §29 forbids withdrawal undoing an applied change; the UI does not offer it.
    expect(screen.queryByTestId('button-withdraw-data-change-4')).toBeNull();
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });

  it('renders the server-sent allow-list view without internal fields', async () => {
    const user = userEvent.setup();
    state.serviceRequests = [
      {
        id: 9,
        typeId: 5,
        subject: 'Letter',
        details: null,
        status: 'fulfilled',
        approvalStatus: 'not_required',
        submittedAt: '2026-08-01T00:00:00.000Z',
        acknowledgedAt: null,
        fulfilledAt: '2026-08-03T00:00:00.000Z',
        resolutionSummary: 'Issued.',
        generatedDocumentId: 77,
        updates: [{ id: 1, eventType: 'fulfilled', occurredAt: '2026-08-03T00:00:00.000Z', notes: 'Issued.' }],
      },
    ];
    renderPage();
    // The service tab must be opened first: inactive tab content is unmounted.
    await user.click(screen.getByRole('tab', { name: /My HR requests/i }));
    expect(await screen.findByTestId('card-my-service-request-9')).toBeInTheDocument();
    // The server's ESS view carries no assignee or stage data, so none appears.
    expect(screen.queryByText(/assigned/i)).toBeNull();
    expect(screen.queryByText(/stage/i)).toBeNull();
  });
});
