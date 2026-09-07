/**
 * Tests for the Attendance Register page (Phase 3B, W69).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttendanceRegister from '@/pages/attendance-register';
import type { AttendanceRegisterResponse, Employee, MembershipSummary, DailyAttendanceSummaryStatus } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    employees: [] as Employee[],
    departments: [] as { id: number; name: string }[],
    branches: [] as { id: number; name: string }[],
    register: undefined as AttendanceRegisterResponse | undefined,
    registerLoading: false,
    registerError: undefined as unknown,
    registerCalls: [] as unknown[],
    adjustmentMutate: vi.fn() as (...args: unknown[]) => void,
    adjustmentPending: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListEmployees: () => ({ data: { items: state.employees, total: state.employees.length, page: 1, pageSize: 200 } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListBranches: () => ({ data: state.branches }),
  getListBranchesQueryKey: () => ['branches'],
  useListAttendanceRegister: (_orgId: number, params: unknown) => {
    state.registerCalls.push(params);
    return { data: state.register, isLoading: state.registerLoading, error: state.registerError, refetch: vi.fn() };
  },
  getListAttendanceRegisterQueryKey: () => ['attendanceRegister'],
  useRecordAttendanceAdjustment: () => ({ mutate: state.adjustmentMutate, isPending: state.adjustmentPending }),
  RecordAttendanceAdjustmentInputAdjustmentType: {
    manual_clock_in: 'manual_clock_in',
    manual_clock_out: 'manual_clock_out',
    mark_present: 'mark_present',
    mark_absent: 'mark_absent',
    excuse_absence: 'excuse_absence',
  },
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, permissions: [], isPrimaryHr: false };
}

function baseEmployee(id: number, firstName: string, lastName: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    organizationId: 10,
    firstName,
    lastName,
    employeeNumber: `EMP-${id}`,
    employmentType: 'full_time',
    employmentStatus: 'active',
    departmentName: 'Engineering',
    ...overrides,
  } as Employee;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceRegister />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['employee'])];
  state.employees = [baseEmployee(1, 'Ada', 'Lovelace')];
  state.departments = [];
  state.branches = [];
  state.register = { items: [], total: 0, page: 1, pageSize: 20 };
  state.registerLoading = false;
  state.registerError = undefined;
  state.registerCalls = [];
  state.adjustmentMutate = vi.fn();
  state.adjustmentPending = false;
}

describe('Attendance Register page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.registerLoading = true;
    renderPage();
    expect(screen.getByText('Attendance Register')).toBeInTheDocument();
  });

  it('shows an error state', () => {
    resetState();
    state.registerError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load the attendance register/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no rows for the selection', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no attendance records for this selection/i)).toBeInTheDocument();
  });

  it('renders register rows with employee name, status, and clock times', () => {
    resetState();
    state.register = {
      items: [
        {
          employeeId: 1,
          summaries: [
            {
              organizationId: 10,
              employeeId: 1,
              date: '2026-03-05',
              status: 'present',
              firstClockIn: '2026-03-05T09:00:00.000Z',
              lastClockOut: '2026-03-05T17:00:00.000Z',
              workedMinutes: 480,
              lateMinutes: 0,
              earlyDepartureMinutes: 0,
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    renderPage();
    const row = screen.getByTestId('row-attendance-register-1-2026-03-05');
    expect(row).toHaveTextContent('Ada Lovelace');
    expect(row).toHaveTextContent('Present');
    expect(row).toHaveTextContent('480');
  });

  it('renders every W66 summary state with a human-readable label, including null as Not Applicable', () => {
    resetState();
    const statuses: DailyAttendanceSummaryStatus[] = ['present', 'late', 'partial', 'absent', 'on_leave', 'holiday', 'non_working_day', null];
    state.register = {
      items: [
        {
          employeeId: 1,
          summaries: statuses.map((status, i) => ({
            organizationId: 10,
            employeeId: 1,
            date: `2026-01-0${i + 1}`,
            status,
            firstClockIn: null,
            lastClockOut: null,
            workedMinutes: null,
            lateMinutes: null,
            earlyDepartureMinutes: null,
          })),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    renderPage();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Absent')).toBeInTheDocument();
    expect(screen.getByText('On Leave')).toBeInTheDocument();
    expect(screen.getByText('Holiday')).toBeInTheDocument();
    expect(screen.getByText('Non-Working Day')).toBeInTheDocument();
    expect(screen.getByText('Not Applicable')).toBeInTheDocument();
  });

  it('shows pagination controls when there is more than one page', () => {
    resetState();
    state.register = {
      items: [
        {
          employeeId: 1,
          summaries: [
            {
              organizationId: 10,
              employeeId: 1,
              date: '2026-03-05',
              status: 'present',
              firstClockIn: null,
              lastClockOut: null,
              workedMinutes: null,
              lateMinutes: null,
              earlyDepartureMinutes: null,
            },
          ],
        },
      ],
      total: 45,
      page: 1,
      pageSize: 20,
    };
    renderPage();
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByTestId('button-prev-page')).toBeDisabled();
    expect(screen.getByTestId('button-next-page')).not.toBeDisabled();
  });

  it('shows the Add Entry manual-entry action for an HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['hr_manager'])];
    renderPage();
    expect(screen.getByTestId('button-add-attendance-entry')).toBeInTheDocument();
  });

  it('hides the Add Entry action for a plain employee role (avoids the employeeId-mismatch trap)', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.queryByTestId('button-add-attendance-entry')).not.toBeInTheDocument();
  });

  it('disables manual-entry submission until required fields are filled, then submits with the chosen employeeId', async () => {
    resetState();
    state.myOrganizations = [membership(['org_admin'])];
    state.employees = [baseEmployee(1, 'Ada', 'Lovelace'), baseEmployee(2, 'Bob', 'Smith')];
    renderPage();

    await userEvent.click(screen.getByTestId('button-add-attendance-entry'));
    const submit = screen.getByTestId('button-submit-attendance-entry');
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByTestId('select-entry-employee'));
    await userEvent.click(screen.getByRole('option', { name: 'Bob Smith' }));
    await userEvent.click(screen.getByTestId('select-entry-type'));
    await userEvent.click(screen.getByRole('option', { name: 'Mark present' }));
    await userEvent.type(screen.getByTestId('input-entry-reason'), 'Confirmed present via manager');

    // Native date input — userEvent.type doesn't drive it reliably, so this
    // uses fireEvent.change with a safely-past date (component's own
    // max={today} constraint mirrors ESS's own correction form).
    const dateInput = screen.getByTestId('input-entry-date');
    fireEvent.change(dateInput, { target: { value: '2024-01-05' } });

    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);

    expect(state.adjustmentMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 10,
        data: expect.objectContaining({ employeeId: 2, adjustmentType: 'mark_present', reason: 'Confirmed present via manager' }),
      }),
      expect.anything(),
    );
  });
});
