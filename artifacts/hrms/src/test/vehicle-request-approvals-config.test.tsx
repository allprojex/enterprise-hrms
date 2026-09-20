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
    error: null as unknown,
  },
  createMutateMock: vi.fn(),
  deleteMutateAsyncMock: vi.fn(),
}));

const me = { id: 1, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', role: 'employee', activeOrganizationId: 10, organizationId: 10 };

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: me, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
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

beforeEach(() => {
  createMutateMock.mockReset();
  deleteMutateAsyncMock.mockReset();
  deleteMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
    return Promise.resolve(undefined);
  });
  state.stages = [...STAGES];
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
    expect(screen.queryByTestId('input-stage-membership-id')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('select-stage-resolver'));
    await user.click(screen.getByRole('option', { name: 'Anyone holding a permission' }));

    expect(screen.getByTestId('input-stage-permission-key')).toBeInTheDocument();
    expect(screen.queryByTestId('input-stage-membership-id')).not.toBeInTheDocument();
    // Still incomplete: a permission_holder stage without a key authorizes nobody.
    expect(screen.getByTestId('button-add-stage')).toBeDisabled();
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
