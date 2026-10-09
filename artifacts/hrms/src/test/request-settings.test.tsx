/**
 * WS-13 request configuration — the service request type "Active" switch is a
 * lifecycle change applied immediately (an inactive type refuses new requests
 * server-side), so it goes through a confirmation. The "Visible to employees"
 * and field-policy switches are preferences and still apply directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import RequestSettings from '@/pages/request-settings';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    types: [] as unknown[],
    fields: [] as unknown[],
    fieldsError: null as unknown,
    typesError: null as unknown,
  },
  mutations: {
    setPolicy: vi.fn(),
    createType: vi.fn(),
    updateType: vi.fn(),
    updateTypeAsync: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListDataChangeFields: () => ({ data: state.fields, isLoading: false, error: state.fieldsError, refetch: vi.fn() }),
  getListDataChangeFieldsQueryKey: (o: number) => ['dcFields', o],
  useSetDataChangeFieldPolicy: () => ({ mutate: mutations.setPolicy, isPending: false }),
  useListServiceRequestTypes: () => ({ data: state.types, isLoading: false, error: state.typesError, refetch: vi.fn() }),
  getListServiceRequestTypesQueryKey: (o: number) => ['srTypes', o],
  useCreateServiceRequestType: () => ({ mutate: mutations.createType, isPending: false }),
  useUpdateServiceRequestType: () => ({ mutate: mutations.updateType, mutateAsync: mutations.updateTypeAsync, isPending: false }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RequestSettings />
    </QueryClientProvider>,
  );
}

const activeType = {
  id: 5,
  code: 'employment-letter',
  name: 'Employment letter',
  fulfilmentKind: 'document',
  approvalRequired: false,
  employeeVisible: true,
  active: true,
};

async function openTypesTab() {
  const user = userEvent.setup();
  renderPage();
  await user.click(screen.getByRole('tab', { name: /Request types/i }));
  await screen.findByTestId('row-request-type-5');
  return user;
}

describe('Request Settings — request type lifecycle confirmation', () => {
  beforeEach(() => {
    state.types = [activeType];
    state.fields = [];
    state.fieldsError = null;
    state.typesError = null;
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  it('asks before deactivating a type, and Cancel changes nothing', async () => {
    const user = await openTypesTab();
    await user.click(screen.getByTestId('switch-type-active-5'));

    const dialog = screen.getByTestId('dialog-toggle-request-type');
    expect(dialog).toHaveTextContent('Deactivate request type?');
    expect(dialog).toHaveTextContent('“Employment letter” will no longer be available for new requests');
    expect(screen.getByTestId('dialog-toggle-request-type-confirm')).toHaveTextContent('Deactivate Request Type');
    expect(mutations.updateTypeAsync).not.toHaveBeenCalled();
    expect(mutations.updateType).not.toHaveBeenCalled();
    // Nothing optimistic: the switch still shows the server's state.
    expect(screen.getByTestId('switch-type-active-5')).toBeChecked();

    await user.click(screen.getByTestId('dialog-toggle-request-type-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-toggle-request-type')).toBeNull());
    expect(mutations.updateTypeAsync).not.toHaveBeenCalled();
    expect(mutations.updateType).not.toHaveBeenCalled();
  });

  it('deactivates exactly once on confirm and closes', async () => {
    mutations.updateTypeAsync.mockResolvedValueOnce({ ...activeType, active: false });
    const user = await openTypesTab();
    await user.click(screen.getByTestId('switch-type-active-5'));
    await user.click(screen.getByTestId('dialog-toggle-request-type-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-toggle-request-type')).toBeNull());
    expect(mutations.updateTypeAsync).toHaveBeenCalledTimes(1);
    expect(mutations.updateTypeAsync).toHaveBeenCalledWith({ organizationId: 10, typeId: 5, data: { active: false } });
  });

  it('keeps the dialog open when the server refuses', async () => {
    mutations.updateTypeAsync.mockRejectedValueOnce(new Error('Forbidden'));
    const user = await openTypesTab();
    await user.click(screen.getByTestId('switch-type-active-5'));
    await user.click(screen.getByTestId('dialog-toggle-request-type-confirm'));

    await waitFor(() => expect(mutations.updateTypeAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-toggle-request-type-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-toggle-request-type')).toBeInTheDocument();
    expect(screen.getByTestId('row-request-type-5')).toBeInTheDocument();
  });

  it('offers reactivation of an inactive type with a non-destructive confirmation', async () => {
    state.types = [{ ...activeType, active: false }];
    mutations.updateTypeAsync.mockResolvedValueOnce(activeType);
    const user = await openTypesTab();
    await user.click(screen.getByTestId('switch-type-active-5'));

    expect(screen.getByTestId('dialog-toggle-request-type')).toHaveTextContent('Reactivate request type?');
    expect(screen.getByTestId('dialog-toggle-request-type-confirm')).toHaveTextContent('Reactivate Request Type');
    await user.click(screen.getByTestId('dialog-toggle-request-type-confirm'));
    await waitFor(() => expect(mutations.updateTypeAsync).toHaveBeenCalledWith({ organizationId: 10, typeId: 5, data: { active: true } }));
  });

  it('still applies the employee-visible preference directly, without a dialog', async () => {
    const user = await openTypesTab();
    await user.click(screen.getByTestId('switch-type-visible-5'));
    expect(mutations.updateType).toHaveBeenCalledWith({ organizationId: 10, typeId: 5, data: { employeeVisible: false } });
    expect(screen.queryByTestId('dialog-toggle-request-type')).toBeNull();
  });

  it('shows no configuration at all to a caller the server refuses', () => {
    state.fieldsError = { status: 403 };
    state.typesError = { status: 403 };
    renderPage();
    expect(screen.getByText(/do not have access to request configuration/i)).toBeInTheDocument();
    expect(screen.queryByTestId('switch-type-active-5')).toBeNull();
  });
});
