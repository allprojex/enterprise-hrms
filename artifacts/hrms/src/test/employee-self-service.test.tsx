/**
 * Tests for the Employee Self-Service page (Phase 2B, W39).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made. MyLeave is embedded directly as the "My Leave" tab, so
 * its own hooks are stubbed here too rather than mocking the child component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeSelfService from '@/pages/employee-self-service';
import type { SelfServiceEmployeeProfile, OrganizationModule } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myEmployee: undefined as { linked: boolean; employee: SelfServiceEmployeeProfile | null } | undefined,
    myEmployeeLoading: false,
    myEmployeeError: undefined as unknown,
    modules: [] as OrganizationModule[],
    documents: [] as unknown[],
    documentsLoading: false,
    documentsError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetMyEmployee: () => ({ data: state.myEmployee, isLoading: state.myEmployeeLoading, error: state.myEmployeeError, refetch: vi.fn() }),
  getGetMyEmployeeQueryKey: () => ['getMyEmployee'],
  useListOrganizationModules: () => ({ data: state.modules }),
  getListOrganizationModulesQueryKey: (id: number) => ['organizationModules', id],
  useListEmployeeDocuments: () => ({ data: state.documents, isLoading: state.documentsLoading, error: state.documentsError, refetch: vi.fn() }),
  getListEmployeeDocumentsQueryKey: (orgId: number, empId: number) => ['employeeDocuments', orgId, empId],
  // My Leave (embedded tab) — stubbed minimally, not under test here.
  useListLeaveTypes: () => ({ data: [] }),
  getListLeaveTypesQueryKey: () => ['leaveTypes'],
  useListLeaveRequests: () => ({ data: [], isLoading: false }),
  getListLeaveRequestsQueryKey: () => ['leaveRequests'],
  useListLeaveBalances: () => ({ data: [] }),
  getListLeaveBalancesQueryKey: () => ['leaveBalances'],
  useCreateLeaveRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelLeaveRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));

function baseEmployee(overrides: Partial<SelfServiceEmployeeProfile> = {}): SelfServiceEmployeeProfile {
  return {
    id: 42,
    employeeNumber: 'EMP-0001',
    hasProfilePicture: false,
    firstName: 'Ada',
    middleName: null,
    lastName: 'Lovelace',
    preferredName: null,
    gender: 'female',
    dateOfBirth: null,
    maritalStatus: null,
    nationality: null,
    personalEmail: null,
    workEmail: 'ada@work.example.com',
    phoneNumber: null,
    alternatePhoneNumber: null,
    residentialAddress: null,
    emergencyContacts: null,
    departmentId: null,
    departmentName: null,
    branchId: null,
    branchName: null,
    positionId: null,
    positionName: null,
    reportingManagerId: null,
    reportingManagerName: null,
    employmentType: 'full_time',
    hireDate: null,
    probationEndDate: null,
    employmentStatus: 'active',
    workLocation: null,
    separationDate: null,
    separationReason: null,
    ...overrides,
  };
}

function mod(overrides: Partial<OrganizationModule> & { key: string }): OrganizationModule {
  return {
    id: 1,
    name: overrides.key,
    description: '',
    category: 'hr-operations',
    version: '1.0.0',
    status: 'hidden',
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
    enabled: false,
    ...overrides,
  };
}

function renderEss() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmployeeSelfService />
    </QueryClientProvider>,
  );
}

describe('Employee Self-Service page', () => {
  it('shows a loading state without crashing', () => {
    state.myEmployeeLoading = true;
    state.myEmployeeError = undefined;
    state.myEmployee = undefined;
    renderEss();
    expect(screen.queryByText('Employee Self-Service')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = { error: 'boom' };
    state.myEmployee = undefined;
    renderEss();
    expect(screen.getByText(/could not load your employee self-service data/i)).toBeInTheDocument();
  });

  it('shows the controlled contact-HR message when the caller is not linked', () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: false, employee: null };
    renderEss();
    expect(screen.getByText(/not yet been linked to an employee record/i)).toBeInTheDocument();
    expect(screen.queryByText('My Profile')).not.toBeInTheDocument();
  });

  it('renders My Profile, My Leave, and My Documents tabs for a linked user', () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true })];
    state.documents = [];
    renderEss();
    expect(screen.getByTestId('tab-my-profile')).toBeInTheDocument();
    expect(screen.getByTestId('tab-my-leave')).toBeInTheDocument();
    expect(screen.getByTestId('tab-my-documents')).toBeInTheDocument();
    // My Profile is the default tab.
    expect(screen.getByText('ada@work.example.com')).toBeInTheDocument();
  });

  it('does not render any edit control for core profile fields', () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true })];
    state.documents = [];
    renderEss();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('handles a disabled Leave module cleanly instead of a broken page', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: false })];
    state.documents = [];
    renderEss();
    await userEvent.click(screen.getByTestId('tab-my-leave'));
    expect(screen.getByText(/leave isn't enabled/i)).toBeInTheDocument();
  });

  it('shows an empty-state, not a crash, when the linked employee has no documents', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true })];
    state.documents = [];
    state.documentsLoading = false;
    state.documentsError = undefined;
    renderEss();
    await userEvent.click(screen.getByTestId('tab-my-documents'));
    expect(screen.getByText(/no documents on file/i)).toBeInTheDocument();
  });
});
