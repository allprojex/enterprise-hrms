/**
 * Tests for the Vacancies list page (Phase 3A — the frozen plan's own W48;
 * this session's W47). @workspace/api-client-react is mocked at the hook
 * level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Vacancies from '@/pages/vacancies';
import type { VacancyListResponse, Vacancy } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    result: undefined as VacancyListResponse | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListVacancies: () => ({ data: state.result, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListVacanciesQueryKey: (orgId: number, params: unknown) => ['vacancies', orgId, params],
  useCreateVacancy: () => ({ mutate: vi.fn(), isPending: false }),
  useListJobRequisitions: () => ({ data: { items: [], total: 0, page: 1, pageSize: 100 } }),
  getListJobRequisitionsQueryKey: (orgId: number, params: unknown) => ['jobRequisitions', orgId, params],
}));

function baseVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    id: 1,
    organizationId: 10,
    requisitionId: 100,
    workflowId: null,
    publicId: 'abc123',
    title: 'Software Engineer',
    visibility: 'internal',
    status: 'draft',
    openingsCount: 1,
    filledCount: 0,
    openDate: null,
    closeDate: null,
    jobDescription: null,
    responsibilities: null,
    requirements: null,
    preferredQualifications: null,
    seoTitle: null,
    seoDescription: null,
    featured: false,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    locations: [],
    questions: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/vacancies', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Vacancies />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Vacancies list page', () => {
  it('shows a loading state without crashing', () => {
    state.result = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-vacancy-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.result = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load vacancies/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no vacancies', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no vacancies found/i)).toBeInTheDocument();
  });

  it('renders vacancies with title, visibility, openings, and status', () => {
    state.result = { items: [baseVacancy({ id: 1, title: 'Software Engineer', status: 'published', filledCount: 1, openingsCount: 2 })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-vacancy-1');
    expect(row).toHaveTextContent('Software Engineer');
    expect(row).toHaveTextContent('1 / 2');
    expect(row).toHaveTextContent('published');
  });

  it('links each vacancy to its editor page', () => {
    state.result = { items: [baseVacancy({ id: 42 })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-vacancy-42')).toHaveAttribute('href', '/vacancies/42/edit');
  });

  it('renders the new-vacancy dialog trigger', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-new-vacancy')).toBeInTheDocument();
  });
});
