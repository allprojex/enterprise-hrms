/**
 * Tests for the My Team Training page (Phase 3D, W89).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LearningTeamTraining from '@/pages/learning-team-training';
import type { LearningEnrollment, LearningCourse, LearningCourseSession, Employee } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myEmployee: { linked: true, employee: { id: 200 } } as { linked: boolean; employee: { id: number } | null },
    teamEnrollments: [] as LearningEnrollment[],
    teamEnrollmentsLoading: false,
    teamEnrollmentsError: undefined as unknown,
    courses: [] as LearningCourse[],
    employees: [] as Employee[],
    lookupEnrollment: undefined as LearningEnrollment | undefined,
    session: undefined as LearningCourseSession | undefined,
    approveMutate: vi.fn() as (...args: unknown[]) => void,
    rejectMutate: vi.fn() as (...args: unknown[]) => void,
    rejectMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    assignMutate: vi.fn() as (...args: unknown[]) => void,
    attendanceMutate: vi.fn() as (...args: unknown[]) => void,
    attendanceMutateAsync: vi.fn() as (...args: unknown[]) => Promise<unknown>,
    completeMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetMyEmployee: () => ({ data: state.myEmployee }),
  getGetMyEmployeeQueryKey: () => ['getMyEmployee'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListLearningCourses: () => ({ data: state.courses }),
  getListLearningCoursesQueryKey: () => ['learningCourses'],
  useListTeamLearningEnrollments: () => ({ data: state.teamEnrollments, isLoading: state.teamEnrollmentsLoading, error: state.teamEnrollmentsError, refetch: vi.fn() }),
  getListTeamLearningEnrollmentsQueryKey: () => ['teamEnrollments'],
  useGetLearningEnrollment: () => ({ data: state.lookupEnrollment, isLoading: false, error: undefined, refetch: vi.fn() }),
  getGetLearningEnrollmentQueryKey: () => ['learningEnrollment'],
  useGetLearningCourseSession: () => ({ data: state.session, isLoading: false }),
  getGetLearningCourseSessionQueryKey: () => ['learningCourseSession'],
  useApproveLearningEnrollment: () => ({ mutate: state.approveMutate, isPending: false }),
  useRejectLearningEnrollment: () => ({ mutate: state.rejectMutate, mutateAsync: state.rejectMutateAsync, isPending: false }),
  useAssignLearningEnrollments: () => ({ mutate: state.assignMutate, isPending: false }),
  useMarkLearningEnrollmentAttendance: () => ({ mutate: state.attendanceMutate, mutateAsync: state.attendanceMutateAsync, isPending: false }),
  useCompleteLearningEnrollment: () => ({ mutate: state.completeMutate, isPending: false }),
}));

function enrollment(overrides: Partial<LearningEnrollment> = {}): LearningEnrollment {
  return {
    id: 1, organizationId: 10, courseId: 1, sessionId: null, employeeId: 100,
    courseTitleSnapshot: 'Fire Safety', categorySnapshot: 'Compliance', deliveryModeSnapshot: 'self_paced',
    hasAssessmentSnapshot: false, issuesCertificateSnapshot: false, certificateValidityMonthsSnapshot: null,
    departmentIdSnapshot: null, positionIdSnapshot: null, managerEmployeeIdSnapshot: 200,
    mandatoryAtAssignment: false, originType: 'employee_requested', assignedByMembershipId: null, dueDate: null,
    approvalStatus: 'auto_approved', approvalDecidedByMembershipId: null, approvalDecidedAt: null,
    status: 'assigned', attended: null, attendanceMarkedByMembershipId: null, attendanceMarkedAt: null,
    passed: null, score: null, completedAt: null, cancelReason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function course(overrides: Partial<LearningCourse> = {}): LearningCourse {
  return {
    id: 1, organizationId: 10, categoryCode: 'compliance', title: 'Fire Safety', description: null,
    deliveryMode: 'self_paced', mandatoryDefault: false, requiresApproval: false, hasAssessment: false,
    issuesCertificate: false, certificateValidityMonths: null, status: 'active', createdBy: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function employee(overrides: Partial<Employee> = {}): Employee {
  return { id: 100, firstName: 'Ada', lastName: 'Lovelace', reportingManagerId: 200, ...overrides } as Employee;
}
function session(overrides: Partial<LearningCourseSession> = {}): LearningCourseSession {
  return {
    id: 500, organizationId: 10, courseId: 1, scheduledAt: '2030-01-01T09:00:00.000Z', durationMinutes: 60,
    location: null, meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'scheduled',
    createdAt: '', updatedAt: '',
    ...overrides,
  };
}

type MutationCallbacks = { onSuccess?: (...args: unknown[]) => void; onError?: (err: unknown) => void };

/** mutateAsync stand-in that runs the page's own onSuccess callback and resolves. */
function resolvingMutateAsync() {
  return vi.fn(async (_vars: unknown, opts?: MutationCallbacks) => {
    opts?.onSuccess?.();
  });
}

/** mutateAsync stand-in that runs the page's own onError callback and rejects. */
function rejectingMutateAsync() {
  return vi.fn(async (_vars: unknown, opts?: MutationCallbacks) => {
    const err = { error: 'Server refused' };
    opts?.onError?.(err);
    throw err;
  });
}

let lastQueryClient: QueryClient | null = null;

function resetState() {
  state.myEmployee = { linked: true, employee: { id: 200 } };
  state.teamEnrollments = [];
  state.teamEnrollmentsLoading = false;
  state.teamEnrollmentsError = undefined;
  state.courses = [course()];
  state.employees = [employee()];
  state.lookupEnrollment = undefined;
  state.session = undefined;
  state.approveMutate = vi.fn();
  state.rejectMutate = vi.fn();
  state.rejectMutateAsync = resolvingMutateAsync();
  state.assignMutate = vi.fn();
  state.attendanceMutate = vi.fn();
  state.attendanceMutateAsync = resolvingMutateAsync();
  state.completeMutate = vi.fn();
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningTeamTraining />
    </QueryClientProvider>,
  );
}

describe('My Team Training page (W89)', () => {
  it('shows an empty state when there is no team training', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no team training yet/i)).toBeInTheDocument();
  });

  it('shows an error state', () => {
    resetState();
    state.teamEnrollmentsError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load your team's training/i)).toBeInTheDocument();
  });

  it('shows a pending-approval queue with the employee name resolved, and approves through the real route', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 5, approvalStatus: 'pending' })];
    renderPage();
    expect(screen.getByTestId('card-pending-approvals')).toHaveTextContent('Ada Lovelace');
    await userEvent.click(screen.getByTestId('button-approve-5'));
    expect(state.approveMutate).toHaveBeenCalledWith({ organizationId: 10, id: 5 }, expect.anything());
  });

  it('rejects through the real route', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 6, approvalStatus: 'pending' })];
    renderPage();
    await userEvent.click(screen.getByTestId('button-reject-6'));
    expect(screen.getByTestId('dialog-reject-enrollment-6')).toHaveTextContent('Reject enrollment request?');
    expect(screen.getByTestId('dialog-reject-enrollment-6')).toHaveTextContent('Fire Safety');
    expect(state.rejectMutateAsync).not.toHaveBeenCalled();
    expect(state.rejectMutate).not.toHaveBeenCalled();

    const invalidateSpy = vi.spyOn(lastQueryClient!, 'invalidateQueries');
    await userEvent.click(screen.getByTestId('dialog-reject-enrollment-6-confirm'));
    expect(state.rejectMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.rejectMutateAsync).toHaveBeenCalledWith({ organizationId: 10, id: 6 }, expect.anything());
    await waitFor(() => expect(screen.queryByTestId('dialog-reject-enrollment-6')).not.toBeInTheDocument());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['teamEnrollments'] });
  });

  it('cancelling the reject confirmation rejects nothing', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 6, approvalStatus: 'pending' })];
    renderPage();
    await userEvent.click(screen.getByTestId('button-reject-6'));
    await userEvent.click(screen.getByTestId('dialog-reject-enrollment-6-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-reject-enrollment-6')).not.toBeInTheDocument());
    expect(state.rejectMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('row-team-enrollment-6')).toBeInTheDocument();
  });

  it('a failed reject keeps the confirmation open and the request listed', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 6, approvalStatus: 'pending' })];
    state.rejectMutateAsync = rejectingMutateAsync();
    renderPage();
    await userEvent.click(screen.getByTestId('button-reject-6'));
    await userEvent.click(screen.getByTestId('dialog-reject-enrollment-6-confirm'));
    expect(state.rejectMutateAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('dialog-reject-enrollment-6-confirm')).not.toBeDisabled());
    expect(screen.getByTestId('dialog-reject-enrollment-6')).toBeInTheDocument();
    expect(screen.getByTestId('row-team-enrollment-6')).toBeInTheDocument();
  });

  it('displays approvalStatus and status as two independent badges, never collapsed', () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 7, status: 'assigned', approvalStatus: 'pending' })];
    renderPage();
    const row = screen.getByTestId('row-team-enrollment-7');
    expect(row).toHaveTextContent('Not Started');
    expect(row).toHaveTextContent('Pending Approval');
  });

  it('assigns training to a direct report through the manual-scope route', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-assign-training'));
    await userEvent.click(screen.getByTestId('select-assign-course'));
    await userEvent.click(screen.getByRole('option', { name: 'Fire Safety' }));
    await userEvent.click(screen.getByTestId('checkbox-assign-employee-100'));
    await userEvent.click(screen.getByTestId('button-submit-assign-training'));
    expect(state.assignMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 1, data: { scope: 'manual', employeeIds: [100], mandatory: false } },
      expect.anything(),
    );
  });

  it('only offers direct reports in the assign dialog, never an unrelated employee', async () => {
    resetState();
    state.employees = [employee({ id: 100, reportingManagerId: 200 }), employee({ id: 101, firstName: 'Bo', lastName: 'Diaz', reportingManagerId: 999 })];
    renderPage();
    await userEvent.click(screen.getByTestId('button-assign-training'));
    expect(screen.getByTestId('checkbox-assign-employee-100')).toBeInTheDocument();
    expect(screen.queryByTestId('checkbox-assign-employee-101')).not.toBeInTheDocument();
  });

  it('shows instructor actions on an instructor-led row only when the caller is that session\'s own instructor', () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 8, deliveryModeSnapshot: 'instructor_led', sessionId: 500 })];
    state.session = session({ instructorEmployeeId: 200 }); // matches myEmployeeId
    renderPage();
    expect(screen.getByTestId('instructor-actions-8')).toBeInTheDocument();
    expect(screen.getByTestId('button-mark-attended-8')).toBeInTheDocument();
  });

  it('hides instructor actions when the caller is not this session\'s own instructor', () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 9, deliveryModeSnapshot: 'instructor_led', sessionId: 500 })];
    state.session = session({ instructorEmployeeId: 999 }); // not myEmployeeId
    renderPage();
    expect(screen.queryByTestId('instructor-actions-9')).not.toBeInTheDocument();
  });

  it('marks attendance through the real route', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 10, deliveryModeSnapshot: 'instructor_led', sessionId: 500 })];
    state.session = session({ instructorEmployeeId: 200 });
    renderPage();
    await userEvent.click(screen.getByTestId('button-mark-attended-10'));
    expect(screen.getByTestId('dialog-attendance-10')).toHaveTextContent('Mark employee attended?');
    expect(state.attendanceMutateAsync).not.toHaveBeenCalled();
    expect(state.attendanceMutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('dialog-attendance-10-confirm'));
    expect(state.attendanceMutateAsync).toHaveBeenCalledTimes(1);
    expect(state.attendanceMutateAsync).toHaveBeenCalledWith(
      { organizationId: 10, id: 10, data: { attended: true } },
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByTestId('dialog-attendance-10')).not.toBeInTheDocument());
  });

  it('requires a pass/fail result before completing an assessed course, then submits it', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 11, deliveryModeSnapshot: 'instructor_led', sessionId: 500, hasAssessmentSnapshot: true })];
    state.session = session({ instructorEmployeeId: 200 });
    renderPage();
    const completeButton = screen.getByTestId('button-complete-11');
    expect(completeButton).toBeDisabled();
    await userEvent.click(screen.getByTestId('select-passed-11'));
    await userEvent.click(screen.getByRole('option', { name: 'Passed' }));
    expect(completeButton).not.toBeDisabled();
    await userEvent.click(completeButton);
    expect(state.completeMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 11, data: { passed: true } },
      expect.anything(),
    );
  });

  it('completes a non-assessed course with no result field required', async () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 12, deliveryModeSnapshot: 'instructor_led', sessionId: 500, hasAssessmentSnapshot: false })];
    state.session = session({ instructorEmployeeId: 200 });
    renderPage();
    expect(screen.queryByTestId('select-passed-12')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-complete-12'));
    expect(state.completeMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 12, data: undefined },
      expect.anything(),
    );
  });

  it('looks up an enrollment by ID for a session outside the manager\'s own direct reports', async () => {
    resetState();
    state.lookupEnrollment = enrollment({ id: 999, employeeId: 777, deliveryModeSnapshot: 'instructor_led', sessionId: 500 });
    state.session = session({ instructorEmployeeId: 200 });
    renderPage();
    await userEvent.type(screen.getByTestId('input-lookup-enrollment-id'), '999');
    await userEvent.click(screen.getByTestId('button-lookup-enrollment'));
    expect(screen.getByTestId('row-team-enrollment-999')).toBeInTheDocument();
  });

  it('exposes no certificate, evidence, HR-workspace, or dashboard controls', () => {
    resetState();
    state.teamEnrollments = [enrollment({ id: 13, approvalStatus: 'pending' })];
    renderPage();
    expect(screen.queryByRole('button', { name: /issue certificate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload evidence/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });
});
