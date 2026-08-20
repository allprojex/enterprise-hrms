/**
 * Tests for the Learning Courses page (Phase 3D, W86).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LearningCourses from '@/pages/learning-courses';
import type { LearningCourse, LearningCourseSession, MembershipSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    myOrganizations: [] as MembershipSummary[],
    courses: [] as LearningCourse[],
    coursesLoading: false,
    coursesError: undefined as unknown,
    detail: undefined as LearningCourse | undefined,
    detailLoading: false,
    sessions: [] as LearningCourseSession[],
    createCourseMutate: vi.fn() as (...args: unknown[]) => void,
    updateCourseMutate: vi.fn() as (...args: unknown[]) => void,
    createSessionMutate: vi.fn() as (...args: unknown[]) => void,
    updateSessionMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: state.myOrganizations }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListLearningCourses: () => ({ data: state.courses, isLoading: state.coursesLoading, error: state.coursesError, refetch: vi.fn() }),
  getListLearningCoursesQueryKey: () => ['courses'],
  useGetLearningCourse: () => ({ data: state.detail, isLoading: state.detailLoading, error: undefined }),
  getGetLearningCourseQueryKey: () => ['course'],
  useCreateLearningCourse: () => ({ mutate: state.createCourseMutate, isPending: false }),
  useUpdateLearningCourse: () => ({ mutate: state.updateCourseMutate, isPending: false }),
  useListLearningCourseSessions: () => ({ data: state.sessions, isLoading: false, error: undefined, refetch: vi.fn() }),
  getListLearningCourseSessionsQueryKey: () => ['sessions'],
  useCreateLearningCourseSession: () => ({ mutate: state.createSessionMutate, isPending: false }),
  useUpdateLearningCourseSession: () => ({ mutate: state.updateSessionMutate, isPending: false }),
  CreateLearningCourseInputDeliveryMode: { self_paced: 'self_paced', instructor_led: 'instructor_led' },
}));

function membership(roles: string[]): MembershipSummary {
  return { organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles, isPrimaryHr: false };
}

function course(overrides: Partial<LearningCourse> = {}): LearningCourse {
  return {
    id: 1, organizationId: 10, categoryCode: 'compliance', title: 'Code of Conduct', description: null,
    deliveryMode: 'self_paced', mandatoryDefault: false, requiresApproval: false, hasAssessment: false,
    issuesCertificate: false, certificateValidityMonths: null, status: 'draft', createdBy: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningCourses />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.myOrganizations = [membership(['hr_manager'])];
  state.courses = [];
  state.coursesLoading = false;
  state.coursesError = undefined;
  state.detail = undefined;
  state.detailLoading = false;
  state.sessions = [];
  state.createCourseMutate = vi.fn();
  state.updateCourseMutate = vi.fn();
  state.createSessionMutate = vi.fn();
  state.updateSessionMutate = vi.fn();
}

describe('Learning Courses page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.coursesLoading = true;
    renderPage();
    expect(screen.getByText('Learning Courses')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.coursesError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to load courses/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no courses', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no courses yet/i)).toBeInTheDocument();
  });

  it('renders courses in a table with status badges', () => {
    resetState();
    state.courses = [course({ status: 'active' })];
    renderPage();
    const row = screen.getByTestId('row-course-1');
    expect(row).toHaveTextContent('Code of Conduct');
    expect(row).toHaveTextContent('active');
  });

  it('hides the Add Course button for a non-HR-capable role', () => {
    resetState();
    state.myOrganizations = [membership(['employee'])];
    renderPage();
    expect(screen.queryByTestId('button-add-course')).not.toBeInTheDocument();
  });

  it('submits the create form with the entered fields', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-course'));
    await userEvent.type(screen.getByTestId('input-course-title'), 'Fire Safety');
    await userEvent.type(screen.getByTestId('input-course-category'), 'safety');
    await userEvent.click(screen.getByTestId('select-course-delivery-mode'));
    await userEvent.click(screen.getByRole('option', { name: 'Self-Paced' }));
    await userEvent.click(screen.getByTestId('button-submit-course'));
    expect(state.createCourseMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 10,
        data: expect.objectContaining({ title: 'Fire Safety', categoryCode: 'safety', deliveryMode: 'self_paced' }),
      }),
      expect.anything(),
    );
  });

  it('opens the manage dialog and shows existing configuration', async () => {
    resetState();
    state.courses = [course()];
    state.detail = course();
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.getByTestId('input-edit-course-title')).toHaveValue('Code of Conduct');
  });

  it('locks the edit form once the course is archived, except the status field', async () => {
    resetState();
    state.courses = [course({ status: 'archived' })];
    state.detail = course({ status: 'archived' });
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.getByTestId('text-course-archived')).toBeInTheDocument();
    expect(screen.getByTestId('input-edit-course-title')).toBeDisabled();
  });

  it('rejects certificateValidityMonths input from being shown unless issuesCertificate is checked', async () => {
    resetState();
    state.courses = [course()];
    state.detail = course({ issuesCertificate: false });
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.queryByTestId('input-edit-course-certificate-validity')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('checkbox-course-certificate'));
    expect(screen.getByTestId('input-edit-course-certificate-validity')).toBeInTheDocument();
  });

  it('does not show session management for a self-paced course', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'self_paced' })];
    state.detail = course({ deliveryMode: 'self_paced' });
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.getByTestId('text-sessions-not-applicable')).toBeInTheDocument();
    expect(screen.queryByTestId('button-add-session')).not.toBeInTheDocument();
  });

  it('shows session management and existing sessions for an instructor-led course', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'instructor_led' })];
    state.detail = course({ deliveryMode: 'instructor_led' });
    state.sessions = [
      {
        id: 1, organizationId: 10, courseId: 1, scheduledAt: '2026-09-01T09:00:00.000Z', durationMinutes: 60,
        location: 'Room A', meetingLink: null, instructorEmployeeId: null, capacity: 20, status: 'scheduled',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.getByTestId('button-add-session')).toBeInTheDocument();
    const row = screen.getByTestId('row-session-1');
    expect(row).toHaveTextContent('Room A');
    expect(row).toHaveTextContent('scheduled');
  });

  it('does not expose employee enrollment, approval, attendance, or certificate-issuance controls anywhere on the page', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'instructor_led' })];
    state.detail = course({ deliveryMode: 'instructor_led' });
    state.sessions = [
      {
        id: 1, organizationId: 10, courseId: 1, scheduledAt: '2026-09-01T09:00:00.000Z', durationMinutes: 60,
        location: null, meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'scheduled',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /issue certificate/i })).not.toBeInTheDocument();
  });

  it('transitions a scheduled session to completed', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'instructor_led' })];
    state.detail = course({ deliveryMode: 'instructor_led' });
    state.sessions = [
      {
        id: 1, organizationId: 10, courseId: 1, scheduledAt: '2026-09-01T09:00:00.000Z', durationMinutes: 60,
        location: null, meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'scheduled',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    await userEvent.click(screen.getByTestId('button-complete-session-1'));
    expect(state.updateSessionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: { status: 'completed' } }),
      expect.anything(),
    );
  });

  it('does not show complete/cancel controls for a session that already left scheduled', async () => {
    resetState();
    state.courses = [course({ deliveryMode: 'instructor_led' })];
    state.detail = course({ deliveryMode: 'instructor_led' });
    state.sessions = [
      {
        id: 1, organizationId: 10, courseId: 1, scheduledAt: '2026-09-01T09:00:00.000Z', durationMinutes: 60,
        location: null, meetingLink: null, instructorEmployeeId: null, capacity: null, status: 'completed',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-course-1'));
    expect(screen.queryByTestId('button-complete-session-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-cancel-session-1')).not.toBeInTheDocument();
  });
});
