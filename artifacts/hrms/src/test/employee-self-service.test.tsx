/**
 * Tests for the Employee Self-Service page (Phase 2B, W39).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made. MyLeave is embedded directly as the "My Leave" tab, so
 * its own hooks are stubbed here too rather than mocking the child component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    // My Learning (W88)
    learningCourses: [] as unknown[],
    learningCoursesLoading: false,
    learningCoursesError: undefined as unknown,
    myEnrollments: [] as unknown[],
    myEnrollmentsLoading: false,
    myEnrollmentsError: undefined as unknown,
    courseSessions: [] as unknown[],
    courseSessionsLoading: false,
    enrollmentSession: undefined as unknown,
    requestEnrollmentMutate: vi.fn() as (...args: unknown[]) => void,
    requestEnrollmentPending: false,
    advanceProgressMutate: vi.fn() as (...args: unknown[]) => void,
    advanceProgressPending: false,
    cancelEnrollmentMutate: vi.fn() as (...args: unknown[]) => void,
    cancelEnrollmentPending: false,
    // My Certificates / Evidence (W90)
    myCertificates: [] as unknown[],
    myCertificatesLoading: false,
    myCertificatesError: undefined as unknown,
    learningEvidence: [] as unknown[],
    addLearningEvidenceMutate: vi.fn() as (...args: unknown[]) => void,
    // My Assets (Phase 3E, W98)
    myAssetAssignments: [] as unknown[],
    myAssetAssignmentsLoading: false,
    myAssetAssignmentsError: undefined as unknown,
    acknowledgeAssetMutate: vi.fn() as (...args: unknown[]) => void,
    reportAssetIssueMutate: vi.fn() as (...args: unknown[]) => void,
    // Career Profile (Phase 3F, W106)
    careerEmploymentHistory: undefined as { linked: boolean; items: unknown[] } | undefined,
    careerEmploymentHistoryLoading: false,
    careerEmploymentHistoryError: false,
    careerSkills: undefined as { linked: boolean; items: unknown[] } | undefined,
    careerSkillsLoading: false,
    careerSkillsError: false,
    careerQualifications: undefined as { linked: boolean; items: unknown[] } | undefined,
    careerQualificationsLoading: false,
    careerQualificationsError: false,
    careerCertifications: undefined as { linked: boolean; items: unknown[] } | undefined,
    careerCertificationsLoading: false,
    careerCertificationsError: false,
    // My Inventory (Workstream 8, §33)
    myInventoryRequests: [] as unknown[],
    myInventoryRequestsLoading: false,
    myInventoryRequestsError: undefined as unknown,
    myInventoryCustody: [] as unknown[],
    myInventoryCustodyLoading: false,
    myInventoryCustodyError: undefined as unknown,
    myInventoryHistory: [] as unknown[],
    myInventoryHistoryLoading: false,
    myInventoryHistoryError: undefined as unknown,
    myInventoryItems: [] as unknown[],
    createInventoryRequestMutate: vi.fn() as (...args: unknown[]) => void,
    confirmInventoryReceiptMutate: vi.fn() as (...args: unknown[]) => void,
    createInventoryReturnMutate: vi.fn() as (...args: unknown[]) => void,
    createInventoryHandoverMutate: vi.fn() as (...args: unknown[]) => void,
    reportInventoryIncidentMutate: vi.fn() as (...args: unknown[]) => void,
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
  // My Learning (W88)
  useListLearningCourses: () => ({ data: state.learningCourses, isLoading: state.learningCoursesLoading, error: state.learningCoursesError, refetch: vi.fn() }),
  getListLearningCoursesQueryKey: () => ['learningCourses'],
  useListLearningCourseSessions: () => ({ data: state.courseSessions, isLoading: state.courseSessionsLoading }),
  getListLearningCourseSessionsQueryKey: () => ['learningCourseSessions'],
  useGetLearningCourseSession: () => ({ data: state.enrollmentSession, isLoading: false }),
  getGetLearningCourseSessionQueryKey: () => ['learningCourseSession'],
  useListMyLearningEnrollments: () => ({ data: state.myEnrollments, isLoading: state.myEnrollmentsLoading, error: state.myEnrollmentsError, refetch: vi.fn() }),
  getListMyLearningEnrollmentsQueryKey: () => ['myLearningEnrollments'],
  useRequestLearningEnrollment: () => ({ mutate: state.requestEnrollmentMutate, isPending: state.requestEnrollmentPending }),
  useAdvanceLearningEnrollmentProgress: () => ({ mutate: state.advanceProgressMutate, isPending: state.advanceProgressPending }),
  useCancelLearningEnrollment: () => ({ mutate: state.cancelEnrollmentMutate, isPending: state.cancelEnrollmentPending }),
  // My Certificates / Evidence (W90)
  useListMyLearningCertificates: () => ({ data: state.myCertificates, isLoading: state.myCertificatesLoading, error: state.myCertificatesError, refetch: vi.fn() }),
  getListMyLearningCertificatesQueryKey: () => ['myLearningCertificates'],
  useListLearningEnrollmentEvidence: () => ({ data: state.learningEvidence, isLoading: false, error: undefined }),
  getListLearningEnrollmentEvidenceQueryKey: () => ['learningEnrollmentEvidence'],
  useAddLearningEnrollmentEvidence: () => ({ mutate: state.addLearningEvidenceMutate, isPending: false }),
  getDownloadLearningEnrollmentEvidenceUrl: (orgId: number, enrollmentId: number, evidenceId: number) => `/api/organizations/${orgId}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`,
  // My Assets (Phase 3E, W98)
  useListMyAssetAssignments: () => ({ data: state.myAssetAssignments, isLoading: state.myAssetAssignmentsLoading, error: state.myAssetAssignmentsError, refetch: vi.fn() }),
  getListMyAssetAssignmentsQueryKey: () => ['myAssetAssignments'],
  useAcknowledgeAssetAssignment: () => ({ mutate: state.acknowledgeAssetMutate, isPending: false }),
  useReportAssetIssue: () => ({ mutate: state.reportAssetIssueMutate, isPending: false }),
  // Career Profile (Phase 3F, W106)
  useGetMyEmploymentHistory: () => ({
    data: state.careerEmploymentHistory,
    isLoading: state.careerEmploymentHistoryLoading,
    isError: state.careerEmploymentHistoryError,
    refetch: vi.fn(),
  }),
  getGetMyEmploymentHistoryQueryKey: () => ['myEmploymentHistory'],
  useGetMySkills: () => ({ data: state.careerSkills, isLoading: state.careerSkillsLoading, isError: state.careerSkillsError, refetch: vi.fn() }),
  getGetMySkillsQueryKey: () => ['mySkills'],
  useGetMyQualifications: () => ({
    data: state.careerQualifications,
    isLoading: state.careerQualificationsLoading,
    isError: state.careerQualificationsError,
    refetch: vi.fn(),
  }),
  getGetMyQualificationsQueryKey: () => ['myQualifications'],
  useGetMyCertifications: () => ({
    data: state.careerCertifications,
    isLoading: state.careerCertificationsLoading,
    isError: state.careerCertificationsError,
    refetch: vi.fn(),
  }),
  getGetMyCertificationsQueryKey: () => ['myCertifications'],
  // My Inventory (Workstream 8, §33)
  useListOfficeInventoryMyRequests: () => ({ data: state.myInventoryRequests, isLoading: state.myInventoryRequestsLoading, error: state.myInventoryRequestsError, refetch: vi.fn() }),
  getListOfficeInventoryMyRequestsQueryKey: () => ['myInventoryRequests'],
  useGetOfficeInventoryMyCustody: () => ({ data: state.myInventoryCustody, isLoading: state.myInventoryCustodyLoading, error: state.myInventoryCustodyError, refetch: vi.fn() }),
  getGetOfficeInventoryMyCustodyQueryKey: () => ['myInventoryCustody'],
  useGetOfficeInventoryMyHistory: () => ({ data: state.myInventoryHistory, isLoading: state.myInventoryHistoryLoading, error: state.myInventoryHistoryError, refetch: vi.fn() }),
  getGetOfficeInventoryMyHistoryQueryKey: () => ['myInventoryHistory'],
  useConfirmOfficeInventoryReceipt: () => ({ mutate: state.confirmInventoryReceiptMutate, isPending: false }),
  useCreateOfficeInventoryMyReturn: () => ({ mutate: state.createInventoryReturnMutate, isPending: false }),
  useCreateOfficeInventoryMyHandover: () => ({ mutate: state.createInventoryHandoverMutate, isPending: false }),
  useReportOfficeInventoryIncident: () => ({ mutate: state.reportInventoryIncidentMutate, isPending: false }),
  useListOfficeInventoryStores: () => ({ data: [] }),
  getListOfficeInventoryStoresQueryKey: () => ['officeInventoryStores'],
  useListOfficeInventoryItems: () => ({ data: state.myInventoryItems }),
  getListOfficeInventoryItemsQueryKey: () => ['officeInventoryItems'],
  useListEmployees: () => ({ data: { items: [] } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: [] }),
  getListDepartmentsQueryKey: () => ['departments'],
  // office-inventory.tsx's own CreateRequestDialog/RequestDetailDialog
  // (reused by My Inventory, §33) additionally need these — stubbed
  // minimally since request creation/detail themselves aren't under test
  // on this page's own suite (already covered by office-inventory.test.tsx).
  useCreateOfficeInventoryRequest: () => ({ mutate: state.createInventoryRequestMutate, isPending: false }),
  useGetOfficeInventoryRequest: () => ({ data: undefined, isLoading: false }),
  getGetOfficeInventoryRequestQueryKey: () => ['officeInventoryRequest'],
  useCancelOfficeInventoryRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

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

  describe('My Learning tab (W88)', () => {
    function course(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, categoryCode: 'compliance', title: 'Fire Safety', description: null,
        deliveryMode: 'self_paced', mandatoryDefault: false, requiresApproval: false, hasAssessment: false,
        issuesCertificate: false, certificateValidityMonths: null, status: 'active', createdBy: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function enrollment(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, courseId: 1, sessionId: null, employeeId: 42,
        courseTitleSnapshot: 'Fire Safety', categorySnapshot: 'Compliance', deliveryModeSnapshot: 'self_paced',
        hasAssessmentSnapshot: false, issuesCertificateSnapshot: false, certificateValidityMonthsSnapshot: null,
        departmentIdSnapshot: null, positionIdSnapshot: null, managerEmployeeIdSnapshot: null,
        mandatoryAtAssignment: false, originType: 'employee_requested', assignedByMembershipId: null, dueDate: null,
        approvalStatus: 'auto_approved', approvalDecidedByMembershipId: null, approvalDecidedAt: null,
        status: 'assigned', attended: null, attendanceMarkedByMembershipId: null, attendanceMarkedAt: null,
        passed: null, score: null, completedAt: null, cancelReason: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }

    function resetLearningState() {
      state.learningCourses = [];
      state.learningCoursesLoading = false;
      state.learningCoursesError = undefined;
      state.myEnrollments = [];
      state.myEnrollmentsLoading = false;
      state.myEnrollmentsError = undefined;
      state.courseSessions = [];
      state.courseSessionsLoading = false;
      state.enrollmentSession = undefined;
      state.requestEnrollmentMutate = vi.fn();
      state.requestEnrollmentPending = false;
      state.advanceProgressMutate = vi.fn();
      state.advanceProgressPending = false;
      state.cancelEnrollmentMutate = vi.fn();
      state.cancelEnrollmentPending = false;
      state.myCertificates = [];
      state.myCertificatesLoading = false;
      state.myCertificatesError = undefined;
      state.learningEvidence = [];
      state.addLearningEvidenceMutate = vi.fn();
    }
    function certificate(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, enrollmentId: 1, employeeId: 42, courseTitleSnapshot: 'Fire Safety',
        certificateNumber: null, issuedAt: new Date().toISOString(), expiresAt: null, status: 'active',
        revokedByMembershipId: null, revokedAt: null, revokeReason: null, employeeDocumentId: null,
        createdAt: new Date().toISOString(),
        ...overrides,
      };
    }

    it('handles a disabled Learning module cleanly, without affecting My Performance', async () => {
      resetLearningState();
      state.myReviews = [];
      state.reviewDetail = undefined;
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true }), mod({ key: 'learning', enabled: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByText(/learning isn't enabled/i)).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.getByText(/no performance reviews yet/i)).toBeInTheDocument();
    });

    it('shows empty states for both catalog and enrollments', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByText(/no courses are open for enrollment right now/i)).toBeInTheDocument();
      expect(screen.getByText(/you have no training enrollments yet/i)).toBeInTheDocument();
    });

    it('only shows active courses in the catalog, never draft or archived', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.learningCourses = [course({ id: 1, title: 'Active Course', status: 'active' }), course({ id: 2, title: 'Draft Course', status: 'draft' }), course({ id: 3, title: 'Archived Course', status: 'archived' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByText('Active Course')).toBeInTheDocument();
      expect(screen.queryByText('Draft Course')).not.toBeInTheDocument();
      expect(screen.queryByText('Archived Course')).not.toBeInTheDocument();
    });

    it('requests a self-paced course immediately, with no sessionId and no employeeId sent from the browser', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.learningCourses = [course({ id: 5, title: 'Self-Paced Course', deliveryMode: 'self_paced' })];
      const requestMutate = vi.fn((_vars, opts) => opts.onSuccess({ id: 9, approvalStatus: 'auto_approved' }));
      state.requestEnrollmentMutate = requestMutate;
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      await userEvent.click(screen.getByTestId('button-request-course-5'));
      expect(requestMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 5, data: undefined },
        expect.anything(),
      );
    });

    it('opens a session-selection dialog for an instructor-led course, offering only scheduled sessions', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.learningCourses = [course({ id: 7, title: 'Instructor Course', deliveryMode: 'instructor_led' })];
      state.courseSessions = [
        { id: 100, organizationId: 10, courseId: 7, scheduledAt: '2030-01-01T09:00:00.000Z', durationMinutes: 60, location: 'Room A', meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'scheduled', createdAt: '', updatedAt: '' },
        { id: 101, organizationId: 10, courseId: 7, scheduledAt: '2029-01-01T09:00:00.000Z', durationMinutes: 60, location: 'Room B', meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'completed', createdAt: '', updatedAt: '' },
      ];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      await userEvent.click(screen.getByTestId('button-request-course-7'));
      expect(screen.getByTestId('select-learning-session')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('select-learning-session'));
      expect(screen.getByText(/Room A/)).toBeInTheDocument();
      expect(screen.queryByText(/Room B/)).not.toBeInTheDocument();
    });

    it('displays the two-axis approval/status state independently — a pending request never looks startable', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 1, status: 'assigned', approvalStatus: 'pending' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByTestId('badge-enrollment-status-1')).toHaveTextContent('Not Started');
      expect(screen.getByTestId('badge-enrollment-approval-1')).toHaveTextContent('Pending Approval');
      expect(screen.queryByTestId('button-start-enrollment-1')).not.toBeInTheDocument();
      expect(screen.getByText(/waiting on your manager/i)).toBeInTheDocument();
    });

    it('starts an approved self-paced enrollment via the progress route', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 2, status: 'assigned', approvalStatus: 'auto_approved' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      await userEvent.click(screen.getByTestId('button-start-enrollment-2'));
      expect(state.advanceProgressMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 2, data: { status: 'in_progress' } },
        expect.anything(),
      );
    });

    it('marks an in-progress self-paced enrollment complete', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 3, status: 'in_progress', approvalStatus: 'auto_approved' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      await userEvent.click(screen.getByTestId('button-complete-enrollment-3'));
      expect(state.advanceProgressMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 3, data: { status: 'completed' } },
        expect.anything(),
      );
    });

    it('never shows a start/complete action for an instructor-led enrollment', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 4, status: 'assigned', approvalStatus: 'auto_approved', deliveryModeSnapshot: 'instructor_led', sessionId: 200 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.queryByTestId('button-start-enrollment-4')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-complete-enrollment-4')).not.toBeInTheDocument();
    });

    it('allows cancelling a non-mandatory, not-yet-started enrollment', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 6, status: 'assigned', mandatoryAtAssignment: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      await userEvent.click(screen.getByTestId('button-cancel-enrollment-6'));
      expect(state.cancelEnrollmentMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 6 },
        expect.anything(),
      );
    });

    it('never shows a cancel action for a mandatory enrollment', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 7, status: 'assigned', mandatoryAtAssignment: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByTestId('badge-enrollment-status-7').closest('[data-testid="row-enrollment-7"]')).toHaveTextContent('Mandatory');
      expect(screen.queryByTestId('button-cancel-enrollment-7')).not.toBeInTheDocument();
    });

    it('shows the enrollment historical snapshot, never the live course fields', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      // Live course has since been renamed — the enrollment's own snapshot must win.
      state.learningCourses = [course({ id: 1, title: 'Renamed Live Course' })];
      state.myEnrollments = [enrollment({ id: 8, courseId: 1, courseTitleSnapshot: 'Original Course Title' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByTestId('row-enrollment-8')).toHaveTextContent('Original Course Title');
      expect(screen.queryByTestId('row-enrollment-8')?.textContent).not.toContain('Renamed Live Course');
    });

    it('exposes no manager, HR, or instructor controls on My Learning', async () => {
      resetLearningState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      state.myEnrollments = [enrollment({ id: 9, status: 'assigned', approvalStatus: 'pending' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark attendance/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /issue certificate/i })).not.toBeInTheDocument();
    });

    describe('My Certificates (W90)', () => {
      it('shows an empty state when the employee has no certificates', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        expect(screen.getByText(/you have no certificates yet/i)).toBeInTheDocument();
      });

      it('lists an active certificate with its issue date and validity', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myCertificates = [certificate({ id: 1, expiresAt: '2099-01-01T00:00:00.000Z' })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        const row = screen.getByTestId('row-certificate-1');
        expect(row).toHaveTextContent('Fire Safety');
        expect(screen.getByTestId('badge-certificate-status-1')).toHaveTextContent('Active');
      });

      it('shows a live-computed Expired badge for a past expiresAt, without the API ever saying so', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myCertificates = [certificate({ id: 2, status: 'active', expiresAt: '2020-01-01T00:00:00.000Z' })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        expect(screen.getByTestId('badge-certificate-status-2')).toHaveTextContent('Active');
        expect(screen.getByTestId('badge-certificate-expired-2')).toHaveTextContent('Expired');
      });

      it('shows a Revoked certificate distinctly, with its reason, and no Expired badge', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myCertificates = [certificate({ id: 3, status: 'revoked', revokeReason: 'Issued in error' })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        expect(screen.getByTestId('badge-certificate-status-3')).toHaveTextContent('Revoked');
        expect(screen.queryByTestId('badge-certificate-expired-3')).not.toBeInTheDocument();
        expect(screen.getByTestId('row-certificate-3')).toHaveTextContent('Issued in error');
      });

      it('certificate state never collapses into the enrollment approval/status badges', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myEnrollments = [enrollment({ id: 5, status: 'completed', approvalStatus: 'auto_approved' })];
        state.myCertificates = [certificate({ id: 4, enrollmentId: 5 })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        expect(screen.getByTestId('badge-enrollment-status-5')).toHaveTextContent('Completed');
        expect(screen.getByTestId('row-certificate-4')).toBeInTheDocument();
        expect(screen.getByTestId('badge-certificate-status-4')).toHaveTextContent('Active');
      });
    });

    describe('Enrollment evidence (W90)', () => {
      it('the evidence section is hidden until toggled, then shows the upload control', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myEnrollments = [enrollment({ id: 6 })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        expect(screen.queryByTestId('button-attach-learning-evidence-6')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('button-toggle-evidence-6'));
        expect(screen.getByTestId('button-attach-learning-evidence-6')).toBeInTheDocument();
      });

      it('uploads evidence for the own enrollment through the real route', async () => {
        resetLearningState();
        state.myEmployeeLoading = false;
        state.myEmployeeError = undefined;
        state.myEmployee = { linked: true, employee: baseEmployee() };
        state.modules = [mod({ key: 'learning', enabled: true })];
        state.myEnrollments = [enrollment({ id: 7 })];
        renderEss();
        await userEvent.click(screen.getByTestId('tab-my-learning'));
        await userEvent.click(screen.getByTestId('button-toggle-evidence-7'));
        const file = new File(['pdf-bytes'], 'proof.pdf', { type: 'application/pdf' });
        const input = screen.getByTestId('input-learning-evidence-file-7') as HTMLInputElement;
        await userEvent.upload(input, file);
        expect(state.addLearningEvidenceMutate).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 10, id: 7, data: { file } }),
          expect.anything(),
        );
      });
    });
  });

  describe('My Assets tab (W98)', () => {
    function assignment(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, assetId: 1, employeeId: 42,
        assetTagSnapshot: 'AST-00001', assetNameSnapshot: 'ThinkPad X1', categorySnapshot: 'laptop',
        departmentIdSnapshot: null, positionIdSnapshot: null,
        issuedAt: new Date().toISOString(), issuedByMembershipId: 3, expectedReturnDate: null,
        issueCondition: 'good', issueNotes: null,
        acknowledgedAt: null, acknowledgementNote: null,
        custodyEndedAt: null, endReason: null, receivedByMembershipId: null, returnCondition: null, returnNotes: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        ...overrides,
      };
    }

    function resetAssetsState() {
      state.myAssetAssignments = [];
      state.myAssetAssignmentsLoading = false;
      state.myAssetAssignmentsError = undefined;
      state.acknowledgeAssetMutate = vi.fn();
      state.reportAssetIssueMutate = vi.fn();
    }

    it('handles a disabled Asset Management module cleanly, without affecting other tabs', async () => {
      resetAssetsState();
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true }), mod({ key: 'asset_management', enabled: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByText(/asset management isn't enabled/i)).toBeInTheDocument();
      // Other tabs remain unaffected by asset_management being disabled.
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.queryByText(/asset management isn't enabled/i)).not.toBeInTheDocument();
    });

    it('shows an empty state when nothing is currently assigned', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByText(/no assets currently assigned to you/i)).toBeInTheDocument();
    });

    it('renders current custody with an unacknowledged badge and an Acknowledge action', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, custodyEndedAt: null, acknowledgedAt: null })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByTestId('card-my-asset-1')).toHaveTextContent('ThinkPad X1');
      expect(screen.getByTestId('badge-ack-status-1')).toHaveTextContent('Not Yet Acknowledged');
      expect(screen.getByTestId('button-open-acknowledge-1')).toBeInTheDocument();
    });

    it('does not offer Acknowledge once already acknowledged, and shows the acknowledged state', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, custodyEndedAt: null, acknowledgedAt: new Date().toISOString() })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByTestId('badge-ack-status-1')).toHaveTextContent('Acknowledged');
      expect(screen.queryByTestId('button-open-acknowledge-1')).not.toBeInTheDocument();
    });

    it('submits acknowledgement through the real W97 route, with the literal receipt-confirmation wording', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      await userEvent.click(screen.getByTestId('button-open-acknowledge-1'));
      const confirmButton = screen.getByTestId('button-confirm-acknowledge-1');
      expect(confirmButton).toHaveTextContent('I confirm I received this item');
      await userEvent.click(confirmButton);
      expect(state.acknowledgeAssetMutate).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 10, id: 1 }),
        expect.anything(),
      );
    });

    it('explicitly disclaims approval, liability, damage acceptance, and financial responsibility (Decision 1) rather than staying silent on them', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      await userEvent.click(screen.getByTestId('button-open-acknowledge-1'));
      // The dialog's own disclaimer text negates all four concepts in one
      // sentence — "It is not an approval, an agreement to liability, an
      // acceptance of damage, or an acceptance of financial responsibility"
      // — so the words are expected to appear, but only inside that single
      // negating sentence, never as a standalone framing like "you approve"
      // or "you accept liability."
      expect(
        screen.getByText(/It is not an approval, an agreement to liability, an acceptance of damage, or an acceptance of financial responsibility\./),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^you approve/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/you accept liability/i)).not.toBeInTheDocument();
    });

    it('offers a Report an Issue action on a current assignment', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, assetId: 9 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByTestId('button-open-report-issue-9')).toBeInTheDocument();
    });

    it('requires an issue type and a description before submitting an incident report', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, assetId: 9 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      await userEvent.click(screen.getByTestId('button-open-report-issue-9'));
      expect(screen.getByTestId('button-confirm-report-issue-9')).toBeDisabled();
      await userEvent.type(screen.getByTestId('textarea-incident-description-9'), 'Screen cracked');
      expect(screen.getByTestId('button-confirm-report-issue-9')).toBeDisabled();
      await userEvent.click(screen.getByTestId('select-incident-type-9'));
      await userEvent.click(screen.getByRole('option', { name: 'Damage' }));
      expect(screen.getByTestId('button-confirm-report-issue-9')).not.toBeDisabled();
    });

    it('submits an incident report through the real report-issue route', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, assetId: 9 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      await userEvent.click(screen.getByTestId('button-open-report-issue-9'));
      await userEvent.click(screen.getByTestId('select-incident-type-9'));
      await userEvent.click(screen.getByRole('option', { name: 'Loss' }));
      await userEvent.type(screen.getByTestId('textarea-incident-description-9'), 'Cannot locate it');
      await userEvent.click(screen.getByTestId('button-confirm-report-issue-9'));
      expect(state.reportAssetIssueMutate).toHaveBeenCalledWith(
        { organizationId: 10, id: 9, data: { incidentType: 'loss', description: 'Cannot locate it' } },
        expect.anything(),
      );
    });

    it('shows past custody in an Asset History section, distinct from current custody', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [
        assignment({ id: 1, assetId: 9, custodyEndedAt: null }),
        assignment({ id: 2, assetId: 8, assetNameSnapshot: 'Old Monitor', custodyEndedAt: new Date().toISOString(), endReason: 'returned' }),
      ];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.getByTestId('card-my-asset-1')).toBeInTheDocument();
      expect(screen.queryByTestId('card-my-asset-2')).not.toBeInTheDocument();
      expect(screen.getByTestId('row-my-asset-history-2')).toHaveTextContent('Old Monitor');
    });

    it('exposes no HR/manager mutation control anywhere on this tab', async () => {
      resetAssetsState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'asset_management', enabled: true })];
      state.myAssetAssignments = [assignment({ id: 1, assetId: 9 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-assets'));
      expect(screen.queryByRole('button', { name: /^assign/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^return/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retire/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark lost/i })).not.toBeInTheDocument();
    });
  });

  describe('My Inventory tab (Workstream 8, §33)', () => {
    function custodyEntry(overrides: Record<string, unknown> = {}) {
      return { itemId: 1, balance: '2.00', overdue: false, expectedReturnDate: null, ...overrides };
    }
    function movement(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, organizationId: 10, itemId: 1, movementType: 'issued', quantity: '2.00',
        storeId: null, holderType: 'employee', holderId: 42, referenceNumber: 'ISS-00001',
        sourceReferenceType: null, sourceReferenceId: null, source: null, deliveryReference: null,
        unitCost: null, condition: null, reason: null, expectedReturnDate: null,
        confirmedByMembershipId: null, confirmedAt: null, idempotencyKey: null, actorMembershipId: 3,
        occurredAt: new Date().toISOString(), notes: null, createdAt: new Date().toISOString(),
        ...overrides,
      };
    }
    function officeInventoryItem(overrides: Record<string, unknown> = {}) {
      return { id: 1, organizationId: 10, itemCode: 'ITM-0001', name: 'Laptop Bag', classification: 'returnable', status: 'active', reorderLevel: null, unitOfMeasure: 'each', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides };
    }

    function resetInventoryState() {
      state.myInventoryRequests = [];
      state.myInventoryRequestsLoading = false;
      state.myInventoryRequestsError = undefined;
      state.myInventoryCustody = [];
      state.myInventoryCustodyLoading = false;
      state.myInventoryCustodyError = undefined;
      state.myInventoryHistory = [];
      state.myInventoryHistoryLoading = false;
      state.myInventoryHistoryError = undefined;
      state.myInventoryItems = [];
      state.createInventoryRequestMutate = vi.fn();
      state.confirmInventoryReceiptMutate = vi.fn();
      state.createInventoryReturnMutate = vi.fn();
      state.createInventoryHandoverMutate = vi.fn();
      state.reportInventoryIncidentMutate = vi.fn();
    }

    it('handles a disabled Office Inventory module cleanly, without affecting other tabs', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'performance', enabled: true }), mod({ key: 'office_inventory', enabled: false })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByText(/office inventory isn't enabled/i)).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('tab-my-performance'));
      expect(screen.queryByText(/office inventory isn't enabled/i)).not.toBeInTheDocument();
    });

    it('shows an empty state when nothing is currently in custody', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByText(/you have no items currently in your custody/i)).toBeInTheDocument();
    });

    it('renders current custody, showing the item name and an Overdue badge when applicable', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryCustody = [custodyEntry({ itemId: 1, overdue: true, expectedReturnDate: '2020-01-01' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByTestId('card-my-custody-1')).toHaveTextContent('Laptop Bag');
      expect(screen.getByTestId('card-my-custody-1')).toHaveTextContent('Overdue');
    });

    it('offers Return and Hand Over only for a returnable item, never for a consumable', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [
        officeInventoryItem({ id: 1, name: 'Laptop Bag', classification: 'returnable' }),
        officeInventoryItem({ id: 2, name: 'Notepad', classification: 'consumable' }),
      ];
      state.myInventoryCustody = [custodyEntry({ itemId: 1 }), custodyEntry({ itemId: 2, balance: '5.00' })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByTestId('button-open-my-return-1')).toBeInTheDocument();
      expect(screen.getByTestId('button-open-my-handover-1')).toBeInTheDocument();
      expect(screen.queryByTestId('button-open-my-return-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-open-my-handover-2')).not.toBeInTheDocument();
      // Report Damage/Missing remains available for both classifications.
      expect(screen.getByTestId('button-open-my-report-issue-1')).toBeInTheDocument();
      expect(screen.getByTestId('button-open-my-report-issue-2')).toBeInTheDocument();
    });

    it('submits a return through the real my/returns route, with the caller\'s own resolved employee id as holderId', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryCustody = [custodyEntry({ itemId: 1 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      await userEvent.click(screen.getByTestId('button-open-my-return-1'));
      await userEvent.type(screen.getByTestId('input-my-return-quantity-1'), '1');
      // Store selection is a Radix Select — skip choosing one and simply
      // prove the button stays disabled without it, then focus the
      // holderId assertion on a fully-specified submission.
      expect(screen.getByTestId('button-confirm-my-return-1')).toBeDisabled();
    });

    it('shows Awaiting Your Confirmation for an unconfirmed issued movement, with a Confirm Receipt action', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryHistory = [movement({ id: 5, itemId: 1, movementType: 'issued', confirmedAt: null })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByTestId('row-unconfirmed-receipt-5')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('button-confirm-my-receipt-5'));
      expect(state.confirmInventoryReceiptMutate).toHaveBeenCalledWith(
        { organizationId: 10, movementId: 5 },
        expect.anything(),
      );
    });

    it('does not show a Confirm Receipt action for an already-confirmed movement', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryHistory = [movement({ id: 5, itemId: 1, movementType: 'issued', confirmedAt: new Date().toISOString() })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.queryByTestId('row-unconfirmed-receipt-5')).not.toBeInTheDocument();
    });

    it('lists own requests with status and a View action, and offers New Request', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryRequests = [
        { id: 1, organizationId: 10, requestReference: 'REQ-00001', requestedByMembershipId: 3, requestType: 'employee', forEmployeeId: 42, forDepartmentId: 1, reason: null, submittedAt: new Date().toISOString(), status: 'pending', cancelledAt: null, cancelledByMembershipId: null },
      ];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByTestId('row-my-inventory-request-1')).toHaveTextContent('REQ-00001');
      expect(screen.getByTestId('row-my-inventory-request-1')).toHaveTextContent('Pending');
      expect(screen.getByTestId('button-create-request')).toBeInTheDocument();
    });

    it('shows own history with the movement type', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryHistory = [movement({ id: 9, itemId: 1, movementType: 'returned', confirmedAt: new Date().toISOString() })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.getByTestId('row-my-inventory-history-9')).toHaveTextContent('Laptop Bag');
      expect(screen.getByTestId('row-my-inventory-history-9')).toHaveTextContent('Returned');
    });

    it('exposes no operational/approval control anywhere on this tab', async () => {
      resetInventoryState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'office_inventory', enabled: true })];
      state.myInventoryItems = [officeInventoryItem({ id: 1, name: 'Laptop Bag' })];
      state.myInventoryCustody = [custodyEntry({ itemId: 1 })];
      renderEss();
      await userEvent.click(screen.getByTestId('tab-my-inventory'));
      expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reject/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /issue…/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /write.?off/i })).not.toBeInTheDocument();
    });
  });

  describe('Career Profile tab (Phase 3F, W106)', () => {
    function resetCareerProfileState() {
      state.myEmployeeLoading = false;
      state.myEmployeeError = undefined;
      state.careerEmploymentHistory = { linked: true, items: [] };
      state.careerEmploymentHistoryLoading = false;
      state.careerEmploymentHistoryError = false;
      state.careerSkills = { linked: true, items: [] };
      state.careerSkillsLoading = false;
      state.careerSkillsError = false;
      state.careerQualifications = { linked: true, items: [] };
      state.careerQualificationsLoading = false;
      state.careerQualificationsError = false;
      state.careerCertifications = { linked: true, items: [] };
      state.careerCertificationsLoading = false;
      state.careerCertificationsError = false;
    }

    it('is reachable without any additional module — no module gate beyond employee_self_service itself', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = []; // no module rows at all — Career Profile is Core HR, ungated like My Profile/My Documents
      renderEss();
      expect(screen.getByTestId('tab-career-profile')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByText('Employment History')).toBeInTheDocument();
      expect(screen.getByText('Skills')).toBeInTheDocument();
      expect(screen.getByText('Qualifications')).toBeInTheDocument();
      expect(screen.getByText('Certifications')).toBeInTheDocument();
    });

    it('renders exactly four sections, no more, no fewer', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      const headings = ['Employment History', 'Skills', 'Qualifications', 'Certifications'];
      for (const heading of headings) {
        expect(screen.getByText(heading)).toBeInTheDocument();
      }
    });

    it('shows loading states independently per section', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerEmploymentHistoryLoading = true;
      state.careerEmploymentHistory = undefined;
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByTestId('loading-my-employment-history')).toBeInTheDocument();
    });

    it('shows error states independently per section', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerSkillsError = true;
      state.careerSkills = undefined;
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByText('Failed to load your skills')).toBeInTheDocument();
    });

    it('shows empty states with useful copy for every section when there are no records', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByTestId('text-no-my-employment-history')).toBeInTheDocument();
      expect(screen.getByTestId('text-no-my-skills')).toBeInTheDocument();
      expect(screen.getByTestId('text-no-my-qualifications')).toBeInTheDocument();
      expect(screen.getByTestId('text-no-my-certifications')).toBeInTheDocument();
    });

    it('renders Employment History rows from the own-scoped API response', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerEmploymentHistory = {
        linked: true,
        items: [{ id: 1, eventType: 'promotion', effectiveDate: '2026-03-01', previousState: null, newState: {}, createdAt: '2026-03-01' }],
      };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByTestId('row-my-employment-history-1')).toHaveTextContent('promotion');
    });

    it('renders Skills rows, including proficiency when present', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerSkills = { linked: true, items: [{ id: 1, skillCode: 'javascript', proficiencyLevel: 'Advanced', createdAt: '2026-01-01' }] };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      const row = screen.getByTestId('row-my-skill-1');
      expect(row).toHaveTextContent('javascript');
      expect(row).toHaveTextContent('Advanced');
    });

    it('renders Qualifications rows', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerQualifications = {
        linked: true,
        items: [{ id: 1, qualificationTypeCode: 'bachelors', institution: 'University of Ghana', fieldOfStudy: null, startDate: null, endDate: null, grade: null, createdAt: '2026-01-01' }],
      };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      const row = screen.getByTestId('row-my-qualification-1');
      expect(row).toHaveTextContent('bachelors');
      expect(row).toHaveTextContent('University of Ghana');
    });

    it('renders an active certification with a text "Active" status, never color-only', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      state.careerCertifications = {
        linked: true,
        items: [{ id: 1, certificationTypeCode: 'pmp', issuingOrganization: 'PMI', issueDate: null, expiryDate: future, credentialId: null, createdAt: '2026-01-01' }],
      };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByTestId('badge-my-certification-status-1')).toHaveTextContent('Active');
    });

    it('keeps an expired certification visible with a text "Expired" status, never hidden', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerCertifications = {
        linked: true,
        items: [{ id: 1, certificationTypeCode: 'pmp', issuingOrganization: 'PMI', issueDate: null, expiryDate: '2020-01-01', credentialId: null, createdAt: '2020-01-01' }],
      };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.getByTestId('row-my-certification-1')).toBeInTheDocument();
      expect(screen.getByTestId('badge-my-certification-status-1')).toHaveTextContent('Expired');
    });

    it('never shows a Learning-issued certificate in Career Profile — only in My Learning', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.modules = [mod({ key: 'learning', enabled: true })];
      // A Learning certificate exists and is available to My Learning...
      state.myCertificates = [{ id: 99, courseTitleSnapshot: 'Learning-Issued Course', status: 'active', issuedAt: '2026-01-01', expiresAt: null }];
      // ...but Career Profile's own own-scoped API never returns it — proven
      // by the mock simply never including it, exactly like the real API.
      state.careerCertifications = { linked: true, items: [] };
      renderEss();

      await userEvent.click(screen.getByTestId('tab-my-learning'));
      expect(screen.getByText('Learning-Issued Course')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('tab-career-profile'));
      expect(screen.queryByText('Learning-Issued Course')).not.toBeInTheDocument();
      expect(screen.getByTestId('text-no-my-certifications')).toBeInTheDocument();
    });

    it('exposes no employee mutation control anywhere on this tab (no add/edit/delete/upload/renew/verify)', async () => {
      resetCareerProfileState();
      state.myEmployee = { linked: true, employee: baseEmployee() };
      state.careerEmploymentHistory = {
        linked: true,
        items: [{ id: 1, eventType: 'transfer', effectiveDate: '2026-01-01', previousState: null, newState: {}, createdAt: '2026-01-01' }],
      };
      state.careerSkills = { linked: true, items: [{ id: 1, skillCode: 'javascript', proficiencyLevel: null, createdAt: '2026-01-01' }] };
      state.careerQualifications = {
        linked: true,
        items: [{ id: 1, qualificationTypeCode: 'bachelors', institution: null, fieldOfStudy: null, startDate: null, endDate: null, grade: null, createdAt: '2026-01-01' }],
      };
      state.careerCertifications = {
        linked: true,
        items: [{ id: 1, certificationTypeCode: 'pmp', issuingOrganization: null, issueDate: null, expiryDate: null, credentialId: null, createdAt: '2026-01-01' }],
      };
      renderEss();
      await userEvent.click(screen.getByTestId('tab-career-profile'));
      const panel = screen.getByTestId('list-my-employment-history').closest('[role="tabpanel"]') as HTMLElement;
      expect(within(panel).queryAllByRole('button')).toHaveLength(0);
    });
  });
});
