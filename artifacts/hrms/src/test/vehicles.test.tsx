/**
 * VR-01 — the vehicle register page. Covers what the page itself decides:
 * which controls a caller sees (asset_management.manage or nothing), that the
 * register offers only its three administrative statuses, and that taking a
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
    assets: [] as Record<string, unknown>[],
    employees: [] as Record<string, unknown>[],
    branches: [] as Record<string, unknown>[],
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
  useListAssets: () => ({ data: { items: state.assets }, isLoading: false }),
  getListAssetsQueryKey: () => ['assets'],
  useListEmployees: () => ({ data: { items: state.employees }, isLoading: false }),
  getListEmployeesQueryKey: () => ['employees'],
  useListBranches: () => ({ data: state.branches, isLoading: false }),
  getListBranchesQueryKey: () => ['branches'],
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
  {
    id: 1,
    organizationId: 10,
    registrationNumber: 'GR 1234-20',
    make: 'Toyota',
    model: 'Hiace',
    status: 'available',
    notes: null,
    defaultDriverEmployeeId: null,
    branchId: null,
  },
  {
    id: 3,
    organizationId: 10,
    registrationNumber: 'GW 9999-22',
    make: 'Toyota',
    model: 'Corolla',
    status: 'maintenance',
    notes: null,
    assetId: 77,
    defaultDriverEmployeeId: 200,
    branchId: 5,
  },
];

const EMPLOYEES = [
  { id: 200, organizationId: 10, firstName: 'Amara', lastName: 'Owusu', employeeNumber: 'EMP-200' },
  { id: 201, organizationId: 10, firstName: 'Kwesi', lastName: 'Mensah', employeeNumber: null },
];

const BRANCHES = [
  { id: 5, organizationId: 10, name: 'Head Office', code: 'HO', status: 'active' },
  { id: 6, organizationId: 10, name: 'Kumasi Branch', code: 'KSI', status: 'active' },
];

beforeEach(() => {
  createMutateMock.mockReset();
  updateMutateMock.mockReset();
  updateMutateAsyncMock.mockReset();
  updateMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
    return Promise.resolve(undefined);
  });
  state.permissions = new Set(['asset_management.read.own']);
  state.vehicles = [...VEHICLES];
  state.assets = [
    { id: 77, assetTag: 'AST-77', name: 'Hiace bus' },
    { id: 78, assetTag: 'AST-78', name: 'Generator' },
  ];
  state.employees = EMPLOYEES.map((e) => ({ ...e }));
  state.branches = BRANCHES.map((b) => ({ ...b }));
});

describe('Vehicle register — what each caller may do', () => {
  it('shows no administration controls without asset_management.manage', () => {
    renderPage();
    expect(screen.getByText('GR 1234-20')).toBeInTheDocument();
    expect(screen.queryByTestId('button-add-vehicle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-vehicle-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-toggle-vehicle-status-1')).not.toBeInTheDocument();
  });

  it('shows administration controls to asset_management.manage', () => {
    state.permissions = new Set(['asset_management.manage']);
    renderPage();
    expect(screen.getByTestId('button-add-vehicle')).toBeInTheDocument();
    expect(screen.getByTestId('button-edit-vehicle-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-toggle-vehicle-status-1')).toBeInTheDocument();
  });

  it('shows the linked asset, and a dash where there is none', () => {
    renderPage();
    expect(screen.getByTestId('cell-vehicle-asset-3')).toHaveTextContent('AST-77 · Hiace bus');
    expect(screen.getByTestId('cell-vehicle-asset-1')).toHaveTextContent('—');
  });

  it('shows an empty state when the organization has no vehicles yet', () => {
    state.vehicles = [];
    renderPage();
    expect(screen.getByText('No vehicles yet')).toBeInTheDocument();
  });
});

describe('Vehicle register — status rules', () => {
  beforeEach(() => {
    state.permissions = new Set(['asset_management.manage']);
  });

  it('never offers a way to put a vehicle in use from the register', () => {
    renderPage();
    const controls = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(controls.some((t) => /in use/i.test(t))).toBe(false);
  });

  it('leaves the out-of-service action available for every administrative status', () => {
    renderPage();
    expect(screen.getByTestId('badge-vehicle-status-3')).toHaveTextContent('Maintenance');
    expect(screen.getByTestId('button-toggle-vehicle-status-3')).toBeEnabled();
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
    state.permissions = new Set(['asset_management.manage']);
  });

  it('submits the entered registration details', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'gr 4321-23');
    await user.type(screen.getByTestId('input-vehicle-make'), 'Ford');
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      {
        organizationId: 10,
        data: {
          registrationNumber: 'gr 4321-23',
          make: 'Ford',
          model: null,
          description: null,
          notes: null,
          assetId: null,
          defaultDriverEmployeeId: null,
          branchId: null,
        },
      },
      expect.anything(),
    );
  });

  it('exposes every authorized register field when adding', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    for (const testId of [
      'input-vehicle-registration',
      'input-vehicle-make',
      'input-vehicle-model',
      'input-vehicle-description',
      'select-vehicle-driver',
      'select-vehicle-branch',
      'select-vehicle-asset',
      'select-vehicle-status',
      'input-vehicle-notes',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('submits the entered description', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'GR 4321-23');
    await user.type(screen.getByTestId('input-vehicle-description'), '15-seater staff bus');
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, data: expect.objectContaining({ description: '15-seater staff bus' }) },
      expect.anything(),
    );
  });

  it('starts a new vehicle available, and does not offer to create it in another status', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    expect(screen.getByTestId('select-vehicle-status')).toHaveTextContent('Available');
    // The create endpoint takes no status, so the control must not invite a
    // choice the server would silently discard.
    expect(screen.getByTestId('select-vehicle-status')).toBeDisabled();
  });

  it('sends the chosen default driver', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'GR 4321-23');
    await user.click(screen.getByTestId('select-vehicle-driver'));
    await user.click(screen.getByRole('option', { name: 'Amara Owusu · EMP-200' }));
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, data: expect.objectContaining({ defaultDriverEmployeeId: 200 }) },
      expect.anything(),
    );
  });

  it('sends the chosen branch', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'GR 4321-23');
    await user.click(screen.getByTestId('select-vehicle-branch'));
    await user.click(screen.getByRole('option', { name: 'Kumasi Branch' }));
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, data: expect.objectContaining({ branchId: 6 }) },
      expect.anything(),
    );
  });

  it('leaves both optional references unset when nothing is chosen', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));
    await user.type(screen.getByTestId('input-vehicle-registration'), 'GR 4321-23');
    await user.click(screen.getByTestId('button-submit-vehicle'));

    expect(createMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, data: expect.objectContaining({ defaultDriverEmployeeId: null, branchId: null }) },
      expect.anything(),
    );
  });
});

describe('Vehicle register — the default driver and branch of an existing vehicle', () => {
  beforeEach(() => {
    state.permissions = new Set(['asset_management.manage']);
  });

  it('opens the edit dialog already showing the vehicle’s driver and branch', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    expect(screen.getByTestId('select-edit-vehicle-driver')).toHaveTextContent('Amara Owusu · EMP-200');
    expect(screen.getByTestId('select-edit-vehicle-branch')).toHaveTextContent('Head Office');
  });

  it('sends the replacement driver and branch', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    await user.click(screen.getByTestId('select-edit-vehicle-driver'));
    await user.click(screen.getByRole('option', { name: 'Kwesi Mensah' }));
    await user.click(screen.getByTestId('select-edit-vehicle-branch'));
    await user.click(screen.getByRole('option', { name: 'Kumasi Branch' }));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));

    expect(updateMutateMock).toHaveBeenCalledWith(
      {
        organizationId: 10,
        vehicleId: 3,
        data: expect.objectContaining({ defaultDriverEmployeeId: 201, branchId: 6 }),
      },
      expect.anything(),
    );
  });

  it('clears both back to nothing', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    await user.click(screen.getByTestId('select-edit-vehicle-driver'));
    await user.click(screen.getByRole('option', { name: 'No default driver' }));
    await user.click(screen.getByTestId('select-edit-vehicle-branch'));
    await user.click(screen.getByRole('option', { name: 'No branch' }));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));

    expect(updateMutateMock).toHaveBeenCalledWith(
      {
        organizationId: 10,
        vehicleId: 3,
        data: expect.objectContaining({ defaultDriverEmployeeId: null, branchId: null }),
      },
      expect.anything(),
    );
  });
});

describe('Vehicle register — editing description, asset and status', () => {
  beforeEach(() => {
    state.permissions = new Set(['asset_management.manage']);
    state.vehicles = [{ ...VEHICLES[1], description: 'Staff shuttle' }];
  });

  it('exposes every authorized register field when editing', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    for (const testId of [
      'input-edit-vehicle-registration',
      'input-edit-vehicle-make',
      'input-edit-vehicle-model',
      'input-edit-vehicle-description',
      'select-edit-vehicle-driver',
      'select-edit-vehicle-branch',
      'select-edit-vehicle-asset',
      'select-edit-vehicle-status',
      'input-edit-vehicle-notes',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
  });

  it('pre-populates the description, and can change and clear it', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    const description = screen.getByTestId('input-edit-vehicle-description');
    expect(description).toHaveValue('Staff shuttle');

    await user.clear(description);
    await user.type(description, 'Long-haul bus');
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));
    expect(updateMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 3, data: expect.objectContaining({ description: 'Long-haul bus' }) },
      expect.anything(),
    );

    updateMutateMock.mockReset();
    await user.clear(screen.getByTestId('input-edit-vehicle-description'));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));
    expect(updateMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 3, data: expect.objectContaining({ description: null }) },
      expect.anything(),
    );
  });

  it('pre-populates the linked asset, and can change it', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    expect(screen.getByTestId('select-edit-vehicle-asset')).toHaveTextContent('AST-77 · Hiace bus');

    await user.click(screen.getByTestId('select-edit-vehicle-asset'));
    await user.click(screen.getByRole('option', { name: 'AST-78 · Generator' }));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));
    expect(updateMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 3, data: expect.objectContaining({ assetId: 78 }) },
      expect.anything(),
    );
  });

  it('clears the linked asset as null', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    await user.click(screen.getByTestId('select-edit-vehicle-asset'));
    await user.click(screen.getByRole('option', { name: 'Not linked' }));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));
    expect(updateMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 3, data: expect.objectContaining({ assetId: null }) },
      expect.anything(),
    );
  });

  it('pre-populates the current status', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    expect(screen.getByTestId('select-edit-vehicle-status')).toHaveTextContent('Maintenance');
  });

  it('can put a vehicle into maintenance — the status the register could not reach before', async () => {
    state.vehicles = [{ ...VEHICLES[0], description: null }];
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-1'));
    expect(screen.getByTestId('select-edit-vehicle-status')).toHaveTextContent('Available');
    await user.click(screen.getByTestId('select-edit-vehicle-status'));
    await user.click(screen.getByRole('option', { name: 'Maintenance' }));
    await user.click(screen.getByTestId('button-submit-edit-vehicle'));
    expect(updateMutateMock).toHaveBeenCalledWith(
      { organizationId: 10, vehicleId: 1, data: expect.objectContaining({ status: 'maintenance' }) },
      expect.anything(),
    );
  });

  it('offers only the three administrative statuses, and never in use', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));
    await user.click(screen.getByTestId('select-edit-vehicle-status'));
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options).toEqual(['Available', 'Maintenance', 'Inactive']);
    expect(options.some((t) => /in use/i.test(t))).toBe(false);
  });
});

/**
 * A vehicle's driver, branch and asset are references to other records. The
 * register must never make anyone type or read one of their ids: every entry
 * point is a chooser, so no text box or number box may stand for one.
 */
function assertNoIdEntry(scope: HTMLElement) {
  for (const field of Array.from(scope.querySelectorAll('input, textarea'))) {
    expect(field.getAttribute('type')).not.toBe('number');
    const identity = `${field.id} ${field.getAttribute('data-testid') ?? ''} ${field.getAttribute('name') ?? ''}`;
    expect(identity).not.toMatch(/driver|branch|asset/i);
  }
}

describe('Vehicle register — the register reads in names, never ids', () => {
  it('shows the driver and the branch by name, and a dash where there is none', () => {
    renderPage();
    expect(screen.getByTestId('cell-vehicle-driver-3')).toHaveTextContent('Amara Owusu');
    expect(screen.getByTestId('cell-vehicle-branch-3')).toHaveTextContent('Head Office');
    expect(screen.getByTestId('cell-vehicle-driver-1')).toHaveTextContent('—');
    expect(screen.getByTestId('cell-vehicle-branch-1')).toHaveTextContent('—');
  });

  it('shows an unresolvable reference as unknown rather than as its id', () => {
    state.employees = [];
    state.branches = [];
    renderPage();
    expect(screen.getByTestId('cell-vehicle-driver-3')).toHaveTextContent('Unknown employee');
    expect(screen.getByTestId('cell-vehicle-branch-3')).toHaveTextContent('Unknown branch');
    expect(screen.getByTestId('cell-vehicle-driver-3')).not.toHaveTextContent('200');
    expect(screen.getByTestId('cell-vehicle-branch-3')).not.toHaveTextContent('5');
  });

  it('offers no free-text or numeric field for driver, branch or asset when adding', async () => {
    state.permissions = new Set(['asset_management.manage']);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-add-vehicle'));

    assertNoIdEntry(screen.getByRole('dialog'));
    // Each optional reference is a chooser, not a typed id.
    expect(screen.getByTestId('select-vehicle-driver')).toHaveAttribute('role', 'combobox');
    expect(screen.getByTestId('select-vehicle-branch')).toHaveAttribute('role', 'combobox');
    expect(screen.getByTestId('select-vehicle-asset')).toHaveAttribute('role', 'combobox');
  });

  it('offers no free-text or numeric field for driver or branch when editing', async () => {
    state.permissions = new Set(['asset_management.manage']);
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-edit-vehicle-3'));

    assertNoIdEntry(screen.getByRole('dialog'));
    expect(screen.getByTestId('select-edit-vehicle-driver')).toHaveAttribute('role', 'combobox');
    expect(screen.getByTestId('select-edit-vehicle-branch')).toHaveAttribute('role', 'combobox');
  });
});
