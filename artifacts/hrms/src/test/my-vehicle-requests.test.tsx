/**
 * VR-02B — the Employee Self-Service vehicle request page.
 *
 * Covers what the page itself decides: which request types it offers for each
 * permission combination, that it explains every reason submission is
 * impossible, that it validates before sending, that it sends no identity and
 * sends absolute UTC instants, and that it shows the generated reference. The
 * API re-checks every one of these; hiding a control here protects nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyVehicleRequests from '@/pages/my-vehicle-requests';

const { state, submitMutateMock } = vi.hoisted(() => ({
  state: {
    context: null as Record<string, unknown> | null,
    contextError: null as unknown,
    requests: [] as Record<string, unknown>[],
    vehicles: [] as Record<string, unknown>[] | undefined,
    vehiclesLoading: false,
    vehiclesError: null as unknown,
    vehiclesEnabled: undefined as boolean | undefined,
    onSuccess: undefined as ((created: Record<string, unknown>) => void) | undefined,
  },
  submitMutateMock: vi.fn(),
}));

const me = { id: 1, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'employee', activeOrganizationId: 10, organizationId: 10 };

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: me, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useGetMyVehicleRequestContext: () => ({ data: state.context ?? undefined, isLoading: false, error: state.contextError, refetch: vi.fn() }),
  getGetMyVehicleRequestContextQueryKey: () => ['vr-context'],
  useListMyVehicleRequests: () => ({ data: state.requests, isLoading: false, error: null, refetch: vi.fn() }),
  getListMyVehicleRequestsQueryKey: () => ['my-vehicle-requests'],
  useListRequestableVehicles: (_org: number, opts: { query?: { enabled?: boolean } }) => {
    state.vehiclesEnabled = opts?.query?.enabled;
    return { data: state.vehicles, isLoading: state.vehiclesLoading, error: state.vehiclesError };
  },
  getListRequestableVehiclesQueryKey: () => ['requestable-vehicles'],
  useSubmitMyVehicleRequest: (opts: { mutation?: { onSuccess?: (c: Record<string, unknown>) => void } }) => {
    state.onSuccess = opts?.mutation?.onSuccess;
    return { mutate: submitMutateMock, isPending: false };
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyVehicleRequests />
    </QueryClientProvider>,
  );
}

const ctx = (overrides: Record<string, unknown> = {}) => ({
  canSubmitEmployeeRequest: true,
  canSubmitDepartmentRequest: false,
  department: { id: 3, name: 'Finance' },
  approvalWorkflowConfigured: true,
  blockedReason: null,
  ...overrides,
});

const VEHICLES = [
  { id: 11, registrationNumber: 'GR 1234-26', make: 'Toyota', model: 'Hilux', description: null },
  { id: 12, registrationNumber: 'GT 55-20', make: null, model: null, description: 'Blue minibus' },
];

beforeEach(() => {
  submitMutateMock.mockReset();
  state.context = ctx();
  state.contextError = null;
  state.requests = [];
  state.vehicles = [...VEHICLES];
  state.vehiclesLoading = false;
  state.vehiclesError = null;
  state.vehiclesEnabled = undefined;
});

async function openForm() {
  renderPage();
  await userEvent.click(screen.getByTestId('button-open-vehicle-request-form'));
}

function fillValid() {
  fireEvent.change(screen.getByTestId('select-vehicle-request-vehicle'), { target: { value: '11' } });
  fireEvent.change(screen.getByTestId('input-vehicle-request-purpose'), { target: { value: 'Field visit' } });
  fireEvent.change(screen.getByTestId('input-vehicle-request-time-out'), { target: { value: '2099-03-01T09:00' } });
  fireEvent.change(screen.getByTestId('input-vehicle-request-time-in'), { target: { value: '2099-03-01T13:30' } });
}

describe('who may submit', () => {
  it('without either grant: no form, a plain explanation, and no vehicle list is fetched', () => {
    state.context = ctx({ canSubmitEmployeeRequest: false, canSubmitDepartmentRequest: false, blockedReason: 'x' });
    renderPage();
    expect(screen.getByTestId('card-not-authorized')).toHaveTextContent(/not been authorized/i);
    expect(screen.queryByTestId('button-open-vehicle-request-form')).not.toBeInTheDocument();
    expect(state.vehiclesEnabled).toBe(false);
  });

  it('write.own only: the request is for yourself, with nothing to choose', async () => {
    await openForm();
    expect(screen.getByTestId('text-vehicle-request-type')).toHaveTextContent('for yourself');
    expect(screen.queryByTestId('select-vehicle-request-type')).not.toBeInTheDocument();
  });

  it('write.department only: the request is for your department', async () => {
    state.context = ctx({ canSubmitEmployeeRequest: false, canSubmitDepartmentRequest: true });
    await openForm();
    expect(screen.getByTestId('text-vehicle-request-type')).toHaveTextContent('for your department (Finance)');
  });

  it('both grants: the requester chooses', async () => {
    state.context = ctx({ canSubmitDepartmentRequest: true });
    await openForm();
    const select = screen.getByTestId('select-vehicle-request-type');
    expect(select).toHaveTextContent('Myself');
    expect(select).toHaveTextContent('My department (Finance)');
  });
});

describe('explains why submission is impossible', () => {
  it.each([
    ['no department', 'You are not assigned to a department. HR/Administration must assign you to a department before a vehicle request can be submitted.'],
    ['no approval workflow', 'Vehicle Request approval workflow has not been configured. Please contact your administrator.'],
  ])('%s', (_label, reason) => {
    state.context = ctx({ blockedReason: reason });
    renderPage();
    expect(screen.getByTestId('card-submission-blocked')).toHaveTextContent(reason);
    expect(screen.queryByTestId('button-open-vehicle-request-form')).not.toBeInTheDocument();
  });

  it('distinguishes no available vehicles from a failed vehicle list', async () => {
    state.vehicles = [];
    const { unmount } = renderPage();
    await userEvent.click(screen.getByTestId('button-open-vehicle-request-form'));
    expect(screen.getByTestId('text-vehicles-empty')).toBeInTheDocument();
    unmount();
    state.vehicles = undefined;
    state.vehiclesError = { status: 500 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-open-vehicle-request-form'));
    expect(screen.getByTestId('text-vehicles-error')).toBeInTheDocument();
    expect(screen.queryByTestId('text-vehicles-empty')).not.toBeInTheDocument();
  });
});

describe('the form', () => {
  it('shows vehicles by registration and make/model or description', async () => {
    await openForm();
    const select = screen.getByTestId('select-vehicle-request-vehicle');
    expect(select).toHaveTextContent('GR 1234-26 — Toyota Hilux');
    expect(select).toHaveTextContent('GT 55-20 — Blue minibus');
  });

  it('keeps submit disabled until purpose, vehicle and both times are valid', async () => {
    await openForm();
    const submit = screen.getByTestId('button-submit-vehicle-request');
    expect(submit).toBeDisabled();
    fillValid();
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByTestId('input-vehicle-request-purpose'), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('text-vehicle-request-validation')).toHaveTextContent('Purpose is required');
  });

  it('refuses Expected Time In that is not after Planned Time Out', async () => {
    await openForm();
    fillValid();
    fireEvent.change(screen.getByTestId('input-vehicle-request-time-in'), { target: { value: '2099-03-01T09:00' } });
    expect(screen.getByTestId('button-submit-vehicle-request')).toBeDisabled();
    expect(screen.getByTestId('text-vehicle-request-validation')).toHaveTextContent('Expected Time In must be later than Planned Time Out');
  });

  it('refuses a Planned Time Out in the past', async () => {
    await openForm();
    fillValid();
    fireEvent.change(screen.getByTestId('input-vehicle-request-time-out'), { target: { value: '2000-01-01T09:00' } });
    expect(screen.getByTestId('button-submit-vehicle-request')).toBeDisabled();
    expect(screen.getByTestId('text-vehicle-request-validation')).toHaveTextContent('Planned Time Out cannot be in the past');
  });

  it('sends no identity, and sends both times as absolute UTC instants', async () => {
    await openForm();
    fillValid();
    await userEvent.click(screen.getByTestId('button-submit-vehicle-request'));
    expect(submitMutateMock).toHaveBeenCalledTimes(1);
    const { organizationId, data } = submitMutateMock.mock.calls[0]![0] as { organizationId: number; data: Record<string, unknown> };
    expect(organizationId).toBe(10);
    expect(Object.keys(data).sort()).toEqual(['destination', 'plannedTimeIn', 'plannedTimeOut', 'purpose', 'requestType', 'vehicleId']);
    expect(data.requestType).toBe('employee');
    expect(data.vehicleId).toBe(11);
    expect(data.plannedTimeOut).toBe(new Date('2099-03-01T09:00').toISOString());
    expect(data.plannedTimeIn).toBe(new Date('2099-03-01T13:30').toISOString());
    expect(String(data.plannedTimeOut)).toMatch(/Z$/);
  });

  it('shows the generated reference and status after submitting', async () => {
    await openForm();
    fillValid();
    await userEvent.click(screen.getByTestId('button-submit-vehicle-request'));
    const { act } = await import('@testing-library/react');
    act(() => state.onSuccess?.({ requestReference: 'VR-00001', status: 'pending' }));
    expect(screen.getByTestId('text-last-submitted-reference')).toHaveTextContent('VR-00001');
    expect(screen.getByTestId('card-last-submitted')).toHaveTextContent('Awaiting approval');
  });
});

describe('my requests', () => {
  it('lists what I submitted, including department requests, with reference and status', () => {
    state.requests = [
      {
        id: 1, requestReference: 'VR-00002', requestType: 'department', status: 'pending', requesterEmployeeId: null,
        requestingDepartmentId: 3, requestingDepartmentName: 'Finance', vehicleId: 11, vehicleRegistrationNumber: 'GR 1234-26',
        vehicleMake: 'Toyota', vehicleModel: 'Hilux', purpose: 'Team outreach', destination: 'Tema',
        plannedTimeOut: '2099-03-01T09:00:00.000Z', plannedTimeIn: '2099-03-01T13:00:00.000Z', totalStages: 2, currentStageOrder: 1,
        submittedAt: '2099-02-01T09:00:00.000Z',
      },
    ];
    renderPage();
    const card = screen.getByTestId('card-my-vehicle-request-1');
    expect(card).toHaveTextContent('VR-00002');
    expect(card).toHaveTextContent('For Finance');
    expect(card).toHaveTextContent('Awaiting approval');
    expect(card).toHaveTextContent('Destination: Tema');
  });

  it('still shows my history when I can no longer submit', () => {
    state.context = ctx({ canSubmitEmployeeRequest: false, canSubmitDepartmentRequest: false, blockedReason: 'x' });
    state.requests = [
      {
        id: 7, requestReference: 'VR-00009', requestType: 'employee', status: 'approved', requesterEmployeeId: 4,
        requestingDepartmentId: 3, requestingDepartmentName: 'Finance', vehicleId: 11, vehicleRegistrationNumber: 'GR 1234-26',
        vehicleMake: null, vehicleModel: null, purpose: 'Bank run', destination: null,
        plannedTimeOut: '2099-03-01T09:00:00.000Z', plannedTimeIn: '2099-03-01T13:00:00.000Z', totalStages: 1, currentStageOrder: 1,
        submittedAt: '2099-02-01T09:00:00.000Z',
      },
    ];
    renderPage();
    expect(screen.getByTestId('card-my-vehicle-request-7')).toHaveTextContent('VR-00009');
  });

  it('says so when there are none', () => {
    renderPage();
    expect(screen.getByTestId('text-no-vehicle-requests')).toBeInTheDocument();
  });
});
