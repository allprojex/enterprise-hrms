/**
 * VR-02A — the Vehicle Request approval-chain configuration page.
 *
 * Covers what the page itself decides: that an empty chain is presented as the
 * blocking condition it actually is, that the resolver-specific inputs follow
 * the chosen resolver, that removal goes through the shared confirmation
 * dialog, and that a refused fetch renders an explanation rather than a blank
 * page. The server re-checks every one of these.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VehicleRequestApprovalsConfig from '@/pages/vehicle-request-approvals-config';

const { state, createMutateMock, deleteMutateAsyncMock } = vi.hoisted(() => ({
  state: {
    stages: [] as Record<string, unknown>[],
    candidates: [] as Record<string, unknown>[] | undefined,
    candidatesLoading: false,
    candidatesError: null as unknown,
    error: null as unknown,
  },
  createMutateMock: vi.fn(),
  deleteMutateAsyncMock: vi.fn(),
}));

const me = { id: 1, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'employee', activeOrganizationId: 10, organizationId: 10 };

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: me, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListVehicleRequestApprovalCandidates: () => ({
    data: state.candidates,
    isLoading: state.candidatesLoading,
    error: state.candidatesError,
  }),
  getListVehicleRequestApprovalCandidatesQueryKey: () => ['vehicle-request-approval-candidates'],
  useListVehicleRequestApprovalStages: () => ({
    data: state.stages,
    isLoading: false,
    error: state.error,
    refetch: vi.fn(),
  }),
  getListVehicleRequestApprovalStagesQueryKey: () => ['vehicle-request-approval-stages'],
  useCreateVehicleRequestApprovalStage: () => ({ mutate: createMutateMock, isPending: false }),
  useDeleteVehicleRequestApprovalStage: () => ({ mutateAsync: deleteMutateAsyncMock, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <VehicleRequestApprovalsConfig />
    </QueryClientProvider>,
  );
}

const STAGES = [
  { id: 1, organizationId: 10, purpose: 'vehicle_request', stageOrder: 1, name: 'Department Head', resolverType: 'department_head', resolverConfig: {} },
  { id: 2, organizationId: 10, purpose: 'vehicle_request', stageOrder: 2, name: 'Transport Officer', resolverType: 'permission_holder', resolverConfig: { permissionKey: 'vehicle_request.approve' } },
];

// The endpoint returns only eligible candidates, so the page never has to
// filter: anyone listed here already holds vehicle_request.approve.
const CANDIDATES = [
  { membershipId: 77, firstName: 'Grace', lastName: 'Hopper' },
  { membershipId: 91, firstName: 'Katherine', lastName: 'Johnson' },
];

beforeEach(() => {
  createMutateMock.mockReset();
  deleteMutateAsyncMock.mockReset();
  deleteMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
    return Promise.resolve(undefined);
  });
  state.stages = [...STAGES];
  state.candidates = [...CANDIDATES];
  state.candidatesLoading = false;
  state.candidatesError = null;
  state.error = null;
});

describe('Vehicle approval chain — reading it', () => {
  it('lists the configured stages in order with their resolver', () => {
    renderPage();
    expect(screen.getByTestId('row-stage-1')).toHaveTextContent('Department Head');
    expect(screen.getByTestId('row-stage-2')).toHaveTextContent('Transport Officer');
    expect(screen.getByTestId('row-stage-2')).toHaveTextContent('Anyone holding a permission');
  });

  it('says plainly that an empty chain blocks requests, rather than looking like a harmless empty list', () => {
    state.stages = [];
    renderPage();
    expect(screen.getByTestId('text-no-stages')).toHaveTextContent(/cannot submit vehicle requests/i);
  });

  it('explains a refused fetch instead of rendering a blank page', () => {
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText(/do not have access to vehicle approval settings/i)).toBeInTheDocument();
    expect(screen.queryByTestId('button-add-stage')).not.toBeInTheDocument();
  });
});

describe('Vehicle approval chain — adding a stage', () => {
  it('keeps submission disabled until the stage has a name', () => {
    renderPage();
    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
  });

  it('appends to the end of the chain and sends no resolver config for a department head', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-stage-name'), 'Fleet Desk');
    await user.click(screen.getByTestId('button-add-stage'));

    expect(createMutateMock).toHaveBeenCalledWith(
      {
        organizationId: 10,
        data: { stageOrder: 3, name: 'Fleet Desk', resolverType: 'department_head', resolverConfig: {} },
      },
      expect.anything(),
    );
  });

  it('asks for the permission key only when the resolver needs one', async () => {
    renderPage();
    const user = userEvent.setup();
    expect(screen.queryByTestId('input-stage-permission-key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-stage-membership')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('select-stage-resolver'));
    await user.click(screen.getByRole('option', { name: 'Anyone holding a permission' }));

    expect(screen.getByTestId('input-stage-permission-key')).toBeInTheDocument();
    expect(screen.queryByTestId('select-stage-membership')).not.toBeInTheDocument();
    // Still incomplete: a permission_holder stage without a key authorizes nobody.
    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
  });
});

describe('Vehicle approval chain — naming a person', () => {
  async function chooseNamedPerson(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('select-stage-resolver'));
    await user.click(screen.getByRole('option', { name: 'One named person' }));
  }

  it('offers a member picker, never a box to type a database id into', async () => {
    renderPage();
    const user = userEvent.setup();
    await chooseNamedPerson(user);

    expect(screen.getByTestId('select-stage-membership')).toBeInTheDocument();
    // A membership id is never displayed anywhere in the product, so it is not
    // something an administrator could type even if we asked them to.
    expect(screen.queryByTestId('input-stage-membership-id')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it('offers the eligible approvers the server returned', async () => {
    renderPage();
    const user = userEvent.setup();
    await chooseNamedPerson(user);
    await user.click(screen.getByTestId('select-stage-membership'));

    expect(screen.getByRole('option', { name: 'Grace Hopper' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Katherine Johnson' })).toBeInTheDocument();
  });

  it('says so when the approver list could not be loaded, and does NOT blame the member', async () => {
    state.candidatesError = new Error('403');
    renderPage();
    const user = userEvent.setup();
    await chooseNamedPerson(user);

    expect(screen.getByTestId('text-candidates-error')).toBeInTheDocument();
    expect(screen.queryByTestId('select-stage-membership')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
  });

  it('shows a loading state rather than an empty picker', async () => {
    state.candidates = undefined;
    state.candidatesLoading = true;
    renderPage();
    const user = userEvent.setup();
    await chooseNamedPerson(user);

    expect(screen.getByTestId('text-candidates-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('select-stage-membership')).not.toBeInTheDocument();
  });

  it('explains an empty result instead of offering a picker with nothing in it', async () => {
    state.candidates = [];
    renderPage();
    const user = userEvent.setup();
    await chooseNamedPerson(user);

    expect(screen.getByTestId('text-candidates-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('select-stage-membership')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
  });

  it('sends the chosen member as the resolver configuration', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-stage-name'), 'Managing Director');
    await chooseNamedPerson(user);
    await user.click(screen.getByTestId('select-stage-membership'));
    await user.click(screen.getByRole('option', { name: 'Grace Hopper' }));
    await user.click(screen.getByTestId('button-add-stage'));

    expect(createMutateMock).toHaveBeenCalledWith(
      {
        organizationId: 10,
        data: {
          stageOrder: 3,
          name: 'Managing Director',
          resolverType: 'specific_membership',
          resolverConfig: { membershipId: 77 },
        },
      },
      expect.anything(),
    );
  });

  it('keeps submission disabled until a member is actually chosen', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-stage-name'), 'Managing Director');
    await chooseNamedPerson(user);

    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
  });
});

describe('Vehicle approval chain — what a configured stage says it names', () => {
  it('shows the named person by name, not by id', () => {
    state.stages = [
      { id: 3, organizationId: 10, purpose: 'vehicle_request', stageOrder: 1, name: 'Final sign-off', resolverType: 'specific_membership', resolverConfig: { membershipId: 77 } },
    ];
    renderPage();

    expect(screen.getByTestId('text-stage-detail-3')).toHaveTextContent('Grace Hopper');
    expect(screen.getByTestId('text-stage-detail-3')).not.toHaveTextContent('77');
  });

  it('marks a saved member who is no longer eligible, without touching the stored configuration', () => {
    // They were a valid approver when the stage was configured and are not one
    // now — the permission was revoked, or their membership ended. The stage
    // keeps its own resolverConfig; nothing is silently substituted.
    state.stages = [
      { id: 4, organizationId: 10, purpose: 'vehicle_request', stageOrder: 1, name: 'Final sign-off', resolverType: 'specific_membership', resolverConfig: { membershipId: 4242 } },
    ];
    renderPage();

    expect(screen.getByTestId('text-stage-detail-4')).toHaveTextContent('No longer an eligible approver');
    expect(screen.getByTestId('text-stage-detail-4')).not.toHaveTextContent('4242');
    // No repair, no substitution, no write of any kind.
    expect(createMutateMock).not.toHaveBeenCalled();
    expect(deleteMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('does NOT call a failed candidate load an ineligible member', () => {
    // A failed query has no data — which is exactly what makes this
    // distinction easy to get wrong and worth pinning.
    state.candidates = undefined;
    state.candidatesError = new Error('403');
    state.stages = [
      { id: 5, organizationId: 10, purpose: 'vehicle_request', stageOrder: 1, name: 'Final sign-off', resolverType: 'specific_membership', resolverConfig: { membershipId: 77 } },
    ];
    renderPage();

    const detail = screen.getByTestId('text-stage-detail-5');
    expect(detail).toHaveTextContent('approver list unavailable');
    expect(detail).not.toHaveTextContent('No longer an eligible approver');
    expect(detail).not.toHaveTextContent('Unknown member');
  });

  it('does not accuse anyone while the list is still loading', () => {
    state.candidates = undefined;
    state.candidatesLoading = true;
    state.stages = [
      { id: 6, organizationId: 10, purpose: 'vehicle_request', stageOrder: 1, name: 'Final sign-off', resolverType: 'specific_membership', resolverConfig: { membershipId: 77 } },
    ];
    renderPage();

    const detail = screen.getByTestId('text-stage-detail-6');
    expect(detail).toHaveTextContent('Loading');
    expect(detail).not.toHaveTextContent('No longer an eligible approver');
  });

  it('shows which permission a permission_holder stage names', () => {
    renderPage();
    expect(screen.getByTestId('text-stage-detail-2')).toHaveTextContent('vehicle_request.approve');
  });

  it('says nothing extra for a department-head stage, which names no one', () => {
    renderPage();
    expect(screen.queryByTestId('text-stage-detail-1')).not.toBeInTheDocument();
  });
});

describe('Vehicle approval chain — removing a stage', () => {
  it('confirms first, and says that in-flight requests keep their own chain', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-delete-stage-2'));

    expect(screen.getByText('Remove this approval stage?')).toBeInTheDocument();
    expect(screen.getByText(/keep the chain they were raised under/i)).toBeInTheDocument();
    expect(deleteMutateAsyncMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove stage' }));
    await waitFor(() => expect(deleteMutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(deleteMutateAsyncMock).toHaveBeenCalledWith({ organizationId: 10, stageId: 2 }, expect.anything());
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-delete-stage-1'));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(deleteMutateAsyncMock).not.toHaveBeenCalled();
  });
});
