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
import type { Asset, AssetIncident, AssetMaintenance, AssetEvidence, Branch, MasterDataItem, MembershipSummary } from '@workspace/api-client-react';

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
    createAssetMutate: vi.fn(),
    updateAssetMutate: vi.fn(),
    retireAssetMutate: vi.fn(),
    markAssetLostMutate: vi.fn(),
    recoverAssetMutate: vi.fn(),
    updateAssetConditionMutate: vi.fn(),
    assignAssetMutate: vi.fn(),
    returnAssetMutate: vi.fn(),
    assignments: [] as unknown[],
    employees: [] as unknown[],
    incidents: [] as AssetIncident[],
    incidentsLoading: false,
    incidentsError: undefined as unknown,
    reviewIncidentMutate: vi.fn(),
    dismissIncidentMutate: vi.fn(),
    maintenanceRecords: [] as AssetMaintenance[],
    maintenanceLoading: false,
    maintenanceError: undefined as unknown,
    createMaintenanceMutate: vi.fn(),
    updateMaintenanceMutate: vi.fn(),
    evidenceItems: [] as AssetEvidence[],
    evidenceLoading: false,
    evidenceError: undefined as unknown,
    addEvidenceMutate: vi.fn(),
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
  useAssignAsset: () => ({ mutate: state.assignAssetMutate, isPending: false }),
  useReturnAsset: () => ({ mutate: state.returnAssetMutate, isPending: false }),
  useListAssetAssignments: () => ({ data: state.assignments, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListAssetAssignmentsQueryKey: () => ['assetAssignments'],
  useListEmployees: () => ({ data: { items: state.employees, total: state.employees.length, page: 1, pageSize: 200 } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListAssetIncidents: () => ({ data: state.incidents, isLoading: state.incidentsLoading, error: state.incidentsError, refetch: vi.fn() }),
  getListAssetIncidentsQueryKey: () => ['assetIncidents'],
  useReviewAssetIncident: () => ({ mutate: state.reviewIncidentMutate, isPending: false }),
  useDismissAssetIncident: () => ({ mutate: state.dismissIncidentMutate, isPending: false }),
  useListAssetMaintenance: () => ({ data: state.maintenanceRecords, isLoading: state.maintenanceLoading, error: state.maintenanceError, refetch: vi.fn() }),
  getListAssetMaintenanceQueryKey: () => ['assetMaintenance'],
  useCreateAssetMaintenance: () => ({ mutate: state.createMaintenanceMutate, isPending: false }),
  useUpdateAssetMaintenance: () => ({ mutate: state.updateMaintenanceMutate, isPending: false }),
  useListAssetEvidence: () => ({ data: state.evidenceItems, isLoading: state.evidenceLoading, error: state.evidenceError, refetch: vi.fn() }),
  getListAssetEvidenceQueryKey: () => ['assetEvidence'],
  useAddAssetEvidence: () => ({ mutate: state.addEvidenceMutate, isPending: false }),
  getDownloadAssetEvidenceUrl: (organizationId: number, id: number, evidenceId: number) => `/api/organizations/${organizationId}/assets/${id}/evidence/${evidenceId}/download`,
  AssetCondition: { new: 'new', good: 'good', fair: 'fair', poor: 'poor', damaged: 'damaged' },
  AssetStatus: { available: 'available', assigned: 'assigned', maintenance: 'maintenance', lost: 'lost', retired: 'retired' },
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, isPrimaryHr: false };
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
  state.assignAssetMutate = vi.fn();
  state.returnAssetMutate = vi.fn();
  state.assignments = [];
  state.employees = [{ id: 200, firstName: 'Amara', lastName: 'Owusu' }, { id: 201, firstName: 'Kojo', lastName: 'Mensah' }];
  state.incidents = [];
  state.incidentsLoading = false;
  state.incidentsError = undefined;
  state.reviewIncidentMutate = vi.fn();
  state.dismissIncidentMutate = vi.fn();
  state.maintenanceRecords = [];
  state.maintenanceLoading = false;
  state.maintenanceError = undefined;
  state.createMaintenanceMutate = vi.fn();
  state.updateMaintenanceMutate = vi.fn();
  state.evidenceItems = [];
  state.evidenceLoading = false;
  state.evidenceError = undefined;
  state.addEvidenceMutate = vi.fn();
}

function incident(overrides: Partial<AssetIncident> = {}): AssetIncident {
  return {
    id: 1,
    organizationId: 10,
    assetId: 1,
    assignmentId: 1,
    reportedByEmployeeId: 200,
    incidentType: 'damage',
    description: 'Screen cracked',
    reportedAt: new Date().toISOString(),
    status: 'open',
    reviewedByMembershipId: null,
    reviewedAt: null,
    resolutionNotes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function maintenance(overrides: Partial<AssetMaintenance> = {}): AssetMaintenance {
  return {
    id: 1,
    organizationId: 10,
    assetId: 1,
    maintenanceType: 'Annual service',
    description: null,
    providerText: null,
    status: 'scheduled',
    startedAt: null,
    completedAt: null,
    cost: null,
    notes: null,
    createdByMembershipId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function evidence(overrides: Partial<AssetEvidence> = {}): AssetEvidence {
  return {
    id: 1,
    organizationId: 10,
    assetId: 1,
    employeeDocumentId: 1,
    addedByMembershipId: null,
    addedAt: new Date().toISOString(),
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    uploadedBy: null,
    ...overrides,
  };
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

  it('does not expose the ESS-only acknowledgement or report-incident controls anywhere on this HR page (W98)', async () => {
    resetState();
    state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
    state.detail = asset();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-asset-1'));
    expect(screen.queryByRole('button', { name: /^i confirm i received this item$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /report an issue/i })).not.toBeInTheDocument();
  });

  describe('custody — assign / return (W97)', () => {
    it('only offers Assign when the asset is available', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'assigned' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'assigned' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-open-assign-1')).not.toBeInTheDocument();
    });

    it('offers Assign for an available asset and submits with the chosen employee', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-assign-1'));
      expect(screen.getByTestId('button-confirm-assign-1')).toBeDisabled();
      await userEvent.click(screen.getByTestId('select-assign-employee-1'));
      await userEvent.click(screen.getByRole('option', { name: 'Amara Owusu' }));
      expect(screen.getByTestId('button-confirm-assign-1')).not.toBeDisabled();
      await userEvent.click(screen.getByTestId('button-confirm-assign-1'));
      expect(state.assignAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: expect.objectContaining({ employeeId: 200 }) },
        expect.anything(),
      );
    });

    it('only offers Return when the asset is assigned', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-open-return-1')).not.toBeInTheDocument();
    });

    it('offers Return for an assigned asset and submits', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'assigned' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'assigned' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-return-1'));
      await userEvent.click(screen.getByTestId('button-confirm-return-1'));
      expect(state.returnAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: expect.objectContaining({}) },
        expect.anything(),
      );
    });

    it('shows current custody from the assignment history', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'assigned' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'assigned' });
      state.assignments = [
        { id: 1, organizationId: 10, assetId: 1, employeeId: 200, assetTagSnapshot: 'AST-00001', assetNameSnapshot: 'ThinkPad X1', categorySnapshot: 'laptop', departmentIdSnapshot: null, positionIdSnapshot: null, issuedAt: new Date().toISOString(), issuedByMembershipId: null, expectedReturnDate: null, issueCondition: 'good', issueNotes: null, acknowledgedAt: null, acknowledgementNote: null, custodyEndedAt: null, endReason: null, receivedByMembershipId: null, returnCondition: null, returnNotes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('text-current-custody-1')).toHaveTextContent('employee #200');
      expect(screen.getByTestId('text-current-custody-1')).toHaveTextContent('Not yet acknowledged');
    });

    it('shows "no one currently holds this asset" when there is no active custody', async () => {
      resetState();
      state.assets = { items: [asset({ status: 'available' })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ status: 'available' });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('text-no-current-custody-1')).toBeInTheDocument();
    });
  });

  describe('incidents — org-wide queue and per-asset panel (W99)', () => {
    it('shows an empty state when no incidents have been reported', () => {
      resetState();
      renderPage();
      expect(screen.getByTestId('text-no-incidents')).toBeInTheDocument();
    });

    it('shows a loading state for the incidents queue without crashing', () => {
      resetState();
      state.incidentsLoading = true;
      renderPage();
      expect(screen.getByText('Asset Register')).toBeInTheDocument();
    });

    it('shows an error state for the incidents queue with retry', () => {
      resetState();
      state.incidentsError = { error: 'boom' };
      renderPage();
      expect(screen.getByText(/could not load incidents/i)).toBeInTheDocument();
    });

    it('renders an open incident in the queue with a text status label, asset context, and reporter', () => {
      resetState();
      state.incidents = [incident({ id: 1, assetId: 7, status: 'open', incidentType: 'damage', reportedByEmployeeId: 200 })];
      renderPage();
      const row = screen.getByTestId('row-incident-queue-1');
      expect(row).toHaveTextContent('Asset #7');
      expect(row).toHaveTextContent('Damage');
      expect(row).toHaveTextContent('employee #200');
      expect(screen.getByTestId('badge-incident-status-queue-1')).toHaveTextContent('Open');
    });

    it('renders a reviewed incident with a text "Reviewed" label and no action buttons', () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'reviewed', resolutionNotes: 'Confirmed with employee' })];
      renderPage();
      expect(screen.getByTestId('badge-incident-status-queue-1')).toHaveTextContent('Reviewed');
      expect(screen.getByTestId('row-incident-queue-1')).toHaveTextContent('Confirmed with employee');
      expect(screen.queryByTestId('button-open-review-queue-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-open-dismiss-queue-1')).not.toBeInTheDocument();
    });

    it('renders a dismissed incident with a text "Dismissed" label and no action buttons', () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'dismissed' })];
      renderPage();
      expect(screen.getByTestId('badge-incident-status-queue-1')).toHaveTextContent('Dismissed');
      expect(screen.queryByTestId('button-open-review-queue-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-open-dismiss-queue-1')).not.toBeInTheDocument();
    });

    it('offers Review and Dismiss only while an incident is open', () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      expect(screen.getByTestId('button-open-review-queue-1')).toBeInTheDocument();
      expect(screen.getByTestId('button-open-dismiss-queue-1')).toBeInTheDocument();
    });

    it('submits a review with an optional resolution note through the real route', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-review-queue-1'));
      await userEvent.type(screen.getByTestId('textarea-review-notes-queue-1'), 'Confirmed damage');
      await userEvent.click(screen.getByTestId('button-confirm-review-queue-1'));
      expect(state.reviewIncidentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { resolutionNotes: 'Confirmed damage' } },
        expect.anything(),
      );
    });

    it('submits a review with no note at all (resolutionNotes is optional, not mandatory)', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-review-queue-1'));
      expect(screen.getByTestId('button-confirm-review-queue-1')).not.toBeDisabled();
      await userEvent.click(screen.getByTestId('button-confirm-review-queue-1'));
      expect(state.reviewIncidentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { resolutionNotes: undefined } },
        expect.anything(),
      );
    });

    it('submits a dismiss through the real route', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-dismiss-queue-1'));
      await userEvent.click(screen.getByTestId('button-confirm-dismiss-queue-1'));
      expect(state.dismissIncidentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { resolutionNotes: undefined } },
        expect.anything(),
      );
    });

    it('groups incidents into Open and Resolved sections', () => {
      resetState();
      state.incidents = [
        incident({ id: 1, status: 'open' }),
        incident({ id: 2, status: 'reviewed' }),
      ];
      renderPage();
      expect(screen.getByText('Open (1)')).toBeInTheDocument();
      expect(screen.getByText('Resolved')).toBeInTheDocument();
    });

    it('shows only incidents for this specific asset inside the manage dialog panel, never other assets\' incidents', async () => {
      resetState();
      state.assets = { items: [asset({ id: 1 })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ id: 1 });
      state.incidents = [
        incident({ id: 1, assetId: 1, status: 'open' }),
        incident({ id: 2, assetId: 99, status: 'open' }),
      ];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('row-incident-panel-1')).toBeInTheDocument();
      expect(screen.queryByTestId('row-incident-panel-2')).not.toBeInTheDocument();
    });

    it('shows an empty state inside the manage dialog panel when this asset has no incidents', async () => {
      resetState();
      state.assets = { items: [asset({ id: 1 })], total: 1, page: 1, pageSize: 20 };
      state.detail = asset({ id: 1 });
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('text-no-asset-incidents')).toBeInTheDocument();
    });

    it('reviewing/dismissing an incident never itself renders as an asset status or condition change on this page', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-review-queue-1'));
      await userEvent.click(screen.getByTestId('button-confirm-review-queue-1'));
      // The review mutation was called; the page performs no separate,
      // automatic asset-mutating call as a side effect of it.
      expect(state.retireAssetMutate).not.toHaveBeenCalled();
      expect(state.markAssetLostMutate).not.toHaveBeenCalled();
      expect(state.updateAssetConditionMutate).not.toHaveBeenCalled();
    });
  });

  describe('maintenance (W100)', () => {
    it('shows an empty state when this asset has no maintenance history', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('text-no-maintenance')).toBeInTheDocument();
    });

    it('shows a loading state without crashing', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceLoading = true;
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByText('Manage Asset')).toBeInTheDocument();
    });

    it('shows an error state with retry', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceError = { error: 'boom' };
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByText(/could not load maintenance history/i)).toBeInTheDocument();
    });

    it('renders a maintenance record with a text status label, never color alone', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'in_progress', maintenanceType: 'Screen repair' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      const row = screen.getByTestId('row-maintenance-1');
      expect(row).toHaveTextContent('Screen repair');
      expect(screen.getByTestId('badge-maintenance-status-1')).toHaveTextContent('In Progress');
    });

    it('schedules a new maintenance record with the entered fields', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-schedule-maintenance-1'));
      await userEvent.type(screen.getByTestId('input-maintenance-type-1'), 'Annual service');
      await userEvent.click(screen.getByTestId('button-confirm-schedule-maintenance-1'));
      expect(state.createMaintenanceMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ maintenanceType: 'Annual service' }) }),
        expect.anything(),
      );
    });

    it('requires a maintenanceType before Schedule is confirmed', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-open-schedule-maintenance-1'));
      expect(screen.getByTestId('button-confirm-schedule-maintenance-1')).toBeDisabled();
    });

    it('offers only Start and Cancel while scheduled — no caller-selectable completion target anywhere', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'scheduled' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('button-start-maintenance-1')).toBeInTheDocument();
      expect(screen.getByTestId('button-cancel-maintenance-1')).toBeInTheDocument();
      expect(screen.queryByTestId('button-complete-maintenance-1')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
    });

    it('offers only Complete and Cancel while in progress', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'in_progress' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('button-complete-maintenance-1')).toBeInTheDocument();
      expect(screen.getByTestId('button-cancel-maintenance-1')).toBeInTheDocument();
      expect(screen.queryByTestId('button-start-maintenance-1')).not.toBeInTheDocument();
    });

    it('hides every transition control once terminal (completed)', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'completed', completedAt: new Date().toISOString() })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-start-maintenance-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-complete-maintenance-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-cancel-maintenance-1')).not.toBeInTheDocument();
    });

    it('hides every transition control once terminal (cancelled)', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'cancelled' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByTestId('button-start-maintenance-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-complete-maintenance-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-cancel-maintenance-1')).not.toBeInTheDocument();
    });

    it('calls the transition mutation with exactly the action — never a caller-selected target status', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.maintenanceRecords = [maintenance({ id: 1, status: 'scheduled' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      await userEvent.click(screen.getByTestId('button-start-maintenance-1'));
      expect(state.updateMaintenanceMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { action: 'start' } },
        expect.anything(),
      );
    });

    it('a manager cannot reach this page at all (relationship-only authority, no manage control renders for a non-HR role)', () => {
      resetState();
      state.myOrganizations = [membership(['employee'])];
      renderPage();
      expect(screen.queryByTestId('button-open-schedule-maintenance-1')).not.toBeInTheDocument();
    });
  });

  describe('evidence (W100)', () => {
    it('shows an empty state when this asset has no evidence', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('text-no-evidence')).toBeInTheDocument();
    });

    it('shows a loading state without crashing', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.evidenceLoading = true;
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByText('Manage Asset')).toBeInTheDocument();
    });

    it('shows an error state with retry', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.evidenceError = { error: 'boom' };
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByText(/could not load evidence/i)).toBeInTheDocument();
    });

    it('lists attached evidence with filename, type, and size', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.evidenceItems = [evidence({ id: 1, fileName: 'warranty.pdf', mimeType: 'application/pdf', fileSize: 10240 })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      const row = screen.getByTestId('row-evidence-1');
      expect(row).toHaveTextContent('warranty.pdf');
      expect(row).toHaveTextContent('application/pdf');
      expect(row).toHaveTextContent('10.0 KB');
    });

    it('offers an authenticated download action for each evidence row', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.evidenceItems = [evidence({ id: 1, fileName: 'warranty.pdf' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.getByTestId('button-download-evidence-1')).toBeInTheDocument();
    });

    it('uploading a file calls the mutation with the asset id and the selected file', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      const file = new File(['%PDF-1.4'], 'evidence.pdf', { type: 'application/pdf' });
      const input = screen.getByTestId('input-evidence-file-1') as HTMLInputElement;
      await userEvent.upload(input, file);
      expect(state.addEvidenceMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ file }) }),
        expect.anything(),
      );
    });

    it('no delete/remove control exists anywhere for an evidence row (attach/list/download only)', async () => {
      resetState();
      state.assets = { items: [asset()], total: 1, page: 1, pageSize: 20 };
      state.detail = asset();
      state.evidenceItems = [evidence({ id: 1 })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-manage-asset-1'));
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    });

    it('a manager cannot reach this page at all (relationship-only authority, no evidence control renders for a non-HR role)', () => {
      resetState();
      state.myOrganizations = [membership(['employee'])];
      renderPage();
      expect(screen.queryByTestId('button-attach-evidence-1')).not.toBeInTheDocument();
    });
  });
});
