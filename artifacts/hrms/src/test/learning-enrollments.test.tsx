/**
 * Tests for the Internal HR/L&D Workspace page (Phase 3D, W91) —
 * /learning-enrollments: org-wide enrollment list + approval queue +
 * administrative corrections, bulk-assign, and certificate administration.
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made. Every mutation asserted here reuses an
 * existing W87/W89/W90 route verbatim; this suite is not re-testing that
 * business logic, only that the page calls the right route with the right
 * arguments.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LearningEnrollments from '@/pages/learning-enrollments';
import type {
  LearningEnrollment,
  LearningCertificate,
  LearningCourse,
  LearningCourseSession,
  Employee,
  Department,
  Position,
  MembershipSummary,
} from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    enrollments: { items: [] as LearningEnrollment[], total: 0, page: 1, pageSize: 20 },
    enrollmentsLoading: false,
    enrollmentsError: undefined as unknown,
    certificates: { items: [] as LearningCertificate[], total: 0, page: 1, pageSize: 20 },
    certificatesLoading: false,
    certificatesError: undefined as unknown,
    courses: [] as LearningCourse[],
    sessions: [] as LearningCourseSession[],
    employees: [] as Employee[],
    departments: [] as Department[],
    positions: [] as Position[],
    approveMutate: vi.fn() as (...args: unknown[]) => void,
    rejectMutate: vi.fn() as (...args: unknown[]) => void,
    cancelMutate: vi.fn() as (...args: unknown[]) => void,
    attendanceMutate: vi.fn() as (...args: unknown[]) => void,
    completeMutate: vi.fn() as (...args: unknown[]) => void,
    assignMutate: vi.fn() as (...args: unknown[]) => void,
    revokeMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListLearningEnrollments: () => ({ data: state.enrollments, isLoading: state.enrollmentsLoading, error: state.enrollmentsError, refetch: vi.fn() }),
  getListLearningEnrollmentsQueryKey: () => ['enrollments'],
  useApproveLearningEnrollment: () => ({ mutate: state.approveMutate, isPending: false }),
  useRejectLearningEnrollment: () => ({ mutate: state.rejectMutate, isPending: false }),
  useCancelLearningEnrollment: () => ({ mutate: state.cancelMutate, isPending: false }),
  useMarkLearningEnrollmentAttendance: () => ({ mutate: state.attendanceMutate, isPending: false }),
  useCompleteLearningEnrollment: () => ({ mutate: state.completeMutate, isPending: false }),
  useAssignLearningEnrollments: () => ({ mutate: state.assignMutate, isPending: false }),
  useListLearningCertificates: () => ({ data: state.certificates, isLoading: state.certificatesLoading, error: state.certificatesError, refetch: vi.fn() }),
  getListLearningCertificatesQueryKey: () => ['certificates'],
  useRevokeLearningCertificate: () => ({ mutate: state.revokeMutate, isPending: false }),
  useListLearningCourses: () => ({ data: state.courses }),
  getListLearningCoursesQueryKey: () => ['courses'],
  useListLearningCourseSessions: () => ({ data: state.sessions }),
  getListLearningCourseSessionsQueryKey: () => ['sessions'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListPositions: () => ({ data: state.positions }),
  getListPositionsQueryKey: () => ['positions'],
  // Evidence (W90) — embedded via LearningEvidenceSection, not under test on this page's own suite.
  useListLearningEnrollmentEvidence: () => ({ data: [], isLoading: false, error: undefined }),
  getListLearningEnrollmentEvidenceQueryKey: () => ['learningEvidence'],
  useAddLearningEnrollmentEvidence: () => ({ mutate: vi.fn(), isPending: false }),
  getDownloadLearningEnrollmentEvidenceUrl: (orgId: number, enrollmentId: number, evidenceId: number) => `/api/organizations/${orgId}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`,
  ListLearningEnrollmentsStatus: { assigned: 'assigned', in_progress: 'in_progress', completed: 'completed', failed: 'failed', cancelled: 'cancelled' },
  ListLearningEnrollmentsApprovalStatus: { auto_approved: 'auto_approved', pending: 'pending', approved: 'approved', rejected: 'rejected' },
  ListLearningCertificatesStatus: { active: 'active', revoked: 'revoked' },
  AssignLearningEnrollmentsInputScope: { all_active: 'all_active', department: 'department', position: 'position', manual: 'manual' },
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', logoUrl: null, systemDisplayName: null, status: 'active', roles, isPrimaryHr: false };
}

function enrollment(overrides: Partial<LearningEnrollment> = {}): LearningEnrollment {
  return {
    id: 1, organizationId: 10, courseId: 1, sessionId: null, employeeId: 42,
    courseTitleSnapshot: 'Code of Conduct', categorySnapshot: 'compliance', deliveryModeSnapshot: 'self_paced',
    hasAssessmentSnapshot: false, issuesCertificateSnapshot: false, certificateValidityMonthsSnapshot: null,
    departmentIdSnapshot: 5, positionIdSnapshot: 9, managerEmployeeIdSnapshot: 7,
    mandatoryAtAssignment: false, originType: 'hr_assigned', assignedByMembershipId: 2, dueDate: null,
    approvalStatus: 'auto_approved', approvalDecidedByMembershipId: null, approvalDecidedAt: null,
    status: 'assigned', attended: null, attendanceMarkedByMembershipId: null, attendanceMarkedAt: null,
    passed: null, score: null, completedAt: null, cancelReason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function certificate(overrides: Partial<LearningCertificate> = {}): LearningCertificate {
  return {
    id: 1, organizationId: 10, enrollmentId: 1, employeeId: 42, courseTitleSnapshot: 'Code of Conduct',
    certificateNumber: null, issuedAt: new Date('2026-01-01').toISOString(), expiresAt: null, status: 'active',
    revokedByMembershipId: null, revokedAt: null, revokeReason: null, employeeDocumentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
function course(overrides: Partial<LearningCourse> = {}): LearningCourse {
  return {
    id: 1, organizationId: 10, categoryCode: 'compliance', title: 'Code of Conduct', description: null,
    deliveryMode: 'self_paced', mandatoryDefault: false, requiresApproval: false, hasAssessment: false,
    issuesCertificate: false, certificateValidityMonths: null, status: 'active', createdBy: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
function employee(overrides: Partial<Employee> = {}): Employee {
  return { id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '', ...overrides } as Employee;
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.enrollments = { items: [], total: 0, page: 1, pageSize: 20 };
  state.enrollmentsLoading = false;
  state.enrollmentsError = undefined;
  state.certificates = { items: [], total: 0, page: 1, pageSize: 20 };
  state.certificatesLoading = false;
  state.certificatesError = undefined;
  state.courses = [course()];
  state.sessions = [];
  state.employees = [employee()];
  state.departments = [];
  state.positions = [];
  state.approveMutate = vi.fn();
  state.rejectMutate = vi.fn();
  state.cancelMutate = vi.fn();
  state.attendanceMutate = vi.fn();
  state.completeMutate = vi.fn();
  state.assignMutate = vi.fn();
  state.revokeMutate = vi.fn();
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningEnrollments />
    </QueryClientProvider>,
  );
}

describe('Learning Enrollments (internal HR/L&D workspace) page', () => {
  it('denies access to a non-HR-capable viewer', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    expect(screen.queryByText('Learning Enrollments')).not.toBeInTheDocument();
  });

  it('shows an empty state when no enrollments match', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no enrollments found/i)).toBeInTheDocument();
  });

  it('lists enrollments with employee, course, origin, approval and status', () => {
    resetState();
    state.enrollments = { items: [enrollment()], total: 1, page: 1, pageSize: 20 };
    renderPage();
    const row = screen.getByTestId('row-enrollment-1');
    expect(row).toHaveTextContent('Ada Lovelace');
    expect(row).toHaveTextContent('Code of Conduct');
    expect(row).toHaveTextContent('HR Assigned');
    expect(row).toHaveTextContent('Approved');
    expect(row).toHaveTextContent('Not Started');
  });

  it('shows pagination controls only when there is more than one page', () => {
    resetState();
    state.enrollments = { items: [enrollment()], total: 45, page: 1, pageSize: 20 };
    renderPage();
    expect(screen.getByTestId('button-enrollments-next-page')).toBeInTheDocument();
    expect(screen.getByTestId('button-enrollments-prev-page')).toBeDisabled();
  });

  it('opens the detail dialog and shows approve/reject for a pending request', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ approvalStatus: 'pending' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.getByTestId('button-approve-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-reject-1')).toBeInTheDocument();
  });

  it('approves an enrollment through the existing W87 route', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ approvalStatus: 'pending' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    await userEvent.click(screen.getByTestId('button-approve-1'));
    expect(state.approveMutate).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
  });

  it('does not show approve/reject once a decision has already been made', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ approvalStatus: 'approved' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.queryByTestId('button-approve-1')).not.toBeInTheDocument();
  });

  it('requires a reason before an administrative cancel is confirmed', async () => {
    resetState();
    state.enrollments = { items: [enrollment()], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    await userEvent.click(screen.getByTestId('button-open-cancel-1'));
    expect(screen.getByTestId('button-confirm-cancel-1')).toBeDisabled();
    await userEvent.type(screen.getByTestId('textarea-cancel-reason-1'), 'Employee separated');
    expect(screen.getByTestId('button-confirm-cancel-1')).not.toBeDisabled();
    await userEvent.click(screen.getByTestId('button-confirm-cancel-1'));
    expect(state.cancelMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 1, data: { cancelReason: 'Employee separated' } },
      expect.anything(),
    );
  });

  it('never offers cancel/attendance/complete once an enrollment is terminal', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ status: 'completed', approvalStatus: 'approved' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.queryByTestId('button-open-cancel-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-complete-1')).not.toBeInTheDocument();
  });

  it('offers attendance correction only for an instructor-led enrollment with a session', async () => {
    resetState();
    state.enrollments = {
      items: [enrollment({ deliveryModeSnapshot: 'instructor_led', sessionId: 3, approvalStatus: 'approved' })],
      total: 1, page: 1, pageSize: 20,
    };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.getByTestId('button-mark-attended-1')).toBeInTheDocument();
    expect(screen.getByTestId('button-mark-absent-1')).toBeInTheDocument();
  });

  it('does not offer attendance correction for a self-paced enrollment', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ approvalStatus: 'approved' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.queryByTestId('button-mark-attended-1')).not.toBeInTheDocument();
  });

  it('requires a pass/fail result before completing an assessed enrollment', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ hasAssessmentSnapshot: true, approvalStatus: 'approved' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.getByTestId('button-complete-1')).toBeDisabled();
  });

  it('completes an enrollment administratively through the existing W89 route', async () => {
    resetState();
    state.enrollments = { items: [enrollment({ approvalStatus: 'approved' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    await userEvent.click(screen.getByTestId('button-complete-1'));
    expect(state.completeMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 1, data: undefined },
      expect.anything(),
    );
  });

  it('shows historical department/position/manager context from the enrollment\'s own snapshot', async () => {
    resetState();
    state.employees = [employee(), employee({ id: 7, firstName: 'Grace', lastName: 'Hopper' })];
    state.enrollments = { items: [enrollment()], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-enrollment-1'));
    expect(screen.getByText(/Manager of record \(at assignment\): Grace Hopper/)).toBeInTheDocument();
  });

  it('bulk-assigns training with full audience scope through the existing W87 route', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-bulk-assign'));
    await userEvent.click(screen.getByTestId('select-bulk-assign-course'));
    await userEvent.click(screen.getByRole('option', { name: 'Code of Conduct' }));
    expect(screen.getByTestId('button-submit-bulk-assign')).not.toBeDisabled();
    await userEvent.click(screen.getByTestId('button-submit-bulk-assign'));
    expect(state.assignMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: expect.objectContaining({ scope: 'all_active' }) }),
      expect.anything(),
    );
  });

  it('requires a session for a bulk-assign targeting an instructor-led course', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'instructor_led' })];
    state.sessions = [{ id: 9, organizationId: 10, courseId: 1, scheduledAt: new Date('2026-03-01').toISOString(), durationMinutes: 60, status: 'scheduled', createdAt: '', updatedAt: '' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-bulk-assign'));
    await userEvent.click(screen.getByTestId('select-bulk-assign-course'));
    await userEvent.click(screen.getByRole('option', { name: 'Code of Conduct' }));
    expect(screen.getByTestId('button-submit-bulk-assign')).toBeDisabled();
    expect(screen.getByTestId('select-bulk-assign-session')).toBeInTheDocument();
  });

  it('shows an empty state on the Certificates tab when none match', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('tab-certificates'));
    expect(screen.getByText(/no certificates found/i)).toBeInTheDocument();
  });

  it('lists certificates and marks an unexpired active one as Active', async () => {
    resetState();
    state.certificates = { items: [certificate()], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('tab-certificates'));
    const row = screen.getByTestId('row-certificate-1');
    expect(row).toHaveTextContent('Ada Lovelace');
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('shows a live-computed Expired badge for a past-due active certificate, never a stored status', async () => {
    resetState();
    state.certificates = { items: [certificate({ expiresAt: '2020-01-01T00:00:00.000Z' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('tab-certificates'));
    expect(within(screen.getByTestId('row-certificate-1')).getByText('Expired')).toBeInTheDocument();
  });

  it('does not offer revoke on an already-revoked certificate', async () => {
    resetState();
    state.certificates = { items: [certificate({ status: 'revoked', revokeReason: 'Fraud' })], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('tab-certificates'));
    expect(screen.queryByTestId('button-open-revoke-1')).not.toBeInTheDocument();
  });

  it('requires a mandatory reason before a certificate revocation is confirmed', async () => {
    resetState();
    state.certificates = { items: [certificate()], total: 1, page: 1, pageSize: 20 };
    renderPage();
    await userEvent.click(screen.getByTestId('tab-certificates'));
    await userEvent.click(screen.getByTestId('button-open-revoke-1'));
    expect(screen.getByTestId('button-confirm-revoke-1')).toBeDisabled();
    await userEvent.type(screen.getByTestId('textarea-revoke-reason-1'), 'Issued in error');
    await userEvent.click(screen.getByTestId('button-confirm-revoke-1'));
    expect(state.revokeMutate).toHaveBeenCalledWith(
      { organizationId: 10, id: 1, data: { revokeReason: 'Issued in error' } },
      expect.anything(),
    );
  });
});
