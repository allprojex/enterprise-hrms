/**
 * Tests for the Employee detail page (HR-admin view), focused on the
 * Employment History card added in Phase 3F, W105.
 *
 * The page (src/pages/employee-detail.tsx) had zero test coverage before
 * this file — it calls many @workspace/api-client-react hooks, all of which
 * are stubbed here at the hook level (no real network requests are made) so
 * the page can render without crashing. Only the new Employment History card
 * is exercised in depth; the page's other pre-existing features (transfer/
 * promote/confirm dialogs, document upload, skills/qualifications/
 * certifications CRUD, disciplinary records, exit process) are out of scope
 * here and get minimal, non-crashing default mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import EmployeeDetail from '@/pages/employee-detail';
import type { Employee, EmploymentPeriodSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    employee: undefined as Employee | undefined,
    employeeLoading: false,
    employeeError: undefined as unknown,
    employmentHistory: undefined as EmploymentPeriodSummary[] | undefined,
    employmentHistoryLoading: false,
    employmentHistoryError: false,
    refetchEmploymentHistory: vi.fn(),
    disciplinaryRecordsError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],

  useGetEmployee: () => ({
    data: state.employee,
    isLoading: state.employeeLoading,
    error: state.employeeError,
    refetch: vi.fn(),
  }),
  getGetEmployeeQueryKey: (orgId: number, id: number) => ['employee', orgId, id],
  useUpdateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadEmployeeProfilePicture: () => ({ mutate: vi.fn(), isPending: false }),
  useLinkEmployeeToUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkEmployeeFromUser: () => ({ mutate: vi.fn(), isPending: false }),
  useSeparateEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  useRehireEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  getRemoveEmployeeProfilePictureUrl: (orgId: number, id: number) => `/api/organizations/${orgId}/employees/${id}/profile-picture`,

  useListMembers: () => ({ data: [] }),
  getListMembersQueryKey: (orgId: number) => ['members', orgId],
  useListMasterDataItems: () => ({ data: [] }),
  getListMasterDataItemsQueryKey: (orgId: number, domain: string) => ['masterDataItems', orgId, domain],

  useListEmployeeDocuments: () => ({ data: [] }),
  getListEmployeeDocumentsQueryKey: (orgId: number, empId: number) => ['employeeDocuments', orgId, empId],
  useUploadEmployeeDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEmployeeDocument: () => ({ mutate: vi.fn(), isPending: false }),

  useListEmployeeSkills: () => ({ data: [] }),
  getListEmployeeSkillsQueryKey: (orgId: number, empId: number) => ['employeeSkills', orgId, empId],
  useAddEmployeeSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEmployeeSkill: () => ({ mutate: vi.fn(), isPending: false }),

  useListEmployeeQualifications: () => ({ data: [] }),
  getListEmployeeQualificationsQueryKey: (orgId: number, empId: number) => ['employeeQualifications', orgId, empId],
  useAddEmployeeQualification: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEmployeeQualification: () => ({ mutate: vi.fn(), isPending: false }),

  useListEmployeeCertifications: () => ({ data: [] }),
  getListEmployeeCertificationsQueryKey: (orgId: number, empId: number) => ['employeeCertifications', orgId, empId],
  useAddEmployeeCertification: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEmployeeCertification: () => ({ mutate: vi.fn(), isPending: false }),

  // Employment History (Phase 3F, W105) — the feature under test.
  useListEmployeeEmploymentHistory: () => ({
    data: state.employmentHistory,
    isLoading: state.employmentHistoryLoading,
    isError: state.employmentHistoryError,
    refetch: state.refetchEmploymentHistory,
  }),
  getListEmployeeEmploymentHistoryQueryKey: (orgId: number, empId: number) => ['employeeEmploymentHistory', orgId, empId],

  useTransferEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  usePromoteEmployee: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmEmployee: () => ({ mutate: vi.fn(), isPending: false }),

  useListDepartments: () => ({ data: [] }),
  getListDepartmentsQueryKey: (orgId: number) => ['departments', orgId],
  useListBranches: () => ({ data: [] }),
  getListBranchesQueryKey: (orgId: number) => ['branches', orgId],
  useListPositions: () => ({ data: [] }),
  getListPositionsQueryKey: (orgId: number) => ['positions', orgId],

  useListEmployeeDisciplinaryRecords: () => ({ data: [], error: state.disciplinaryRecordsError }),
  getListEmployeeDisciplinaryRecordsQueryKey: (orgId: number, empId: number) => ['employeeDisciplinaryRecords', orgId, empId],
  useAddEmployeeDisciplinaryRecord: () => ({ mutate: vi.fn(), isPending: false }),

  useListEmployeeExitProcesses: () => ({ data: [] }),
  getListEmployeeExitProcessesQueryKey: (orgId: number, empId: number) => ['employeeExitProcesses', orgId, empId],
  useCreateEmployeeExitProcess: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEmployeeExitProcess: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function baseEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 42,
    organizationId: 10,
    employeeNumber: 'EMP-0001',
    hasProfilePicture: false,
    firstName: 'Ada',
    lastName: 'Lovelace',
    workEmail: 'ada@work.example.com',
    phoneNumber: null,
    departmentName: null,
    branchName: null,
    positionName: null,
    employmentType: 'full_time',
    hireDate: null,
    probationEndDate: null,
    employmentStatus: 'active',
    workLocation: null,
    separationDate: null,
    separationReason: null,
    linkedApplicationUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function historyRow(overrides: Partial<EmploymentPeriodSummary> = {}): EmploymentPeriodSummary {
  return {
    id: 1,
    eventType: 'transfer',
    effectiveDate: '2026-01-15',
    previousState: null,
    newState: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function resetState() {
  state.employee = baseEmployee();
  state.employeeLoading = false;
  state.employeeError = undefined;
  state.employmentHistory = [];
  state.employmentHistoryLoading = false;
  state.employmentHistoryError = false;
  state.refetchEmploymentHistory = vi.fn();
  state.disciplinaryRecordsError = undefined;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/employees/42', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/employees/:id">{() => <EmployeeDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Employee detail page', () => {
  it('renders without crashing and shows the employee name', () => {
    resetState();
    renderPage();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Employment History')).toBeInTheDocument();
  });

  describe('Employment History card (Phase 3F, W105)', () => {
    it('shows a loading state', () => {
      resetState();
      state.employmentHistoryLoading = true;
      state.employmentHistory = undefined;
      renderPage();
      expect(screen.getByTestId('loading-employment-history')).toBeInTheDocument();
    });

    it('shows an empty state with the exact copy when there is no history', () => {
      resetState();
      state.employmentHistory = [];
      renderPage();
      const empty = screen.getByTestId('text-no-employment-history');
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveTextContent('No employment history recorded yet.');
    });

    it('shows an error state via QueryError', () => {
      resetState();
      state.employmentHistoryError = true;
      state.employmentHistory = undefined;
      renderPage();
      expect(screen.getByText('Failed to load employment history')).toBeInTheDocument();
    });

    it('lists every row with its event type visible, most recent items included', () => {
      resetState();
      state.employmentHistory = [
        historyRow({ id: 1, eventType: 'transfer', effectiveDate: '2026-03-01' }),
        historyRow({ id: 2, eventType: 'promotion', effectiveDate: '2026-01-15' }),
        historyRow({ id: 3, eventType: 'confirmation', effectiveDate: '2025-11-01' }),
      ];
      renderPage();

      const list = screen.getByTestId('list-employment-history');
      expect(list).toBeInTheDocument();

      const rows = screen.getAllByTestId(/^row-employment-history-\d+$/);
      expect(rows).toHaveLength(3);

      expect(within(screen.getByTestId('row-employment-history-1')).getByText('transfer')).toBeInTheDocument();
      expect(within(screen.getByTestId('row-employment-history-2')).getByText('promotion')).toBeInTheDocument();
      expect(within(screen.getByTestId('row-employment-history-3')).getByText('confirmation')).toBeInTheDocument();
    });

    it('is strictly read-only — no add/edit/remove controls inside this card', () => {
      resetState();
      state.employmentHistory = [
        historyRow({ id: 1, eventType: 'transfer', effectiveDate: '2026-03-01' }),
        historyRow({ id: 2, eventType: 'promotion', effectiveDate: '2026-01-15' }),
      ];
      renderPage();

      const list = screen.getByTestId('list-employment-history');
      const card = list.closest('.rounded-xl');
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    });
  });
});
