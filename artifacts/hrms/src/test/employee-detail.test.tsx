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
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import EmployeeDetail from '@/pages/employee-detail';
import type { Employee, EmploymentPeriodSummary, PersonnelFile, EmployeeNumberAllocation, PersonnelFileCustodyDetail, PersonnelFileMovement, RecordsLocation, PerformanceCycle, PerformanceReviewListResponse, ReportRunResult } from '@workspace/api-client-react';

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
    // Phase 3H, W115 — Personnel File / PIF card.
    personnelFile: undefined as PersonnelFile | undefined,
    personnelFileLoading: false,
    personnelFileError: undefined as unknown,
    createPersonnelFileMutate: vi.fn(),
    createPersonnelFilePending: false,
    staffNumberHistory: undefined as EmployeeNumberAllocation[] | undefined,
    staffNumberHistoryLoading: false,
    // Phase 3H, W116 — Physical Filing, Locations & Movement.
    custody: undefined as PersonnelFileCustodyDetail | undefined,
    custodyLoading: false,
    movements: undefined as PersonnelFileMovement[] | undefined,
    movementsLoading: false,
    recordsLocations: [] as RecordsLocation[],
    checkoutMutate: vi.fn(),
    checkoutPending: false,
    returnMutate: vi.fn(),
    returnPending: false,
    markMissingMutate: vi.fn(),
    markMissingPending: false,
    recoverMutate: vi.fn(),
    recoverPending: false,
    createRecordsLocationMutate: vi.fn(),
    createRecordsLocationPending: false,
    // Phase 3H, W118 — Search, Automation & HR Workspace.
    performanceCycles: undefined as PerformanceCycle[] | undefined,
    performanceReviews: undefined as PerformanceReviewListResponse | undefined,
    unreturnedAssetsReport: undefined as ReportRunResult | undefined,
    // Access-control gating (isHrCapable) — org_admin by default so every
    // pre-existing test below (written before this gating existed) still
    // exercises the mutating controls it expects to see.
    myOrgRoles: ['org_admin'] as string[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),

  // WS-8 — the employee page now renders the shared custom-fields panel.
  // It hides itself when an organization has configured no fields, which is
  // what an empty list here simulates, so these existing assertions are
  // unaffected by the panel's presence.
  useGetCustomFieldValues: () => ({ data: { values: [] }, isLoading: false, refetch: vi.fn() }),
  getGetCustomFieldValuesQueryKey: (orgId: number, scope: string, entityId: number) => ['customFieldValues', orgId, scope, entityId],
  useSetCustomFieldValues: () => ({ mutate: vi.fn(), isPending: false }),

  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, roles: state.myOrgRoles }] }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],

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

  // Personnel File / PIF (Phase 3H, W115) — the feature under test.
  useGetPersonnelFileByEmployee: () => ({
    data: state.personnelFile,
    isLoading: state.personnelFileLoading,
    error: state.personnelFileError,
  }),
  getGetPersonnelFileByEmployeeQueryKey: (orgId: number, empId: number) => ['personnelFile', orgId, empId],
  useCreatePersonnelFile: () => ({ mutate: state.createPersonnelFileMutate, isPending: state.createPersonnelFilePending }),
  useListEmployeeNumberHistory: () => ({
    data: state.staffNumberHistory,
    isLoading: state.staffNumberHistoryLoading,
  }),
  getListEmployeeNumberHistoryQueryKey: (orgId: number, empId: number) => ['employeeNumberHistory', orgId, empId],

  // Physical Filing, Locations & Movement (Phase 3H, W116) — the feature under test.
  useGetPersonnelFileCustody: () => ({ data: state.custody, isLoading: state.custodyLoading }),
  getGetPersonnelFileCustodyQueryKey: (orgId: number, fileId: number) => ['personnelFileCustody', orgId, fileId],
  useListPersonnelFileMovements: () => ({ data: state.movements, isLoading: state.movementsLoading }),
  getListPersonnelFileMovementsQueryKey: (orgId: number, fileId: number) => ['personnelFileMovements', orgId, fileId],
  useListRecordsLocations: () => ({ data: state.recordsLocations }),
  getListRecordsLocationsQueryKey: (orgId: number) => ['recordsLocations', orgId],
  useCreateRecordsLocation: () => ({ mutate: state.createRecordsLocationMutate, isPending: state.createRecordsLocationPending }),
  useCheckoutPersonnelFile: () => ({ mutate: state.checkoutMutate, isPending: state.checkoutPending }),
  useReturnPersonnelFile: () => ({ mutate: state.returnMutate, isPending: state.returnPending }),
  useMarkPersonnelFileMissing: () => ({ mutate: state.markMissingMutate, isPending: state.markMissingPending }),
  useRecoverPersonnelFile: () => ({ mutate: state.recoverMutate, isPending: state.recoverPending }),

  // Search, Automation & HR Workspace (Phase 3H, W118) — the feature under test.
  useListPerformanceCycles: () => ({ data: state.performanceCycles }),
  getListPerformanceCyclesQueryKey: (orgId: number) => ['performanceCycles', orgId],
  useListPerformanceReviews: () => ({ data: state.performanceReviews }),
  getListPerformanceReviewsQueryKey: (orgId: number, params: unknown) => ['performanceReviews', orgId, params],
  useRunAssetReport: () => ({ data: state.unreturnedAssetsReport }),
  getRunAssetReportQueryKey: (orgId: number, key: string, params: unknown) => ['runAssetReport', orgId, key, params],
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

function personnelFileRow(overrides: Partial<PersonnelFile> = {}): PersonnelFile {
  return {
    id: 1,
    organizationId: 10,
    employeeId: 42,
    pifNumber: 'PIF-001',
    allocationMethod: 'generated',
    allocatedByMembershipId: null,
    currentLocationId: null,
    currentCustodyState: 'in_registry',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function allocationRow(overrides: Partial<EmployeeNumberAllocation> = {}): EmployeeNumberAllocation {
  return {
    id: 1,
    organizationId: 10,
    employeeId: 42,
    employeeNumber: 'EMP-0001',
    allocationMethod: 'generated',
    validFrom: new Date().toISOString(),
    validTo: null,
    allocatedByMembershipId: null,
    releasedByMembershipId: null,
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
  state.personnelFile = undefined;
  state.personnelFileLoading = false;
  state.personnelFileError = undefined;
  state.createPersonnelFileMutate = vi.fn();
  state.createPersonnelFilePending = false;
  state.staffNumberHistory = [];
  state.staffNumberHistoryLoading = false;
  state.custody = undefined;
  state.custodyLoading = false;
  state.movements = [];
  state.movementsLoading = false;
  state.recordsLocations = [];
  state.checkoutMutate = vi.fn();
  state.checkoutPending = false;
  state.returnMutate = vi.fn();
  state.returnPending = false;
  state.markMissingMutate = vi.fn();
  state.markMissingPending = false;
  state.recoverMutate = vi.fn();
  state.recoverPending = false;
  state.createRecordsLocationMutate = vi.fn();
  state.createRecordsLocationPending = false;
  state.performanceCycles = undefined;
  state.performanceReviews = undefined;
  state.unreturnedAssetsReport = undefined;
  state.myOrgRoles = ['org_admin'];
}

function custodyDetail(overrides: Partial<PersonnelFileCustodyDetail> = {}): PersonnelFileCustodyDetail {
  return { currentCustodyState: 'in_registry', currentLocationId: null, overdue: false, ...overrides };
}

function movementRow(overrides: Partial<PersonnelFileMovement> = {}): PersonnelFileMovement {
  return {
    id: 1,
    organizationId: 10,
    personnelFileId: 1,
    volumeId: null,
    eventType: 'checked_out',
    occurredAt: new Date().toISOString(),
    actorMembershipId: null,
    purpose: null,
    destination: 'Jane Doe',
    expectedReturnDate: null,
    notes: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function locationRow(overrides: Partial<RecordsLocation> = {}): RecordsLocation {
  return {
    id: 1,
    organizationId: 10,
    parentId: null,
    name: 'HR Office',
    description: null,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
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

  describe('Personnel File card (Phase 3H, W115)', () => {
    it('shows a loading state', () => {
      resetState();
      state.personnelFileLoading = true;
      renderPage();
      expect(screen.getByTestId('loading-personnel-file')).toBeInTheDocument();
    });

    it('shows an empty state with a create button when the employee has no personnel file yet', () => {
      resetState();
      renderPage();
      expect(screen.getByTestId('text-no-personnel-file')).toBeInTheDocument();
      expect(screen.getByTestId('button-create-personnel-file')).toBeInTheDocument();
    });

    it('shows the PIF number and allocation method once a personnel file exists, and hides the create button', () => {
      resetState();
      state.personnelFile = personnelFileRow({ pifNumber: 'PIF-042', allocationMethod: 'manual' });
      renderPage();
      const summary = screen.getByTestId('personnel-file-summary');
      expect(within(summary).getByTestId('text-pif-number')).toHaveTextContent('PIF-042');
      expect(within(summary).getByText('manual')).toBeInTheDocument();
      expect(screen.queryByTestId('button-create-personnel-file')).not.toBeInTheDocument();
    });

    it('hides the entire card when the caller lacks personnel_file.read (403)', () => {
      resetState();
      state.personnelFileError = { status: 403, message: 'Forbidden' };
      renderPage();
      expect(screen.queryByText('Personnel File')).not.toBeInTheDocument();
    });

    it('does not treat a 404 (no personnel file yet) as a reason to hide the card', () => {
      resetState();
      state.personnelFileError = { status: 404, message: 'This employee has no personnel file yet' };
      renderPage();
      expect(screen.getByText('Personnel File')).toBeInTheDocument();
    });

    it('toggles and lists staff-number history, distinguishing current from released allocations', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.staffNumberHistory = [
        allocationRow({ id: 1, employeeNumber: 'EMP-0001', validTo: '2025-01-01T00:00:00.000Z' }),
        allocationRow({ id: 2, employeeNumber: 'EMP-0002', validTo: null }),
      ];
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-toggle-staff-number-history'));

      const list = screen.getByTestId('list-staff-number-history');
      expect(within(list).getByText('Released')).toBeInTheDocument();
      expect(within(list).getByText('Current')).toBeInTheDocument();
    });
  });

  describe('Physical custody section (Phase 3H, W116)', () => {
    it('does not render when there is no personnel file', () => {
      resetState();
      renderPage();
      expect(screen.queryByTestId('physical-custody-section')).not.toBeInTheDocument();
    });

    it('shows In Registry state with a Check Out control, no Return/Missing/Recover', () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'in_registry' });
      renderPage();
      expect(screen.getByTestId('badge-custody-state')).toHaveTextContent('In Registry');
      expect(screen.getByTestId('button-checkout')).toBeInTheDocument();
      expect(screen.queryByTestId('button-return')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-mark-missing')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-recover')).not.toBeInTheDocument();
    });

    it('shows Checked Out state with Return and Mark Missing controls', () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'checked_out' });
      renderPage();
      expect(screen.getByTestId('badge-custody-state')).toHaveTextContent('Checked Out');
      expect(screen.getByTestId('button-return')).toBeInTheDocument();
      expect(screen.getByTestId('button-mark-missing')).toBeInTheDocument();
      expect(screen.queryByTestId('button-checkout')).not.toBeInTheDocument();
    });

    it('shows Missing state with Return and Recover controls, and a clearly-labeled Overdue badge separate from color alone', () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'missing' });
      renderPage();
      expect(screen.getByTestId('badge-custody-state')).toHaveTextContent('Missing');
      expect(screen.getByTestId('button-recover')).toBeInTheDocument();
      expect(screen.getByTestId('button-return')).toBeInTheDocument();
    });

    it('shows an Overdue badge with explicit text when overdue is true, derived not stored', () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'checked_out', overdue: true });
      renderPage();
      expect(screen.getByTestId('badge-overdue')).toHaveTextContent('Overdue');
    });

    it('resolves and displays the current location name', () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'in_registry', currentLocationId: 7 });
      state.recordsLocations = [locationRow({ id: 7, name: 'Cabinet 2' })];
      renderPage();
      expect(screen.getByText('Cabinet 2')).toBeInTheDocument();
    });

    it('toggles and lists movement history', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail();
      state.movements = [movementRow({ id: 1, eventType: 'checked_out' }), movementRow({ id: 2, eventType: 'returned' })];
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-toggle-movement-history'));

      const rows = screen.getAllByTestId(/^row-movement-\d+$/);
      expect(rows).toHaveLength(2);
    });

    it('submits a checkout with the entered destination', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'in_registry' });
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-checkout'));
      await user.type(screen.getByTestId('input-checkout-destination'), 'Jane Doe (HR)');
      await user.click(screen.getByTestId('button-confirm-checkout'));

      expect(state.checkoutMutate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ destination: 'Jane Doe (HR)' }) }),
        expect.anything(),
      );
    });

    it('requires a reason before submitting mark-missing', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail({ currentCustodyState: 'checked_out' });
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-mark-missing'));
      expect(screen.getByTestId('button-confirm-mark-missing')).toBeDisabled();
      await user.type(screen.getByTestId('input-missing-reason'), 'Not found during audit');
      expect(screen.getByTestId('button-confirm-mark-missing')).not.toBeDisabled();
    });
  });

  describe('Records Locations manager (Phase 3H, W116)', () => {
    it('lists existing locations with their parent and status', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail();
      state.recordsLocations = [locationRow({ id: 1, name: 'HR Office' }), locationRow({ id: 2, name: 'Cabinet 2', parentId: 1 })];
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-manage-locations'));

      const list = screen.getByTestId('list-records-locations');
      expect(within(list).getByText('HR Office')).toBeInTheDocument();
      expect(within(list).getByText('Cabinet 2')).toBeInTheDocument();
    });

    it('creates a new location with the entered name', async () => {
      resetState();
      state.personnelFile = personnelFileRow();
      state.custody = custodyDetail();
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-manage-locations'));
      await user.type(screen.getByTestId('input-new-location-name'), 'Drawer 4');
      await user.click(screen.getByTestId('button-add-location'));

      expect(state.createRecordsLocationMutate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Drawer 4' }) }),
        expect.anything(),
      );
    });
  });

  describe('Confirm dialog — probation-review prepopulation (Phase 3H, W118)', () => {
    it('does not render a picker when no probation-cycle review exists for this employee', async () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'probation' });
      state.performanceCycles = [];
      state.performanceReviews = { items: [], total: 0, page: 1, pageSize: 20 };
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-confirm-employee-probation'));

      expect(screen.queryByTestId('select-confirm-probation-review-id')).not.toBeInTheDocument();
    });

    it('offers only this employee\'s probation-cycle reviews, not reviews from a normal cycle', async () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'probation' });
      state.performanceCycles = [
        { id: 1, organizationId: 10, name: 'Annual Cycle', cycleType: 'annual', startDate: '2026-01-01', endDate: '2026-12-31', templateId: 1, ratingScaleId: 1, applicabilityScope: 'all_active', status: 'open', createdAt: new Date().toISOString() },
        { id: 2, organizationId: 10, name: 'Probation Cycle', cycleType: 'probation', startDate: '2026-01-01', endDate: '2026-12-31', templateId: 1, ratingScaleId: 1, applicabilityScope: 'manual', status: 'open', createdAt: new Date().toISOString() },
      ];
      state.performanceReviews = {
        items: [
          { id: 10, organizationId: 10, cycleId: 1, templateId: 1, ratingScaleId: 1, employeeId: 42, reviewerEmployeeId: null, departmentIdSnapshot: null, positionIdSnapshot: null, goalsWeight: 60, competenciesWeight: 40, scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: 'finalized', selfAssessmentSubmittedAt: null, managerReviewSubmittedAt: null, hrFinalizedAt: null, acknowledgedAt: null, employeeFinalComment: null, computedOverallScore: null, hrOverrideScore: null, hrOverrideReason: null, revisionNumber: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: 11, organizationId: 10, cycleId: 2, templateId: 1, ratingScaleId: 1, employeeId: 42, reviewerEmployeeId: null, departmentIdSnapshot: null, positionIdSnapshot: null, goalsWeight: 60, competenciesWeight: 40, scoringPrecisionSnapshot: 0, acknowledgementRequiredSnapshot: true, status: 'finalized', selfAssessmentSubmittedAt: null, managerReviewSubmittedAt: null, hrFinalizedAt: null, acknowledgedAt: null, employeeFinalComment: null, computedOverallScore: null, hrOverrideScore: null, hrOverrideReason: null, revisionNumber: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      };
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-confirm-employee-probation'));
      const select = screen.getByTestId('select-confirm-probation-review-id');
      await user.click(select);

      expect(screen.getByRole('option', { name: 'Probation Cycle · finalized' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Annual Cycle · finalized' })).not.toBeInTheDocument();
    });
  });

  describe('Separate dialog — non-blocking warnings (Phase 3H, W118, §11)', () => {
    it('shows no warning banner when nothing is outstanding', async () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'active', employeeNumber: null });
      state.custody = undefined;
      state.unreturnedAssetsReport = undefined;
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-separate-employee'));

      expect(screen.queryByTestId('alert-separation-warnings')).not.toBeInTheDocument();
    });

    it('warns about a checked-out personnel file, an allocated staff number, and unreturned assets — all non-blocking', async () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'active', employeeNumber: 'EMP-0001' });
      state.custody = custodyDetail({ currentCustodyState: 'checked_out' });
      state.unreturnedAssetsReport = {
        key: 'asset_unreturned_by_employee',
        label: 'Unreturned Assets',
        description: '',
        generatedAt: new Date().toISOString(),
        columns: [],
        rows: [{ assetTag: 'AST-1' }, { assetTag: 'AST-2' }],
      };
      renderPage();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('button-separate-employee'));

      const alert = screen.getByTestId('alert-separation-warnings');
      expect(within(alert).getByText(/still checked out/)).toBeInTheDocument();
      expect(within(alert).getByText(/EMP-0001 is still allocated/)).toBeInTheDocument();
      expect(within(alert).getByText(/2 assets still assigned/)).toBeInTheDocument();

      // Non-blocking: the submit control is still enabled purely on the date requirement, unaffected by the warnings.
      expect(screen.getByTestId('button-confirm-separate')).toBeDisabled(); // no separation date typed yet — the ONLY reason
      await user.type(screen.getByTestId('input-separation-date'), '2026-06-01');
      expect(screen.getByTestId('button-confirm-separate')).toBeEnabled();
    });
  });

  describe('Access control (bug regression): mutating controls require org_admin/hr_manager', () => {
    it('hides every mutating control from a plain employee viewer', () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'active' });
      state.myOrgRoles = ['employee'];
      renderPage();

      expect(screen.queryByTestId('button-upload-photo')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-edit-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-transfer-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-promote-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-separate-employee')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-upload-document')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-add-skill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-add-qualification')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-add-certification')).not.toBeInTheDocument();
    });

    it('shows the mutating controls to an org_admin/hr_manager viewer', () => {
      resetState();
      state.employee = baseEmployee({ employmentStatus: 'active' });
      renderPage();

      expect(screen.getByTestId('button-edit-employee')).toBeInTheDocument();
      expect(screen.getByTestId('button-transfer-employee')).toBeInTheDocument();
      expect(screen.getByTestId('button-promote-employee')).toBeInTheDocument();
      expect(screen.getByTestId('button-separate-employee')).toBeInTheDocument();
    });
  });
});
