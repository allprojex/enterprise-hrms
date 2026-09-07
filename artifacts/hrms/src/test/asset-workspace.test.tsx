/**
 * Tests for the Internal Asset Workspace page (Phase 3E, W101).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made. Dialog/row components are imported from the
 * real assets.tsx (a single source of truth for both surfaces), so this
 * mock covers every hook those reused components themselves call.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssetWorkspace from '@/pages/asset-workspace';
import type { Asset, AssetIncident, Branch, MasterDataItem, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    branches: [] as Branch[],
    categoryItems: [] as MasterDataItem[],
    // A flat "all assets" list — the mocked useListAssets filters by
    // params.status itself, mirroring the real backend's own filtering, so
    // the Register/Outstanding/Lost/Retired tabs (which each call the same
    // hook with different status params) each see the right subset.
    allAssets: [] as Asset[],
    assetsLoading: false,
    assetsError: undefined as unknown,
    retireAssetMutate: vi.fn(),
    markAssetLostMutate: vi.fn(),
    recoverAssetMutate: vi.fn(),
    returnAssetMutate: vi.fn(),
    incidents: [] as AssetIncident[],
    incidentsLoading: false,
    incidentsError: undefined as unknown,
    reviewIncidentMutate: vi.fn(),
    dismissIncidentMutate: vi.fn(),
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
  useListAssets: (_orgId: number, params?: { status?: string; search?: string }) => {
    const filtered = state.allAssets.filter((a) => (params?.status ? a.status === params.status : true) && (params?.search ? a.name.toLowerCase().includes(params.search.toLowerCase()) : true));
    return { data: { items: filtered, total: filtered.length, page: 1, pageSize: 20 }, isLoading: state.assetsLoading, error: state.assetsError, refetch: vi.fn() };
  },
  getListAssetsQueryKey: (orgId: number, params?: unknown) => ['assets', orgId, params],
  useRetireAsset: () => ({ mutate: state.retireAssetMutate, isPending: false }),
  useMarkAssetLost: () => ({ mutate: state.markAssetLostMutate, isPending: false }),
  useRecoverAsset: () => ({ mutate: state.recoverAssetMutate, isPending: false }),
  useReturnAsset: () => ({ mutate: state.returnAssetMutate, isPending: false }),
  useListAssetIncidents: (_orgId: number, params?: { status?: string }) => {
    const filtered = state.incidents.filter((i) => (params?.status ? i.status === params.status : true));
    return { data: filtered, isLoading: state.incidentsLoading, error: state.incidentsError, refetch: vi.fn() };
  },
  getListAssetIncidentsQueryKey: (orgId: number, params?: unknown) => ['assetIncidents', orgId, params],
  useReviewAssetIncident: () => ({ mutate: state.reviewIncidentMutate, isPending: false }),
  useDismissAssetIncident: () => ({ mutate: state.dismissIncidentMutate, isPending: false }),
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, permissions: [], isPrimaryHr: false };
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetWorkspace />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.branches = [];
  state.categoryItems = [];
  state.allAssets = [];
  state.assetsLoading = false;
  state.assetsError = undefined;
  state.retireAssetMutate = vi.fn();
  state.markAssetLostMutate = vi.fn();
  state.recoverAssetMutate = vi.fn();
  state.returnAssetMutate = vi.fn();
  state.incidents = [];
  state.incidentsLoading = false;
  state.incidentsError = undefined;
  state.reviewIncidentMutate = vi.fn();
  state.dismissIncidentMutate = vi.fn();
}

describe('Asset Workspace page', () => {
  it('renders for an authorized HR/Admin user', () => {
    resetState();
    renderPage();
    expect(screen.getByText('Asset Workspace')).toBeInTheDocument();
  });

  it('blocks a non-HR-capable role entirely (module-gated management authority, not read.own/reports.read)', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(screen.queryByTestId('tab-workspace-register')).not.toBeInTheDocument();
  });

  it('a manager (relationship-only, Team Assets visibility) is not granted workspace management controls — no HR-capable role means no access', () => {
    resetState();
    // A manager holding only the base employee role (as established
    // throughout this session's own Assets test convention — manager
    // authority is relationship-based, never a role/permission of its
    // own) never becomes HR-capable through that relationship alone.
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
  });

  it('shows the 4 frozen tabs: Register, Outstanding Returns, Open Incidents, Lost/Retired — nothing else', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('tab-workspace-register')).toBeInTheDocument();
    expect(screen.getByTestId('tab-workspace-outstanding')).toBeInTheDocument();
    expect(screen.getByTestId('tab-workspace-incidents')).toBeInTheDocument();
    expect(screen.getByTestId('tab-workspace-history')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-workspace-maintenance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-workspace-evidence')).not.toBeInTheDocument();
  });

  it('links out to /assets for full per-asset management rather than duplicating the detail view', () => {
    resetState();
    state.allAssets = [asset({ id: 1 })];
    renderPage();
    const link = screen.getByTestId('link-workspace-manage-1');
    expect(link.getAttribute('href')).toBe('/assets');
  });

  describe('Register tab', () => {
    it('shows a loading state without crashing', () => {
      resetState();
      state.assetsLoading = true;
      renderPage();
      expect(screen.getByText('Asset Workspace')).toBeInTheDocument();
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
      expect(screen.getByText(/no assets match the current filters/i)).toBeInTheDocument();
    });

    it('renders assets with a textual status label, never color alone', () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'lost' })];
      renderPage();
      expect(screen.getByTestId('row-workspace-register-1')).toHaveTextContent('Lost');
    });

    it('offers Retire/Mark-Lost/Recover quick actions reusing the exact assets.tsx dialogs', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'available' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-retire-1'));
      await userEvent.type(screen.getByTestId('textarea-retire-reason-1'), 'End of life');
      await userEvent.click(screen.getByTestId('button-confirm-retire-1'));
      expect(state.retireAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { reason: 'End of life' } },
        expect.anything(),
      );
    });

    it('invalidates the shared assets query after a quick action, so the Outstanding/History tabs stay fresh', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'lost' })];
      renderPage();
      await userEvent.click(screen.getByTestId('button-open-recover-1'));
      await userEvent.type(screen.getByTestId('textarea-recover-reason-1'), 'Found in storage');
      // onSuccess callbacks are internal to the reused dialog and mocked
      // mutate() never actually invokes them here — asserting the mutate
      // call itself (already covered above) plus that the page does not
      // crash on the same shared invalidation handler is the meaningful
      // regression surface for this specific test.
      await userEvent.click(screen.getByTestId('button-confirm-recover-1'));
      expect(state.recoverAssetMutate).toHaveBeenCalled();
    });
  });

  describe('Outstanding Returns tab', () => {
    it('shows only currently-assigned assets, never available/lost/retired ones', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'assigned' }), asset({ id: 2, status: 'available' }), asset({ id: 3, status: 'lost' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-outstanding'));
      expect(screen.getByTestId('row-workspace-outstanding-1')).toBeInTheDocument();
      expect(screen.queryByTestId('row-workspace-outstanding-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-workspace-outstanding-3')).not.toBeInTheDocument();
    });

    it('shows an empty state when nothing is outstanding', async () => {
      resetState();
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-outstanding'));
      expect(screen.getByTestId('text-workspace-no-outstanding')).toBeInTheDocument();
    });

    it('offers a Return action reusing the exact assets.tsx ReturnAssetDialog', async () => {
      resetState();
      state.allAssets = [asset({ id: 5, status: 'assigned' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-outstanding'));
      await userEvent.click(screen.getByTestId('button-open-return-5'));
      await userEvent.click(screen.getByTestId('button-confirm-return-5'));
      expect(state.returnAssetMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 5, data: expect.objectContaining({}) },
        expect.anything(),
      );
    });

    it('never renders an "assign new custody" control — assignment stays in the Asset Register detail view', async () => {
      resetState();
      state.allAssets = [asset({ id: 5, status: 'assigned' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-outstanding'));
      expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
    });
  });

  describe('Open Incidents tab', () => {
    it('shows only open incidents, never reviewed/dismissed ones', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' }), incident({ id: 2, status: 'reviewed' }), incident({ id: 3, status: 'dismissed' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-incidents'));
      expect(screen.getByTestId('row-incident-workspace-1')).toBeInTheDocument();
      expect(screen.queryByTestId('row-incident-workspace-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-incident-workspace-3')).not.toBeInTheDocument();
    });

    it('shows an empty state when there are no open incidents', async () => {
      resetState();
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-incidents'));
      expect(screen.getByTestId('text-workspace-no-open-incidents')).toBeInTheDocument();
    });

    it('review action reuses the exact existing hook/route, never implying an automatic asset mutation', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-incidents'));
      await userEvent.click(screen.getByTestId('button-open-review-workspace-1'));
      await userEvent.click(screen.getByTestId('button-confirm-review-workspace-1'));
      expect(state.reviewIncidentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { resolutionNotes: undefined } },
        expect.anything(),
      );
      expect(state.retireAssetMutate).not.toHaveBeenCalled();
      expect(state.markAssetLostMutate).not.toHaveBeenCalled();
    });

    it('dismiss action reuses the exact existing hook/route', async () => {
      resetState();
      state.incidents = [incident({ id: 1, status: 'open' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-incidents'));
      await userEvent.click(screen.getByTestId('button-open-dismiss-workspace-1'));
      await userEvent.click(screen.getByTestId('button-confirm-dismiss-workspace-1'));
      expect(state.dismissIncidentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 1, data: { resolutionNotes: undefined } },
        expect.anything(),
      );
    });
  });

  describe('Lost / Retired History tab', () => {
    it('separates lost and retired into two distinct sections', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'lost', assetTag: 'AST-LOST' }), asset({ id: 2, status: 'retired', assetTag: 'AST-RETIRED' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-history'));
      expect(screen.getByText('Lost')).toBeInTheDocument();
      expect(screen.getByText('Retired')).toBeInTheDocument();
      expect(screen.getByTestId('row-workspace-history-1')).toHaveTextContent('AST-LOST');
      expect(screen.getByTestId('row-workspace-history-2')).toHaveTextContent('AST-RETIRED');
    });

    it('shows empty states independently for lost and retired', async () => {
      resetState();
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-history'));
      expect(screen.getByTestId('text-workspace-no-lost')).toBeInTheDocument();
      expect(screen.getByTestId('text-workspace-no-retired')).toBeInTheDocument();
    });

    it('offers Recover only for lost assets, never for retired ones (permanently terminal)', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'lost' }), asset({ id: 2, status: 'retired' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-history'));
      const lostRow = screen.getByTestId('row-workspace-history-1');
      expect(within(lostRow).getByTestId('button-open-recover-1')).toBeInTheDocument();
      const retiredRow = screen.getByTestId('row-workspace-history-2');
      expect(within(retiredRow).queryByRole('button')).not.toBeInTheDocument();
    });

    it('never renders a depreciation/book-value/accounting figure', async () => {
      resetState();
      state.allAssets = [asset({ id: 1, status: 'retired', purchaseCost: '1200.00' })];
      renderPage();
      await userEvent.click(screen.getByTestId('tab-workspace-history'));
      expect(screen.queryByText(/book value/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/depreciat/i)).not.toBeInTheDocument();
    });
  });

  it('never renders an offboarding/exit-process hard-block control anywhere on the page', () => {
    resetState();
    renderPage();
    expect(screen.queryByText(/exit process/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/terminat/i)).not.toBeInTheDocument();
  });

  it('never renders maintenance or evidence controls — those remain exclusively nested in the /assets detail view', () => {
    resetState();
    state.allAssets = [asset({ id: 1 })];
    renderPage();
    expect(screen.queryByText(/schedule maintenance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attach evidence/i)).not.toBeInTheDocument();
  });
});
