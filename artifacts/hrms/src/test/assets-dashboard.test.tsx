/**
 * Tests for the Asset Dashboard page (Phase 3E, W102 per the frozen plan's
 * own §24 numbering). @workspace/api-client-react is mocked at the hook
 * level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssetsDashboard from '@/pages/assets-dashboard';
import type { AssetDashboard as AssetDashboardDto } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    dashboard: undefined as AssetDashboardDto | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetAssetDashboard: () => ({ data: state.dashboard, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetAssetDashboardQueryKey: () => ['assetDashboard'],
}));

function dashboardDto(overrides: Partial<AssetDashboardDto> = {}): AssetDashboardDto {
  return {
    totalAssetCount: 5,
    statusBreakdown: [
      { status: 'available', count: 2 },
      { status: 'assigned', count: 2 },
      { status: 'maintenance', count: 1 },
      { status: 'lost', count: 0 },
      { status: 'retired', count: 0 },
    ],
    employeesWithAssignedAssetsCount: 2,
    overdueReturnCount: 1,
    openIncidentCount: 1,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetsDashboard />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.dashboard = undefined;
  state.isLoading = false;
  state.error = undefined;
}

describe('Asset Dashboard page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.isLoading = true;
    renderPage();
    expect(screen.getByText('Asset Dashboard')).toBeInTheDocument();
  });

  it('shows an access-denied message on 403', () => {
    resetState();
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('shows a generic error state with retry otherwise', () => {
    resetState();
    state.error = { status: 500 };
    renderPage();
    expect(screen.getByText(/could not load the dashboard/i)).toBeInTheDocument();
  });

  it('renders every tile with the backend-authoritative counts', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.getByTestId('card-total-assets')).toHaveTextContent('5');
    expect(screen.getByTestId('card-employees-with-assets')).toHaveTextContent('2');
    expect(screen.getByTestId('card-overdue-returns')).toHaveTextContent('1');
    expect(screen.getByTestId('card-open-incidents')).toHaveTextContent('1');
  });

  it('renders the zero-filled status breakdown with text labels, all 5 statuses present', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.getByTestId('status-badge-available')).toHaveTextContent('Available: 2');
    expect(screen.getByTestId('status-badge-assigned')).toHaveTextContent('Assigned: 2');
    expect(screen.getByTestId('status-badge-maintenance')).toHaveTextContent('Maintenance: 1');
    expect(screen.getByTestId('status-badge-lost')).toHaveTextContent('Lost: 0');
    expect(screen.getByTestId('status-badge-retired')).toHaveTextContent('Retired: 0');
  });

  it('never shows a fabricated financial/depreciation/rate/utilization tile', () => {
    resetState();
    state.dashboard = dashboardDto();
    renderPage();
    expect(screen.queryByText(/depreciat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/book value/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/utilization/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('an all-zero dashboard (empty own/manager scope) renders cleanly, never an error', () => {
    resetState();
    state.dashboard = dashboardDto({
      totalAssetCount: 0,
      statusBreakdown: [
        { status: 'available', count: 0 },
        { status: 'assigned', count: 0 },
        { status: 'maintenance', count: 0 },
        { status: 'lost', count: 0 },
        { status: 'retired', count: 0 },
      ],
      employeesWithAssignedAssetsCount: 0,
      overdueReturnCount: 0,
      openIncidentCount: 0,
    });
    renderPage();
    expect(screen.getByTestId('card-total-assets')).toHaveTextContent('0');
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });
});
