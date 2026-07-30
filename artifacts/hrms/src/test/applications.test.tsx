/**
 * Tests for the Applications list page (Phase 3A, W51).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Applications from '@/pages/applications';
import type { ApplicationListResponse, ApplicationSummary } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    result: undefined as ApplicationListResponse | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListApplications: () => ({ data: state.result, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListApplicationsQueryKey: (orgId: number, params: unknown) => ['applications', orgId, params],
}));

function baseApplication(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: 1,
    vacancyId: 100,
    vacancyTitle: 'Software Engineer',
    candidateId: 200,
    candidateName: 'Jane Doe',
    candidateEmail: 'jane@example.com',
    currentStageId: null,
    currentStageName: null,
    currentStageCategory: 'applied',
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/applications', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Applications />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Applications list page', () => {
  it('shows a loading state without crashing', () => {
    state.result = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-application-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.result = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load applications/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no applications', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no applications found/i)).toBeInTheDocument();
  });

  it('renders applications with candidate, vacancy, and stage', () => {
    state.result = { items: [baseApplication({ id: 1, currentStageName: 'Screening', currentStageCategory: 'screening' })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-application-1');
    expect(row).toHaveTextContent('Jane Doe');
    expect(row).toHaveTextContent('jane@example.com');
    expect(row).toHaveTextContent('Software Engineer');
    expect(row).toHaveTextContent('Screening');
  });

  it('falls back to the stage category label when no stage name is resolved', () => {
    state.result = { items: [baseApplication({ id: 1, currentStageName: null, currentStageCategory: 'applied' })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-application-1')).toHaveTextContent('applied');
  });

  it('links each application to its detail page', () => {
    state.result = { items: [baseApplication({ id: 42 })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-application-42')).toHaveAttribute('href', '/applications/42');
  });

  it('links to the pipeline board', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-pipeline-board').closest('a')).toHaveAttribute('href', '/pipeline');
  });
});
