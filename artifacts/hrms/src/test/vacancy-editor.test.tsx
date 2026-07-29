/**
 * Tests for the Vacancy editor/detail page (Phase 3A — the frozen plan's
 * own W48; this session's W47). @workspace/api-client-react is mocked at
 * the hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import VacancyEditor from '@/pages/vacancy-editor';
import type { Vacancy } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    vacancy: undefined as Vacancy | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetVacancy: () => ({ data: state.vacancy, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetVacancyQueryKey: (orgId: number, id: number) => ['vacancy', orgId, id],
  useUpdateVacancy: () => ({ mutate: vi.fn(), isPending: false }),
  usePublishVacancy: () => ({ mutate: vi.fn(), isPending: false }),
  usePauseVacancy: () => ({ mutate: vi.fn(), isPending: false }),
  useCloseVacancy: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveVacancy: () => ({ mutate: vi.fn(), isPending: false }),
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
  const { hook } = memoryLocation({ path: '/vacancies/1/edit', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <VacancyEditor />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Vacancy editor page', () => {
  it('shows a loading state without crashing', () => {
    state.vacancy = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-edit-vacancy')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.vacancy = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this vacancy/i)).toBeInTheDocument();
  });

  it('shows edit and publish actions for a draft vacancy', () => {
    state.vacancy = baseVacancy({ status: 'draft' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-edit-vacancy')).toBeInTheDocument();
    expect(screen.getByTestId('button-publish-vacancy')).toHaveTextContent('Publish');
    expect(screen.getByTestId('button-close-vacancy')).toBeInTheDocument();
    expect(screen.queryByTestId('button-pause-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-archive-vacancy')).not.toBeInTheDocument();
  });

  it('hides edit action and shows pause once the vacancy is published', () => {
    state.vacancy = baseVacancy({ status: 'published' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-edit-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-publish-vacancy')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-pause-vacancy')).toBeInTheDocument();
    expect(screen.getByTestId('button-close-vacancy')).toBeInTheDocument();
  });

  it('shows a resume label for a paused vacancy', () => {
    state.vacancy = baseVacancy({ status: 'paused' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-publish-vacancy')).toHaveTextContent('Resume');
    expect(screen.queryByTestId('button-pause-vacancy')).not.toBeInTheDocument();
  });

  it('shows only archive for a closed vacancy', () => {
    state.vacancy = baseVacancy({ status: 'closed' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-publish-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-pause-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-close-vacancy')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-archive-vacancy')).toBeInTheDocument();
  });

  it('shows no lifecycle actions for an archived vacancy', () => {
    state.vacancy = baseVacancy({ status: 'archived' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-publish-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-pause-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-close-vacancy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-archive-vacancy')).not.toBeInTheDocument();
  });

  it('renders locations and screening questions', () => {
    state.vacancy = baseVacancy({
      locations: [{ id: 1, organizationId: 10, vacancyId: 1, branchId: null, label: 'Remote', createdAt: new Date().toISOString() }],
      questions: [{ id: 1, organizationId: 10, vacancyId: 1, questionText: 'Years of experience?', questionType: 'numeric', isKnockout: false, expectedAnswer: null, displayOrder: 0, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-vacancy-location-1')).toHaveTextContent('Remote');
    expect(screen.getByTestId('row-vacancy-question-1')).toHaveTextContent('Years of experience?');
  });

  it('shows empty states when no locations or questions exist', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no locations added yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no screening questions added yet/i)).toBeInTheDocument();
  });
});
