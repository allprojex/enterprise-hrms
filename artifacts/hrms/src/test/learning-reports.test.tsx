/**
 * Tests for the Learning Reports page (Phase 3D, W92).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LearningReports from '@/pages/learning-reports';
import type { Report, ReportRunResult, LearningCourse, Employee, Department, Position } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: [] as Report[],
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
    courses: [] as LearningCourse[],
    employees: [] as Employee[],
    departments: [] as Department[],
    positions: [] as Position[],
    calls: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useListLearningCourses: () => ({ data: state.courses }),
  getListLearningCoursesQueryKey: () => ['learningCourses'],
  useListEmployees: () => ({ data: { items: state.employees } }),
  getListEmployeesQueryKey: () => ['employees'],
  useListDepartments: () => ({ data: state.departments }),
  getListDepartmentsQueryKey: () => ['departments'],
  useListPositions: () => ({ data: state.positions }),
  getListPositionsQueryKey: () => ['positions'],
  useRunLearningReport: (_orgId: number, _key: string, params: unknown) => {
    state.calls.push(params);
    return { data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() };
  },
  getRunLearningReportQueryKey: () => ['runLearningReport'],
  getRunLearningReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/learning/reports/${key}`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function learningReport(key: string, label: string): Report {
  return { key, label, description: 'd', category: 'learning' };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningReports />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.reports = [
    learningReport('learning_enrollment_status', 'Enrollment Status'),
    learningReport('learning_completion_summary', 'Completion Summary'),
    learningReport('learning_certificate_expiry', 'Certificate Expiry'),
  ];
  state.catalogLoading = false;
  state.result = undefined;
  state.resultLoading = false;
  state.error = undefined;
  state.courses = [];
  state.employees = [];
  state.departments = [];
  state.positions = [];
  state.calls = [];
}

describe('Learning Reports page', () => {
  it('shows only learning-category reports in the selector, excluding other categories', () => {
    resetState();
    state.reports = [...state.reports, { key: 'headcount', label: 'Headcount', description: 'd', category: 'workforce' }];
    renderPage();
    expect(screen.getByText('Enrollment Status')).toBeInTheDocument();
    expect(screen.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows an empty state when no learning reports are registered', () => {
    resetState();
    state.reports = [];
    renderPage();
    expect(screen.getByText('No reports available')).toBeInTheDocument();
  });

  it('shows an access-denied message on 403', () => {
    resetState();
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('renders report columns and rows, using an em dash for null cells', () => {
    resetState();
    state.result = {
      key: 'learning_enrollment_status',
      label: 'Enrollment Status',
      description: 'd',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'course', label: 'Course' },
        { key: 'completedAt', label: 'Completed' },
      ],
      rows: [{ employee: 'Ada Lovelace', course: 'Fire Safety', completedAt: null }],
    };
    renderPage();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const row = screen.getByTestId('row-learning-report-0');
    expect(row).toHaveTextContent('—');
  });

  it('shows a no-data message for an empty report result', () => {
    resetState();
    state.result = { key: 'learning_enrollment_status', label: 'Enrollment Status', description: 'd', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    renderPage();
    expect(screen.getByText(/no data for this selection/i)).toBeInTheDocument();
  });

  it('enables the CSV download button once a report is loaded', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('button-download-learning-report-csv')).not.toBeDisabled();
  });

  it('offers course/employee/department/position filters', async () => {
    resetState();
    state.courses = [{ id: 1, organizationId: 10, categoryCode: 'compliance', title: 'Fire Safety', deliveryMode: 'self_paced', mandatoryDefault: false, requiresApproval: false, hasAssessment: false, issuesCertificate: false, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as LearningCourse];
    state.employees = [{ id: 42, firstName: 'Ada', lastName: 'Lovelace', employmentStatus: 'active', organizationId: 10, createdAt: '', updatedAt: '' } as Employee];
    state.departments = [{ id: 100, organizationId: 10, name: 'Engineering', code: 'ENG', status: 'active', createdAt: new Date().toISOString() } as Department];
    state.positions = [{ id: 200, organizationId: 10, title: 'Software Engineer', status: 'active', createdAt: new Date().toISOString() } as Position];
    renderPage();
    await userEvent.click(screen.getByTestId('select-learning-report-course'));
    expect(screen.getByRole('option', { name: 'Fire Safety' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId('select-learning-report-department'));
    expect(screen.getByRole('option', { name: 'Engineering' })).toBeInTheDocument();
  });

  // W93 regression: learning_certificate_expiry's own backend runner
  // (runCertificateExpiry) only ever honors employeeId/status — a
  // course/department/position picker that appeared to filter it but
  // silently had no effect would mislead the viewer, so those controls must
  // not render for this one report.
  it('hides course/department/position filters for the certificate expiry report, since the backend never applies them there', () => {
    resetState();
    state.reports = [learningReport('learning_certificate_expiry', 'Certificate Expiry')];
    renderPage();
    expect(screen.queryByTestId('select-learning-report-course')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-learning-report-department')).not.toBeInTheDocument();
    expect(screen.queryByTestId('select-learning-report-position')).not.toBeInTheDocument();
    expect(screen.getByTestId('select-learning-report-employee')).toBeInTheDocument();
  });

  it('still offers course/department/position filters for row-level enrollment reports', () => {
    resetState();
    state.reports = [learningReport('learning_enrollment_status', 'Enrollment Status')];
    renderPage();
    expect(screen.getByTestId('select-learning-report-course')).toBeInTheDocument();
    expect(screen.getByTestId('select-learning-report-department')).toBeInTheDocument();
    expect(screen.getByTestId('select-learning-report-position')).toBeInTheDocument();
  });
});
