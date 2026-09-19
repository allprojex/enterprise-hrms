/**
 * VR-01 — the vehicle register page. Covers what the page itself decides:
 * which controls a caller sees (vehicle.read versus vehicle.manage), that the
 * register never offers "in use" as a settable status, and that taking a
 * vehicle out of service goes through the shared confirmation dialog. The
 * server re-checks every one of these; hiding a control is not authorization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Vehicles from '@/pages/vehicles';

const { state, createMutateMock, updateMutateMock, updateMutateAsyncMock } = vi.hoisted(() => ({
  state: {
    permissions: new Set<string>(),
    vehicles: [] as Record<string, unknown>[],
  },
  createMutateMock: vi.fn(),
  updateMutateMock: vi.fn(),
  updateMutateAsyncMock: vi.fn(),
}));

const me = {
  id: 1,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'employee',
  activeOrganizationId: 10,
  organizationId: 10,
};

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: me, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListVehicles: () => ({ data: state.vehicles, isLoading: false, error: null, refetch: vi.fn() }),
  getListVehiclesQueryKey: () => ['vehicles'],
  useCreateVehicle: () => ({ mutate: createMutateMock, isPending: false }),
  useUpdateVehicle: () => ({ mutate: updateMutateMock, mutateAsync: updateMutateAsyncMock, isPending: false }),
}));

vi.mock('@/hooks/use-capabilities', () => ({
  useCapabilities: () => ({
    permissions: state.permissions,
    can: (key: string) => state.permissions.has(key),
    canAny: (...keys: string[]) => keys.some((k) => state.permissions.has(k)),
    isDepartmentHead: false,
    hasDirectReports: false,
    isManager: false,
    isHrOperational: false,
    isOrgAdministrator: false,
    isLoading: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Vehicles />
    </QueryClientProvider>,
  );
}

const VEHICLES = [
  { id: 1, organizationId: 10, registrationNumber: 'GR 1234-20', make: 'Toyota', model: 'Hiace', status: 'available', notes: null },
  { id: 3, organizationId: 10, registrationNumber: 'GW 9999-22', make: 'Toyota', model: 'Corolla', status: 'in_use', notes: null },
];

beforeEach(() => {
  createMutateMock.mockReset();
  updateMutateMock.mockReset();
  updateMutateAsyncMock.mockReset();
  updateMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
    return Promise.resolve(undefined);
  });
  state.permissions = new Set(['vehicle.read']);
  state.vehicles = [...VEHICLES];
});

describe('Vehicle register — what each caller may do', () => {
  it('shows the register to vehicle.read without any administration controls', () => {
    renderPage();
    expect(screen.getByText('GR 1234-20')).toBeInTheDocument();
    expect(screen.queryByTestId('button-add-vehicle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-vehicle-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-toggle-vehicle-status-1')).not.toBeInTheDocument();
  });

  it('shows administration controls to vehicle.manage', () => {
    state.permissions = new Set(['vehicle.read', 'vehicle.manage']);
    renderPage();
    expect(screen.getByTestId('button-add-vehicle')).toBeInTheDocument();
    expect(screen.getByTestId('button-edit-vehicle-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-toggle-vehicle-status-1')).toBeInTheDocument();
  });

  it('shows an empty state when the organization has no vehicles yet', () => {
    state.vehicles = [];
    renderPage();
    expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
  });
});

describe('Vehicle register — status rules', () => {
  beforeEach(() => {
    state.permissions = new Set(['vehicle.read', 'vehicle.manage']);
  });

  it('never offers a way to set a vehicle in use from the register', () => {
    renderPage();
    const controls = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(controls.some((t) => /in use/i.test(t))).toBe(false);
  });

  it('disables taking a vehicle out of service while it is out', () => {
    renderPage();
    expect(screen.getByTestId('button-toggle-vehicle-status-3')).toBeDisabled();
    expect(screen.getByTestId('badge-vehicle-status-3')).toHaveTextContent('In use');
  });

  it('confirms before taking a vehicle out of service, and sends the status once', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-toggle-vehicle-status-1'));
    expect(screen.getByText('Take vehicle out of service?')).toBeInTheDocument();
    expect(updateMutateAsyncMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-vehicle-status-confirm'));
    await waitFor(() => expect(updateMutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(updateMutateAsyncMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 1, data: { status: 'inactive' } },
      expect.anything(),
    );
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-toggle-vehicle-status-1'));
    await user.click(screen.getByTestId('dialog-vehicle-status-cancel'));
    expect(updateMutateAsyncMock).not.toHaveBeenCalled();
  });
});

describe('Vehicle register — adding a vehicle', () => {
  beforeEach(() => {
    state.permissions = new Set(['vehicle.read', 'vehicle.manage']);
  });

  it('submits the entered registration details', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'gr 4321-23');
    await user.type(screen.getByTestId('input-vehicle-make'), 'Ford');
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, data: { registrationNumber: 'gr 4321-23', make: 'Ford', model: null, notes: null } },
      expect.anything(),
    );
  });
});
