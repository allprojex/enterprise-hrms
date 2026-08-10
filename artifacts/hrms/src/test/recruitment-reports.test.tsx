/**
 * Tests for the Recruitment Reports page (Phase 3A, W61).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import RecruitmentReports from '@/pages/recruitment-reports';
import type { Report, ReportRunResult } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    reports: undefined as Report[] | undefined,
    catalogLoading: false,
    result: undefined as ReportRunResult | undefined,
    resultLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListReports: () => ({ data: state.reports, isLoading: state.catalogLoading }),
  getListReportsQueryKey: () => ['reports'],
  useRunRecruitmentReport: () => ({ data: state.result, isLoading: state.resultLoading, error: state.error, refetch: vi.fn() }),
  getRunRecruitmentReportQueryKey: (orgId: number, key: string) => ['recruitment-report', orgId, key],
  getRunRecruitmentReportUrl: (orgId: number, key: string) => `/api/organizations/${orgId}/recruitment/reports/${key}`,
}));

const RECRUITMENT_REPORTS: Report[] = [
  { key: 'recruitment_rejection_reasons', label: 'Rejection Reason Breakdown', description: 'desc', category: 'recruitment' },
  { key: 'recruitment_interview_to_offer_ratio', label: 'Interview-to-Offer Ratio', description: 'desc', category: 'recruitment' },
];

const NON_RECRUITMENT_REPORT: Report = { key: 'headcount', label: 'Headcount', description: 'desc', category: 'workforce' };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/recruitment-reports', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <RecruitmentReports />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Recruitment Reports page', () => {
  it('shows a loading state for the catalog without crashing', () => {
    state.reports = undefined;
    state.catalogLoading = true;
    renderPage();
    expect(screen.queryByTestId('select-recruitment-report')).not.toBeInTheDocument();
  });

  it('shows an empty state when no recruitment reports are registered', () => {
    state.reports = [NON_RECRUITMENT_REPORT];
    state.catalogLoading = false;
    renderPage();
    expect(screen.getByText(/no reports available/i)).toBeInTheDocument();
  });

  it('filters the catalog to recruitment-category reports only', async () => {
    state.reports = [...RECRUITMENT_REPORTS, NON_RECRUITMENT_REPORT];
    state.catalogLoading = false;
    state.result = undefined;
    state.resultLoading = false;
    state.error = undefined;
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('select-recruitment-report'));
    const listbox = within(screen.getByRole('listbox'));
    expect(listbox.getByText('Rejection Reason Breakdown')).toBeInTheDocument();
    expect(listbox.getByText('Interview-to-Offer Ratio')).toBeInTheDocument();
    expect(listbox.queryByText('Headcount')).not.toBeInTheDocument();
  });

  it('shows a denied state for a 403', () => {
    state.reports = RECRUITMENT_REPORTS;
    state.catalogLoading = false;
    state.result = undefined;
    state.resultLoading = false;
    state.error = { status: 403, error: 'Forbidden' };
    renderPage();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it('shows a generic error state for a non-403 failure', () => {
    state.reports = RECRUITMENT_REPORTS;
    state.catalogLoading = false;
    state.result = undefined;
    state.resultLoading = false;
    state.error = { status: 500, error: 'boom' };
    renderPage();
    expect(screen.getByText(/failed to run report/i)).toBeInTheDocument();
  });

  it('shows an empty-data state when the selected report has no rows yet', () => {
    state.reports = RECRUITMENT_REPORTS;
    state.catalogLoading = false;
    state.result = { key: 'recruitment_rejection_reasons', label: 'Rejection Reason Breakdown', description: 'desc', generatedAt: new Date().toISOString(), columns: [{ key: 'reasonCode', label: 'Rejection Reason' }, { key: 'count', label: 'Applications' }], rows: [] };
    state.resultLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });

  it('renders the result table with columns and rows, including a null cell as a dash', () => {
    state.reports = RECRUITMENT_REPORTS;
    state.catalogLoading = false;
    state.result = {
      key: 'recruitment_interview_to_offer_ratio',
      label: 'Interview-to-Offer Ratio',
      description: 'desc',
      generatedAt: new Date().toISOString(),
      columns: [
        { key: 'applicationsInterviewedCount', label: 'Applications Interviewed' },
        { key: 'ratioPercent', label: 'Interview-to-Offer Ratio (%)' },
      ],
      rows: [{ applicationsInterviewedCount: 0, ratioPercent: null }],
    };
    state.resultLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-recruitment-report-0')).toHaveTextContent('0');
    expect(screen.getByTestId('row-recruitment-report-0')).toHaveTextContent('—');
  });

  it('enables the CSV download button once a report is selected', () => {
    state.reports = RECRUITMENT_REPORTS;
    state.catalogLoading = false;
    state.result = { key: 'recruitment_rejection_reasons', label: 'Rejection Reason Breakdown', description: 'desc', generatedAt: new Date().toISOString(), columns: [], rows: [] };
    state.resultLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-download-recruitment-report-csv')).not.toBeDisabled();
  });
});
