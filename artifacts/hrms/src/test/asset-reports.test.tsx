/**
 * Tests for the Asset Reports page (Phase 3E, W102 per the frozen plan's
 * own §24 numbering). @workspace/api-client-react is mocked at the hook
 * level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssetReports from '@/pages/asset-reports';
import type { Report, ReportRunResult, Asset, Branch, Employee, Department, MasterDataItem } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as Report[],
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
    assets: [] as Asset[],
    branches: [] as Branch[],
    employees: [] as Employee[],
    departments: [] as Department[],
    categoryItems: [] as MasterDataItem[],
    calls: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useListAssets: () => ({ data: { items: state.assets, total: state.assets.length, page: 1, pageSize: 200 } }),
  getListAssetsQueryKey: () => ['assets'],
  useListBranches: () => ({ data: state.branches }),
  getListBranchesQueryKey: () => ['branches'],
  useListEmployees: () => ({ data: { items: state.employees, total: state.employees.length, page: 1, pageSize: 200 } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListMasterDataItems: () => ({ data: state.categoryItems }),
  getListMasterDataItemsQueryKey: () => ['masterDataItems'],
  useRunAssetReport: (_orgId: number, _key: string, params: unknown) => {
    state.calls.push(params);
    return { data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() };
  },
  getRunAssetReportQueryKey: () => ['runAssetReport'],
  getRunAssetReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/assets/reports/${key}`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function assetReport(key: string, label: string): Report {
  return { key, label, description: 'd', category: 'asset_management' };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetReports />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.reports = [
    assetReport('asset_register', 'Asset Register'),
    assetReport('asset_unreturned_by_employee', 'Unreturned Assets by Employee'),
    assetReport('asset_maintenance_history', 'Maintenance History'),
  ];
  state.catalogLoading = false;
  state.result = undefined;
  state.resultLoading = false;
  state.error = undefined;
  state.assets = [];
  state.branches = [];
  state.employees = [];
  state.departments = [];
  state.categoryItems = [];
  state.calls = [];
}

describe('Asset Reports page', () => {
  it('shows only asset_management-category reports in the selector, excluding other categories', () => {
    resetState();
    state.reports = [...state.reports, { key: 'headcount', label: 'Headcount', description: 'd', category: 'workforce' }];
    renderPage();
    expect(screen.getByText('Asset Register')).toBeInTheDocument();
    expect(screen.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows an empty state when no asset reports are registered', () => {
    resetState();
    state.reports = [];
    renderPage();
    expect(screen.getByText('No reports available')).toBeInTheDocument();
  });

  it('shows an access-denied message on 403', () => {
    resetState();
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('renders report columns and rows, using an em dash for null cells', () => {
    resetState();
    state.result = {
      key: 'asset_register',
      label: 'Asset Register',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'assetTag', label: 'Asset Tag' },
        { key: 'name', label: 'Name' },
        { key: 'currentHolder', label: 'Current Holder' },
      ],
      rows: [{ assetTag: 'AST-00001', name: 'Laptop', currentHolder: null }],
    };
    renderPage();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    const row = screen.getByTestId('row-asset-report-0');
    expect(row).toHaveTextContent('—');
  });

  it('shows a no-data message for an empty report result', () => {
    resetState();
    state.result = { key: 'asset_register', label: 'Asset Register', description: 'd', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    renderPage();
    expect(screen.getByText(/no data for this selection/i)).toBeInTheDocument();
  });

  it('enables the CSV download button once a report is loaded', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-download-asset-report-csv')).not.toBeDisabled();
  });

  describe('per-report filter visibility (W93 precedent — never a no-op filter)', () => {
    it('asset_register offers category/status/branch filters only', () => {
      resetState();
      state.reports = [assetReport('asset_register', 'Asset Register')];
      renderPage();
      expect(screen.getByTestId('input-asset-report-category')).toBeInTheDocument();
      expect(screen.getByTestId('select-asset-report-status')).toBeInTheDocument();
      expect(screen.getByTestId('select-asset-report-branch')).toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-department')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-asset')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-asset-report-date-from')).not.toBeInTheDocument();
    });

    it('asset_unreturned_by_employee offers employee/department filters only, no status/category/branch', () => {
      resetState();
      state.reports = [assetReport('asset_unreturned_by_employee', 'Unreturned Assets by Employee')];
      renderPage();
      expect(screen.getByTestId('select-asset-report-employee')).toBeInTheDocument();
      expect(screen.getByTestId('select-asset-report-department')).toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-asset-report-category')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-branch')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-asset')).not.toBeInTheDocument();
    });

    it('asset_maintenance_history offers asset/status/date-range filters only, no employee/department/category', () => {
      resetState();
      state.reports = [assetReport('asset_maintenance_history', 'Maintenance History')];
      renderPage();
      expect(screen.getByTestId('select-asset-report-asset')).toBeInTheDocument();
      expect(screen.getByTestId('select-asset-report-status')).toBeInTheDocument();
      expect(screen.getByTestId('input-asset-report-date-from')).toBeInTheDocument();
      expect(screen.getByTestId('input-asset-report-date-to')).toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-department')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-asset-report-category')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-asset-report-branch')).not.toBeInTheDocument();
    });

    it('the status filter shows asset-status options for asset_register', async () => {
      resetState();
      state.reports = [assetReport('asset_register', 'Asset Register')];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-status'));
      expect(screen.getByRole('option', { name: 'Retired' })).toBeInTheDocument();
    });

    it('the status filter shows maintenance-status options for asset_maintenance_history', async () => {
      resetState();
      state.reports = [assetReport('asset_maintenance_history', 'Maintenance History')];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-status'));
      expect(screen.getByRole('option', { name: 'In Progress' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Retired' })).not.toBeInTheDocument();
    });
  });

  describe('filters actually reach the backend query (not merely rendered controls)', () => {
    it('selecting a branch for asset_register updates the query params sent to the backend', async () => {
      resetState();
      state.reports = [assetReport('asset_register', 'Asset Register')];
      state.branches = [{ id: 500, organizationId: 10, name: 'HQ' } as Branch];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-branch'));
      await userEvent.click(screen.getByRole('option', { name: 'HQ' }));
      const lastCall = state.calls[state.calls.length - 1] as { branchId?: number };
      expect(lastCall.branchId).toBe(500);
    });

    it('selecting an employee for asset_unreturned_by_employee updates the query params', async () => {
      resetState();
      state.reports = [assetReport('asset_unreturned_by_employee', 'Unreturned Assets by Employee')];
      state.employees = [{ id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '' } as Employee];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-employee'));
      await userEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }));
      const lastCall = state.calls[state.calls.length - 1] as { employeeId?: number };
      expect(lastCall.employeeId).toBe(42);
    });

    it('selecting an asset for asset_maintenance_history updates the query params', async () => {
      resetState();
      state.reports = [assetReport('asset_maintenance_history', 'Maintenance History')];
      state.assets = [{ id: 7, assetTag: 'AST-00007', name: 'Printer' } as Asset];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-asset'));
      await userEvent.click(screen.getByRole('option', { name: /AST-00007/ }));
      const lastCall = state.calls[state.calls.length - 1] as { assetId?: number };
      expect(lastCall.assetId).toBe(7);
    });

    it('switching from asset_register to asset_unreturned_by_employee never leaks a stale branch/category filter into the new report call', async () => {
      resetState();
      state.branches = [{ id: 500, organizationId: 10, name: 'HQ' } as Branch];
      state.employees = [{ id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '' } as Employee];
      renderPage();
      await userEvent.click(screen.getByTestId('select-asset-report-branch'));
      await userEvent.click(screen.getByRole('option', { name: 'HQ' }));
      await userEvent.click(screen.getByTestId('select-asset-report'));
      await userEvent.click(screen.getByRole('option', { name: 'Unreturned Assets by Employee' }));
      const lastCall = state.calls[state.calls.length - 1] as { branchId?: number };
      expect(lastCall.branchId).toBeUndefined();
    });
  });

  it('never calculates or renders a client-side book-value/depreciation figure', () => {
    resetState();
    state.result = {
      key: 'asset_register',
      label: 'Asset Register',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [{ key: 'purchaseCost', label: 'Purchase Cost (reference only)' }],
      rows: [{ purchaseCost: '1200.00' }],
    };
    renderPage();
    expect(screen.queryByText(/book value/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/depreciat/i)).not.toBeInTheDocument();
  });
});
