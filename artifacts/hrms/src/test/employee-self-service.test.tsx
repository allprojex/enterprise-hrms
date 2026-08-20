/**
 * Tests for the Employee Self-Service page (Phase 2B, W39).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made. MyLeave is embedded directly as the "My Leave" tab, so
 * its own hooks are stubbed here too rather than mocking the child component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    internalVacancies: undefined as unknown,
    internalVacanciesError: undefined as unknown,
    myInternalApplications: undefined as unknown,
    applyMutate: vi.fn() as (...args: unknown[]) => void,
    attendanceEvents: [] as unknown[],
    attendanceEventsError: undefined as unknown,
    attendanceSummary: [] as unknown[],
    attendanceSummaryLoading: false,
    attendanceSummaryError: undefined as unknown,
    clockMutate: vi.fn() as (...args: unknown[]) => void,
    clockPending: false,
    requestMutate: vi.fn() as (...args: unknown[]) => void,
    requestPending: false,
    myReviews: [] as unknown[],
    myReviewsLoading: false,
    myReviewsError: undefined as unknown,
    reviewDetail: undefined as unknown,
    reviewDetailLoading: false,
    reviewDetailError: undefined as unknown,
    ratingScale: undefined as unknown,
    rateMutate: vi.fn() as (...args: unknown[]) => void,
    createGoalMutate: vi.fn() as (...args: unknown[]) => void,
    updateGoalMutate: vi.fn() as (...args: unknown[]) => void,
    submitMutate: vi.fn() as (...args: unknown[]) => void,
    submitPending: false,
    submitError: undefined as unknown,
    acknowledgeMutate: vi.fn() as (...args: unknown[]) => void,
    acknowledgePending: false,
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
  // Internal Vacancies / My Applications (W60)
  useListMyInternalVacancies: () => ({ data: state.internalVacancies, isLoading: false, error: state.internalVacanciesError, refetch: vi.fn() }),
  getListMyInternalVacanciesQueryKey: () => ['myInternalVacancies'],
  useApplyToInternalVacancy: () => ({ mutate: state.applyMutate, isPending: false }),
  useListMyInternalApplications: () => ({ data: state.myInternalApplications, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListMyInternalApplicationsQueryKey: () => ['myInternalApplications'],
  // My Attendance (W68) — reuses W65/W66/W67 hooks, stubbed here.
  useRecordAttendanceEvent: () => ({ mutate: state.clockMutate, isPending: state.clockPending }),
  useListAttendanceEvents: () => ({ data: state.attendanceEvents, isLoading: false, error: state.attendanceEventsError, refetch: vi.fn() }),
  getListAttendanceEventsQueryKey: () => ['attendanceEvents'],
  useGetAttendanceDailySummary: () => ({
    data: state.attendanceSummary,
    isLoading: state.attendanceSummaryLoading,
    error: state.attendanceSummaryError,
    refetch: vi.fn(),
  }),
  getGetAttendanceDailySummaryQueryKey: () => ['attendanceSummary'],
  useRecordAttendanceAdjustment: () => ({ mutate: state.requestMutate, isPending: state.requestPending }),
  RecordAttendanceAdjustmentInputAdjustmentType: {
    manual_clock_in: 'manual_clock_in',
    manual_clock_out: 'manual_clock_out',
    mark_present: 'mark_present',
    mark_absent: 'mark_absent',
    excuse_absence: 'excuse_absence',
  },
  // My Performance (W77)
  useListMyPerformanceReviews: () => ({ data: state.myReviews, isLoading: state.myReviewsLoading, error: state.myReviewsError, refetch: vi.fn() }),
  getListMyPerformanceReviewsQueryKey: () => ['myPerformanceReviews'],
  useGetPerformanceReview: () => ({ data: state.reviewDetail, isLoading: state.reviewDetailLoading, error: state.reviewDetailError, refetch: vi.fn() }),
  getGetPerformanceReviewQueryKey: () => ['performanceReview'],
  useGetPerformanceRatingScale: () => ({ data: state.ratingScale }),
  getGetPerformanceRatingScaleQueryKey: () => ['performanceRatingScale'],
  useRateCompetency: () => ({ mutate: state.rateMutate, isPending: false }),
  useCreatePerformanceReviewGoal: () => ({ mutate: state.createGoalMutate, isPending: false }),
  useUpdatePerformanceReviewGoal: () => ({ mutate: state.updateGoalMutate, isPending: false }),
  useSubmitSelfAssessment: () => ({ mutate: state.submitMutate, isPending: state.submitPending, isError: !!state.submitError, error: state.submitError }),
  useAcknowledgePerformanceReview: () => ({ mutate: state.acknowledgeMutate, isPending: state.acknowledgePending }),
  // Evidence/Attachments (W82) — embedded via PerformanceEvidenceSection, not under test on this page's own suite.
  useListPerformanceReviewEvidence: () => ({ data: [], isLoading: false, error: undefined }),
  getListPerformanceReviewEvidenceQueryKey: () => ['performanceReviewEvidence'],
  useAddPerformanceReviewEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  CreatePerformanceReviewGoalInputMeasurementType: {
    numeric: 'numeric', percentage: 'percentage', currency: 'currency', boolean: 'boolean', rating: 'rating', qualitative: 'qualitative',
  },
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

  it('renders Internal Vacancies and My Applications tabs for a linked user', () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.documents = [];
    renderEss();
    expect(screen.getByTestId('tab-internal-vacancies')).toBeInTheDocument();
    expect(screen.getByTestId('tab-my-internal-applications')).toBeInTheDocument();
  });

  it('handles a disabled Recruitment module cleanly instead of a broken page', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: false })];
    state.documents = [];
    renderEss();
    await userEvent.click(screen.getByTestId('tab-internal-vacancies'));
    expect(screen.getByText(/recruitment isn't enabled/i)).toBeInTheDocument();
  });

  it("shows the controlled not-eligible state when the linked employee isn't active", async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.internalVacancies = { linked: true, active: false, items: [] };
    renderEss();
    await userEvent.click(screen.getByTestId('tab-internal-vacancies'));
    expect(screen.getByText(/internal applications aren't available/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no eligible internal vacancies', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.internalVacancies = { linked: true, active: true, items: [] };
    renderEss();
    await userEvent.click(screen.getByTestId('tab-internal-vacancies'));
    expect(screen.getByText(/no internal vacancies right now/i)).toBeInTheDocument();
  });

  it('lists eligible internal vacancies and opens the apply dialog with no recruiter controls', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.internalVacancies = {
      linked: true,
      active: true,
      items: [
        {
          publicId: 'vac-pub-1',
          title: 'Internal Analyst',
          departmentName: 'Finance',
          employmentType: 'full_time',
          workplaceType: 'onsite',
          openingsCount: 1,
          openDate: null,
          closeDate: null,
          jobDescription: 'Analyze things',
          responsibilities: null,
          requirements: null,
          preferredQualifications: null,
          questions: [],
        },
      ],
    };
    renderEss();
    await userEvent.click(screen.getByTestId('tab-internal-vacancies'));
    expect(screen.getByTestId('card-internal-vacancy-vac-pub-1')).toHaveTextContent('Internal Analyst');
    await userEvent.click(screen.getByTestId('button-view-internal-vacancy-vac-pub-1'));
    expect(screen.getByTestId('button-submit-internal-application')).toBeInTheDocument();
    expect(screen.queryByText(/recruiter/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hiring manager/i)).not.toBeInTheDocument();
  });

  it('submits an application from the apply dialog', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.internalVacancies = {
      linked: true,
      active: true,
      items: [{ publicId: 'vac-pub-1', title: 'Internal Analyst', departmentName: null, employmentType: null, workplaceType: null, openingsCount: 1, openDate: null, closeDate: null, jobDescription: null, responsibilities: null, requirements: null, preferredQualifications: null, questions: [] }],
    };
    const applyMutate = vi.fn((_vars, opts) => opts.onSuccess({ id: 1, isNew: true, status: 'submitted' }));
    state.applyMutate = applyMutate;
    renderEss();
    await userEvent.click(screen.getByTestId('tab-internal-vacancies'));
    await userEvent.click(screen.getByTestId('button-view-internal-vacancy-vac-pub-1'));
    await userEvent.click(screen.getByTestId('button-submit-internal-application'));
    expect(applyMutate).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'vac-pub-1' }), expect.anything());
  });

  it('shows My Applications with a status badge', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.myInternalApplications = {
      linked: true,
      active: true,
      items: [{ id: 1, vacancyTitle: 'Internal Analyst', currentStageCategory: 'screening', submittedAt: new Date().toISOString() }],
    };
    renderEss();
    await userEvent.click(screen.getByTestId('tab-my-internal-applications'));
    const row = screen.getByTestId('row-my-internal-application-1');
    expect(row).toHaveTextContent('Internal Analyst');
    expect(row).toHaveTextContent('screening');
  });

  it('shows an empty state when there are no internal applications yet', async () => {
    state.myEmployeeLoading = false;
    state.myEmployeeError = undefined;
    state.myEmployee = { linked: true, employee: baseEmployee() };
    state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'recruitment', enabled: true })];
    state.myInternalApplications = { linked: true, active: true, items: [] };
    renderEss();
    await userEvent.click(screen.getByTestId('tab-my-internal-applications'));
    expect(screen.getByText(/no internal applications yet/i)).toBeInTheDocument();
  });

  describe('My Attendance tab (W68)', () => {
    function resetAttendanceState() {
      state.attendanceEvents = [];
      state.attendanceEventsError = undefined;
      state.attendanceSummary = [];
      state.attendanceSummaryLoading = false;
      state.attendanceSummaryError = undefined;
      state.clockMutate = vi.fn();
      state.clockPending = false;
      state.requestMutate = vi.fn();
      state.requestPending = false;
    }

    it('renders the My Attendance tab with clock controls when the module is enabled', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByTestId('button-clock-in')).toBeInTheDocument();
      expect(screen.getByTestId('button-clock-out')).toBeInTheDocument();
      expect(screen.getByTestId('button-request-correction')).toBeInTheDocument();
    });

    it('handles a disabled Attendance module cleanly, without affecting My Leave', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'leave', enabled: true }), mod({ key: 'attendance', enabled: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByText(/attendance isn't enabled/i)).toBeInTheDocument();
      expect(screen.queryByTestId('button-clock-in')).not.toBeInTheDocument();

      await userEvent.click(screen.getByTestId('tab-my-leave'));
      expect(screen.queryByText(/leave isn't enabled/i)).not.toBeInTheDocument();
    });

    it('renders every W66 summary state with a human-readable label, including null as Not Applicable', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      const statuses = ['present', 'late', 'partial', 'absent', 'on_leave', 'holiday', 'non_working_day', null];
      state.attendanceSummary = statuses.map((status, i) => ({
        organizationId: 10,
        employeeId: 42,
        date: `2030-01-0${i + 1}`,
        status,
        firstClockIn: null,
        lastClockOut: null,
        workedMinutes: null,
        lateMinutes: null,
        earlyDepartureMinutes: null,
      }));
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByText('Present')).toBeInTheDocument();
      expect(screen.getByText('Late')).toBeInTheDocument();
      expect(screen.getByText('Partial')).toBeInTheDocument();
      expect(screen.getByText('Absent')).toBeInTheDocument();
      expect(screen.getByText('On Leave')).toBeInTheDocument();
      expect(screen.getByText('Holiday')).toBeInTheDocument();
      expect(screen.getByText('Non-Working Day')).toBeInTheDocument();
      expect(screen.getByText('Not Applicable')).toBeInTheDocument();
    });

    it('shows an empty state when there is no attendance history yet', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByText(/no attendance history yet/i)).toBeInTheDocument();
    });

    it('surfaces a summary API error (e.g. W66\'s missing-timezone 409) instead of crashing', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      state.attendanceSummaryError = { error: 'Organization timezone is not configured' };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByText(/could not load your attendance summary/i)).toBeInTheDocument();
      expect(screen.getByText(/organization timezone is not configured/i)).toBeInTheDocument();
    });

    it('clock-in sends only eventType — no employeeId trust/broadening from the UI', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      await userEvent.click(screen.getByTestId('button-clock-in'));
      expect(state.clockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, data: { eventType: 'clock_in' } }),
        expect.anything(),
      );
    });

    it('clock-out invokes the same own-clock API with eventType clock_out', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      await userEvent.click(screen.getByTestId('button-clock-out'));
      expect(state.clockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, data: { eventType: 'clock_out' } }),
        expect.anything(),
      );
    });

    it('does not expose approval, rejection, or HR direct-entry controls to the employee', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/select employee/i)).not.toBeInTheDocument();
    });

    it('disables correction submission until the required fields are filled, then submits through the W67 API', async () => {
      resetAttendanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      await userEvent.click(screen.getByTestId('button-request-correction'));

      const submit = screen.getByTestId('button-submit-correction-request');
      expect(submit).toBeDisabled();

      await userEvent.click(screen.getByTestId('select-correction-type'));
      await userEvent.click(screen.getByRole('option', { name: 'Mark a day as present' }));
      fireEvent.change(screen.getByTestId('input-correction-date'), { target: { value: '2024-01-05' } });
      await userEvent.type(screen.getByTestId('input-correction-reason'), 'Forgot to clock in that day');

      expect(submit).not.toBeDisabled();
      await userEvent.click(submit);

      expect(state.requestMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 10,
          data: expect.objectContaining({
            adjustmentType: 'mark_present',
            date: '2024-01-05',
            reason: 'Forgot to clock in that day',
          }),
        }),
        expect.anything(),
      );
    });
  });

  describe('My Performance tab (W77)', () => {
    function performanceReview(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, cycleId: 1, templateId: 1, ratingScaleId: 1, employeeId: 42,
        reviewerEmployeeId: 7, goalsWeight: 60, competenciesWeight: 40, scoringPrecisionSnapshot: 0,
        acknowledgementRequiredSnapshot: true, status: 'self_assessment', revisionNumber: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function competency(overrides: Record<string, unknown> = {}) {
      return { id: 1, organizationId: 10, reviewId: 1, label: 'Delivery', weight: 100, sortOrder: 0, notApplicable: false, ...overrides };
    }
    function goal(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, reviewId: 1, title: 'Ship X', measurementType: 'numeric', weight: 100,
        status: 'not_started', originType: 'manager', approvalStatus: 'accepted', notApplicable: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }

    function resetPerformanceState() {
      state.myReviews = [];
      state.myReviewsLoading = false;
      state.myReviewsError = undefined;
      state.reviewDetail = undefined;
      state.reviewDetailLoading = false;
      state.reviewDetailError = undefined;
      state.ratingScale = { scale: { id: 1, name: 'Standard' }, levels: [{ id: 1, ratingScaleId: 1, value: '1', label: 'Low', sortOrder: 0 }, { id: 2, ratingScaleId: 1, value: '5', label: 'High', sortOrder: 1 }] };
      state.rateMutate = vi.fn();
      state.createGoalMutate = vi.fn();
      state.updateGoalMutate = vi.fn();
      state.submitMutate = vi.fn();
      state.submitPending = false;
      state.submitError = undefined;
      state.acknowledgeMutate = vi.fn();
      state.acknowledgePending = false;
    }

    it('handles a disabled Performance module cleanly, without affecting My Attendance', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'attendance', enabled: true }), mod({ key: 'performance', enabled: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.getByText(/performance isn't enabled/i)).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('tab-my-attendance'));
      expect(screen.getByTestId('button-clock-in')).toBeInTheDocument();
    });

    it('shows an empty state when the employee has no assigned reviews', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.getByText(/no performance reviews yet/i)).toBeInTheDocument();
    });

    it('renders goals and competencies for the assigned review, with the propose-goal control visible while self_assessment', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [competency()], goals: [goal()] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.getByTestId('row-goal-1')).toHaveTextContent('Ship X');
      expect(screen.getByTestId('row-competency-1')).toHaveTextContent('Delivery');
      expect(screen.getByTestId('button-propose-goal')).toBeInTheDocument();
      expect(screen.getByTestId('button-submit-self-assessment')).toBeInTheDocument();
    });

    it('saves a competency self-rating', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [competency()], goals: [] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      await userEvent.click(screen.getByTestId('select-competency-rating-1'));
      await userEvent.click(screen.getByRole('option', { name: /High/i }));
      await userEvent.click(screen.getByTestId('button-save-competency-1'));
      expect(state.rateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1, competencyId: 1, data: expect.objectContaining({ employeeRatingValue: 5 }) }),
        expect.anything(),
      );
    });

    it('saves a self-assessment comment on an accepted goal', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [], goals: [goal()] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      await userEvent.type(screen.getByTestId('textarea-goal-comment-1'), 'Going well');
      await userEvent.click(screen.getByTestId('button-save-goal-comment-1'));
      expect(state.updateGoalMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1, goalId: 1, data: { employeeComment: 'Going well' } }),
        expect.anything(),
      );
    });

    it('submits a goal proposal through the create-goal API', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [], goals: [] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      await userEvent.click(screen.getByTestId('button-propose-goal'));
      await userEvent.type(screen.getByTestId('input-propose-goal-title'), 'Learn TypeScript');
      await userEvent.click(screen.getByTestId('select-propose-goal-type'));
      await userEvent.click(screen.getByRole('option', { name: 'Qualitative' }));
      await userEvent.click(screen.getByTestId('button-submit-propose-goal'));
      expect(state.createGoalMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ title: 'Learn TypeScript', measurementType: 'qualitative' }) }),
        expect.anything(),
      );
    });

    it('shows every readiness problem on a blocked submission, not just the first', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [competency()], goals: [] };
      state.submitError = { error: 'not ready', problems: ['Competency "Delivery" is missing your self-rating', 'Something else is missing'] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      const problems = screen.getByTestId('text-submission-problems');
      expect(problems).toHaveTextContent('Delivery');
      expect(problems).toHaveTextContent('Something else is missing');
    });

    it('locks all self-assessment controls once the review has moved to manager_review', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview({ status: 'manager_review' })];
      state.reviewDetail = { review: performanceReview({ status: 'manager_review' }), competencies: [competency({ employeeRatingValue: '5' })], goals: [goal()] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.queryByTestId('button-propose-goal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-submit-self-assessment')).not.toBeInTheDocument();
      expect(screen.getByTestId('select-competency-rating-1')).toBeDisabled();
    });

    it('does not expose manager scoring or finalize controls to the employee', async () => {
      resetPerformanceState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true })];
      state.myReviews = [performanceReview()];
      state.reviewDetail = { review: performanceReview(), competencies: [competency()], goals: [goal()] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.queryByRole('button', { name: /finalize/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /accept proposal/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject proposal/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/manager rating/i)).not.toBeInTheDocument();
    });

    describe('Acknowledgement (W83A)', () => {
      it('shows the acknowledgement control on a finalized review requiring acknowledgement, with score and non-agreement wording', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const finalized = performanceReview({ status: 'finalized', scoringPrecisionSnapshot: 2, computedOverallScore: '88.00', hrOverrideScore: '92.50', hrFinalizedAt: new Date().toISOString() });
        state.myReviews = [finalized];
        state.reviewDetail = { review: finalized, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        expect(screen.getByTestId('card-acknowledgement')).toHaveTextContent('Final score: 92.50');
        expect(screen.getByTestId('button-acknowledge-review')).toBeInTheDocument();
        expect(screen.getByText(/you have seen this review/i)).toBeInTheDocument();
        expect(screen.getByText(/does not mean you agree/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^i agree$/i })).not.toBeInTheDocument();
      });

      it('does not show the acknowledgement control before finalized (e.g. hr_review)', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const inReview = performanceReview({ status: 'hr_review' });
        state.myReviews = [inReview];
        state.reviewDetail = { review: inReview, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        expect(screen.queryByTestId('card-acknowledgement')).not.toBeInTheDocument();
      });

      it('acknowledges through the real mutation, with an optional final comment', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const finalized = performanceReview({ status: 'finalized', computedOverallScore: '88.00' });
        state.myReviews = [finalized];
        state.reviewDetail = { review: finalized, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        await userEvent.type(screen.getByTestId('input-final-comment'), 'Noted, thanks');
        await userEvent.click(screen.getByTestId('button-acknowledge-review'));
        expect(state.acknowledgeMutate).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 10, id: 1, data: { employeeFinalComment: 'Noted, thanks' } }),
          expect.anything(),
        );
      });

      it('acknowledges cleanly with no comment (data is undefined, not an empty string)', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const finalized = performanceReview({ status: 'finalized', computedOverallScore: '88.00' });
        state.myReviews = [finalized];
        state.reviewDetail = { review: finalized, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        await userEvent.click(screen.getByTestId('button-acknowledge-review'));
        expect(state.acknowledgeMutate).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 10, id: 1, data: undefined }),
          expect.anything(),
        );
      });

      it('shows the acknowledged state (button gone, comment shown, scores unchanged) using status, never acknowledgedAt alone', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const acknowledged = performanceReview({
          status: 'acknowledged',
          scoringPrecisionSnapshot: 2,
          computedOverallScore: '88.00',
          hrOverrideScore: '92.50',
          acknowledgedAt: '2026-02-01T00:00:00.000Z',
          employeeFinalComment: 'All good',
        });
        state.myReviews = [acknowledged];
        state.reviewDetail = { review: acknowledged, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        expect(screen.getByTestId('text-acknowledged-state')).toHaveTextContent('Acknowledged on');
        expect(screen.getByTestId('text-final-comment')).toHaveTextContent('All good');
        expect(screen.queryByTestId('button-acknowledge-review')).not.toBeInTheDocument();
        expect(screen.getByTestId('card-acknowledgement')).toHaveTextContent('Final score: 92.50');
      });

      it('never infers the acknowledged state from acknowledgedAt alone — a finalized review with a stray acknowledgedAt still shows the acknowledge control', async () => {
        resetPerformanceState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'performance', enabled: true })];
        const finalized = performanceReview({ status: 'finalized', computedOverallScore: '88.00', acknowledgedAt: '2026-02-01T00:00:00.000Z' });
        state.myReviews = [finalized];
        state.reviewDetail = { review: finalized, competencies: [], goals: [] };
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-performance'));
        expect(screen.getByTestId('button-acknowledge-review')).toBeInTheDocument();
        expect(screen.queryByTestId('text-acknowledged-state')).not.toBeInTheDocument();
      });
    });
  });
});
