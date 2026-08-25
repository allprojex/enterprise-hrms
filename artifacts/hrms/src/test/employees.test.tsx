/**
 * Tests for the Employees directory page (src/pages/employees.tsx),
 * focused on the new Personnel Records Search panel added in Phase 3H,
 * W118 (frozen plan §10) — the page had zero prior test coverage, so only
 * the new feature is exercised in depth; the pre-existing directory
 * list/search/add-employee dialog get minimal, non-crashing default mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Employees from '@/pages/employees';
import { useListMyOrganizations } from '@workspace/api-client-react';
import type { PersonnelSearchResult } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    personnelResults: undefined as PersonnelSearchResult[] | undefined,
    personnelSearchError: undefined as unknown,
    personnelSearchFetching: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: vi.fn(),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],

  useListEmployees: () => ({ data: { items: [], total: 0 }, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListEmployeesQueryKey: (orgId: number, params: unknown) => ['employees', orgId, params],
  useCreateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadEmployeeProfilePicture: () => ({ mutate: vi.fn(), isPending: false }),
  useListDepartments: () => ({ data: [] }),
  getListDepartmentsQueryKey: (orgId: number) => ['departments', orgId],

  // Personnel Records Search (Phase 3H, W118) — the feature under test.
  useSearchPersonnelRecords: () => ({
    data: state.personnelResults,
    error: state.personnelSearchError,
    isFetching: state.personnelSearchFetching,
  }),
  getSearchPersonnelRecordsQueryKey: (orgId: number, params: unknown) => ['searchPersonnelRecords', orgId, params],
}));

function resetState() {
  state.personnelResults = undefined;
  state.personnelSearchError = undefined;
  state.personnelSearchFetching = false;
  vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['org_admin'] }] } as never);
}

function resultRow(overrides: Partial<PersonnelSearchResult> = {}): PersonnelSearchResult {
  return {
    employeeId: 1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    employmentStatus: 'active',
    matchType: 'name',
    matchedValue: 'Ada Lovelace',
    isCurrentHolder: true,
    validFrom: null,
    validTo: null,
    currentEmployeeNumber: 'EMP-0001',
    pifNumber: 'PIF-001',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/employees', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/employees">{() => <Employees />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Employees directory page', () => {
  it('renders without crashing', () => {
    resetState();
    renderPage();
    expect(screen.getByText('Employees')).toBeInTheDocument();
  });

  describe('Personnel Records Search (Phase 3H, W118, §10)', () => {
    it('shows the search panel and prompts for input before any term is typed', () => {
      resetState();
      renderPage();
      expect(screen.getByText('Personnel Records Search')).toBeInTheDocument();
      expect(screen.queryByTestId('list-personnel-search-results')).not.toBeInTheDocument();
    });

    it('shows a "no matches" message when the search returns nothing', async () => {
      resetState();
      state.personnelResults = [];
      renderPage();
      const user = userEvent.setup();
      await user.type(screen.getByTestId('input-personnel-search'), 'nobody');
      expect(screen.getByText('No personnel records match.')).toBeInTheDocument();
    });

    it('labels a current staff-number holder distinctly from a historical one, both under the same search term', async () => {
      resetState();
      state.personnelResults = [
        resultRow({ employeeId: 1, firstName: 'Ama', lastName: 'Boateng', matchType: 'employee_number', matchedValue: 'EMP-0007', isCurrentHolder: true }),
        resultRow({ employeeId: 2, firstName: 'Kojo', lastName: 'Mensah', matchType: 'employee_number', matchedValue: 'EMP-0007', isCurrentHolder: false, validTo: '2026-01-01T00:00:00.000Z' }),
      ];
      renderPage();
      const user = userEvent.setup();
      await user.type(screen.getByTestId('input-personnel-search'), 'EMP-0007');

      const list = screen.getByTestId('list-personnel-search-results');
      const amaRow = screen.getByTestId('row-personnel-result-1-employee_number');
      const kojoRow = screen.getByTestId('row-personnel-result-2-employee_number');
      expect(within(list).getByText('Ama Boateng')).toBeInTheDocument();
      expect(within(list).getByText('Kojo Mensah')).toBeInTheDocument();
      expect(within(amaRow).getByText('Current holder')).toBeInTheDocument();
      expect(within(kojoRow).getByText('Historical holder')).toBeInTheDocument();
    });

    it('resolves a PIF-number search to exactly one unambiguous result', async () => {
      resetState();
      state.personnelResults = [resultRow({ matchType: 'pif_number', matchedValue: 'PIF-001' })];
      renderPage();
      const user = userEvent.setup();
      await user.type(screen.getByTestId('input-personnel-search'), 'PIF-001');

      const list = screen.getByTestId('list-personnel-search-results');
      expect(within(list).getAllByText('Ada Lovelace')).toHaveLength(1);
      expect(within(list).getByText('PIF number')).toBeInTheDocument();
    });

    it('links each result to the employee detail page', async () => {
      resetState();
      state.personnelResults = [resultRow({ employeeId: 7 })];
      renderPage();
      const user = userEvent.setup();
      await user.type(screen.getByTestId('input-personnel-search'), 'Ada');

      const link = screen.getByRole('link', { name: 'Ada Lovelace' });
      expect(link).toHaveAttribute('href', '/employees/7');
    });

    it('hides the entire panel when the search is forbidden (no personnel_file.read)', () => {
      resetState();
      state.personnelSearchError = { status: 403, error: 'Forbidden' };
      renderPage();
      expect(screen.queryByText('Personnel Records Search')).not.toBeInTheDocument();
      // The ordinary employee directory itself is unaffected by the 403.
      expect(screen.getByText('Employees')).toBeInTheDocument();
    });
  });

  it('never shows Add Employee to a plain employee (access-control bug regression)', () => {
    resetState();
    vi.mocked(useListMyOrganizations).mockReturnValue({ data: [{ organizationId: 10, roles: ['employee'] }] } as never);
    renderPage();
    expect(screen.queryByTestId('button-add-employee')).not.toBeInTheDocument();
  });

  it('shows Add Employee to an org_admin/hr_manager', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-add-employee')).toBeInTheDocument();
  });
});
