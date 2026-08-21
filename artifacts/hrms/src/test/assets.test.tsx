/**
 * Tests for the Asset Register page (Phase 3E, W96).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Assets from '@/pages/assets';
import type { Asset, Branch, MasterDataItem, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    branches: [] as Branch[],
    categoryItems: [] as MasterDataItem[],
    assets: { items: [] as Asset[], total: 0, page: 1, pageSize: 20 },
    assetsLoading: false,
    assetsError: undefined as unknown,
    detail: undefined as Asset | undefined,
    detailLoading: false,
    createAssetMutate: vi.fn() as (...args: unknown[]) => void,
    updateAssetMutate: vi.fn() as (...args: unknown[]) => void,
    retireAssetMutate: vi.fn() as (...args: unknown[]) => void,
    markAssetLostMutate: vi.fn() as (...args: unknown[]) => void,
    recoverAssetMutate: vi.fn() as (...args: unknown[]) => void,
    updateAssetConditionMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListBranches: () => ({ data: state.branches }),
  getListBranchesQueryKey: () => ['branches'],
  useListMasterDataItems: () => ({ data: state.categoryItems }),
  getListMasterDataItemsQueryKey: () => ['masterDataItems'],
  useListAssets: () => ({
    data: state.assets,
    isLoading: state.assetsLoading,
    error: state.assetsError,
    refetch: vi.fn(),
  }),
  getListAssetsQueryKey: () => ['assets'],
  useGetAsset: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined }),
  getGetAssetQueryKey: () => ['asset'],
  useCreateAsset: () => ({ mutate: state.createAssetMutate, isPending: false }),
  useUpdateAsset: () => ({ mutate: state.updateAssetMutate, isPending: false }),
  useRetireAsset: () => ({ mutate: state.retireAssetMutate, isPending: false }),
  useMarkAssetLost: () => ({ mutate: state.markAssetLostMutate, isPending: false }),
  useRecoverAsset: () => ({ mutate: state.recoverAssetMutate, isPending: false }),
  useUpdateAssetCondition: () => ({ mutate: state.updateAssetConditionMutate, isPending: false }),
  AssetCondition: { new: 'new', good: 'good', fair: 'fair', poor: 'poor', damaged: 'damaged' },
  AssetStatus: { available: 'available', assigned: 'assigned', maintenance: 'maintenance', lost: 'lost', retired: 'retired' },
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles, isPrimaryHr: false };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 1,
    organizationId: 10,
    assetTag: 'AST-00001',
    categoryCode: 'laptop',
    name: 'ThinkPad X1',
    description: null,
    manufacturer: null,
    model: null,
    serialNumber: null,
    branchId: null,
    purchaseDate: null,
    purchaseCost: null,
    purchaseCurrency: null,
    warrantyExpiryDate: null,
    condition: 'good',
    status: 'available',
    notes: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Assets />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.branches = [];
  state.categoryItems = [];
  state.assets = { items: [], total: 0, page: 1, pageSize: 20 };
  state.assetsLoading = false;
  state.assetsError = undefined;
  state.detail = undefined;
  state.detailLoading = false;
  state.createAssetMutate = vi.fn();
  state.updateAssetMutate = vi.fn();
  state.retireAssetMutate = vi.fn();
  state.markAssetLostMutate = vi.fn();
  state.recoverAssetMutate = vi.fn();
  state.updateAssetConditionMutate = vi.fn();
}

describe('Asset Register page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.assetsLoading = true;
    renderPage();
    expect(screen.getByText('Asset Register')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.assetsError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to load assets/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no assets', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no assets found/i)).toBeInTheDocument();
  });

  it('renders assets in a table with tag, status, and condition', () => {
    resetState();
    state.assets = { items: [asset({ status: 'assigned', condition: 'fair' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    const row = screen.getByTestId('row-asset-1');
    expect(row).toHaveTextContent('AST-00001');
    expect(row).toHaveTextContent('ThinkPad X1');
    expect(row).toHaveTextContent('Assigned');
    expect(row).toHaveTextContent('Fair');
  });

  it('blocks the whole page for a non-HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(screen.queryByTestId('button-add-asset')).not.toBeInTheDocument();
  });

  it('submits the create form with the entered fields', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-asset'));
    await userEvent.type(screen.getByTestId('input-asset-name'), 'Dell Monitor');
    await userEvent.type(screen.getByTestId('input-asset-category'), 'monitor');
    await userEvent.click(screen.getByTestId('button-submit-asset'));
    expect(state.createAssetMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 10,
        data: expect.objectContaining({ name: 'Dell Monitor', categoryCode: 'monitor' }),
      }),
      expect.anything(),
    );
  });

  it('never sends assetTag or status as part of the create submission', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-asset'));
    await userEvent.type(screen.getByTestId('input-asset-name'), 'Dell Monitor');
    await userEvent.type(screen.getByTestId('input-asset-category'), 'monitor');
    await userEvent.click(screen.getByTestId('button-submit-asset'));
    const call = state.createAssetMutate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty('assetTag');
    expect(call.data).not.toHaveProperty('status');
  });

  it('opens the manage dialog and shows existing configuration', async () => {
    resetState();
    state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
    state.detail = asset();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-asset-1'));
    expect(screen.getByTestId('input-edit-asset-name')).toHaveValue('ThinkPad X1');
    expect(screen.getByTestId('text-manage-asset-tag')).toHaveTextContent('AST-00001');
  });

  it('submits the base-field edit form without touching condition or status', async () => {
    resetState();
    state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
    state.detail = asset();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-asset-1'));
    await userEvent.clear(screen.getByTestId('input-edit-asset-name'));
    await userEvent.type(screen.getByTestId('input-edit-asset-name'), 'ThinkPad X1 Carbon');
    await userEvent.click(screen.getByTestId('button-save-asset'));
    expect(state.updateAssetMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ name: 'ThinkPad X1 Carbon' }) }),
      expect.anything(),
    );
    const call = state.updateAssetMutate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty('condition');
    expect(call.data).not.toHaveProperty('status');
    expect(call.data).not.toHaveProperty('assetTag');
  });

  describe('lifecycle actions', () => {
    it('only offers Retire from available/maintenance/lost', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'assigned' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'assigned' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-open-retire-1')).not.toBeInTheDocument();
    });

    it('requires a reason before Retire is confirmed, and calls the mutation with it', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-retire-1'));
      expect(screen.getByTestId('button-confirm-retire-1')).toBeDisabled();
      await userEvent.type(screen.getByTestId('textarea-retire-reason-1'), 'End of life');
      expect(screen.getByTestId('button-confirm-retire-1')).not.toBeDisabled();
      await userEvent.click(screen.getByTestId('button-confirm-retire-1'));
      expect(state.retireAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { reason: 'End of life' } },
        expect.anything(),
      );
    });

    it('does not offer Mark Lost once retired', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'retired' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'retired' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-open-mark-lost-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-open-retire-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-open-recover-1')).not.toBeInTheDocument();
    });

    it('requires a reason before Mark Lost is confirmed, and calls the mutation with it', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-mark-lost-1'));
      expect(screen.getByTestId('button-confirm-mark-lost-1')).toBeDisabled();
      await userEvent.type(screen.getByTestId('textarea-lost-reason-1'), 'Not found after audit');
      await userEvent.click(screen.getByTestId('button-confirm-mark-lost-1'));
      expect(state.markAssetLostMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { reason: 'Not found after audit' } },
        expect.anything(),
      );
    });

    it('only offers Recover when the asset is currently lost', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-open-recover-1')).not.toBeInTheDocument();
    });

    it('requires a reason before Recover is confirmed, and calls the mutation with it', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'lost' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'lost' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-recover-1'));
      expect(screen.getByTestId('button-confirm-recover-1')).toBeDisabled();
      await userEvent.type(screen.getByTestId('textarea-recover-reason-1'), 'Found in storage room');
      await userEvent.click(screen.getByTestId('button-confirm-recover-1'));
      expect(state.recoverAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { reason: 'Found in storage room' } },
        expect.anything(),
      );
    });

    it('requires both a condition and a reason before Update Condition is confirmed', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-condition-1'));
      expect(screen.getByTestId('button-confirm-condition-1')).toBeDisabled();
      await userEvent.type(screen.getByTestId('textarea-condition-reason-1'), 'Screen scratched');
      expect(screen.getByTestId('button-confirm-condition-1')).toBeDisabled();
      await userEvent.click(screen.getByTestId('select-condition-1'));
      await userEvent.click(screen.getByRole('option', { name: 'Poor' }));
      expect(screen.getByTestId('button-confirm-condition-1')).not.toBeDisabled();
      await userEvent.click(screen.getByTestId('button-confirm-condition-1'));
      expect(state.updateAssetConditionMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { condition: 'poor', reason: 'Screen scratched' } },
        expect.anything(),
      );
    });

    it('still offers Update Condition on a retired asset (condition is independent of status)', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'retired' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'retired' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('button-open-condition-1')).toBeInTheDocument();
    });
  });

  it('does not expose assignment, custody, maintenance, incident, or evidence controls anywhere on the page', async () => {
    resetState();
    state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
    state.detail = asset();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-asset-1'));
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /report incident/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /schedule maintenance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload evidence/i })).not.toBeInTheDocument();
  });
});
