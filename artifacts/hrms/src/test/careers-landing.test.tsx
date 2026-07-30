/**
 * Tests for the public Careers Portal landing/list page (Phase 3A, W49).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made. This page is never wrapped in <SecureRoute>/<AppShell>.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CareersLanding from '@/pages/careers-landing';

const { state } = vi.hoisted(() => ({
  state: {
    org: undefined as { slug: string; name: string; logoUrl: string | null } | undefined,
    orgLoading: false,
    orgError: undefined as unknown,
    result: undefined as { items: unknown[]; total: number; page: number; pageSize: number } | undefined,
    vacanciesLoading: false,
    vacanciesError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPublicCareersOrganization: () => ({ data: state.org, isLoading: state.orgLoading, error: state.orgError }),
  getGetPublicCareersOrganizationQueryKey: (slug: string) => ['publicOrg', slug],
  useListPublicVacancies: () => ({ data: state.result, isLoading: state.vacanciesLoading, error: state.vacanciesError, refetch: vi.fn() }),
  getListPublicVacanciesQueryKey: (slug: string, params: unknown) => ['publicVacancies', slug, params],
}));

function baseVacancy(overrides: Record<string, unknown> = {}) {
  return {
    publicId: 'vac-1',
    title: 'Software Engineer',
    departmentName: 'Engineering',
    locations: ['Remote'],
    employmentType: 'full_time',
    workplaceType: 'remote',
    openingsCount: 2,
    openDate: null,
    closeDate: null,
    summary: 'Build great things.',
    featured: false,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/careers/acme', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/careers/:orgSlug">{() => <CareersLanding />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Careers landing page', () => {
  it('shows a loading state while the organization resolves', () => {
    state.org = undefined;
    state.orgLoading = true;
    state.orgError = undefined;
    renderPage();
    expect(screen.queryByTestId('text-org-name')).not.toBeInTheDocument();
  });

  it('shows a not-available message when the organization cannot be resolved', () => {
    state.org = undefined;
    state.orgLoading = false;
    state.orgError = { error: 'not found' };
    renderPage();
    expect(screen.getByText(/careers page not available/i)).toBeInTheDocument();
  });

  it('renders organization branding once resolved', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.vacanciesLoading = false;
    state.vacanciesError = undefined;
    renderPage();
    expect(screen.getByTestId('text-org-name')).toHaveTextContent('Acme Corp');
  });

  it('shows an empty state when there are no open positions', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.vacanciesLoading = false;
    state.vacanciesError = undefined;
    renderPage();
    expect(screen.getByText(/no open positions right now/i)).toBeInTheDocument();
  });

  it('shows an error state when the vacancy list fails to load', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = undefined;
    state.vacanciesLoading = false;
    state.vacanciesError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load open positions/i)).toBeInTheDocument();
  });

  it('renders vacancy cards linking to the detail page, with only public-safe fields', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = { items: [baseVacancy()], total: 1, page: 1, pageSize: 20 };
    state.vacanciesLoading = false;
    state.vacanciesError = undefined;
    renderPage();
    const link = screen.getByTestId('link-vacancy-vac-1');
    expect(link).toHaveAttribute('href', '/careers/acme/jobs/vac-1');
    expect(link).toHaveTextContent('Software Engineer');
    expect(link).toHaveTextContent('Engineering');
    expect(link).toHaveTextContent('Remote');
  });

  it('provides accessible search and filter controls', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.vacanciesLoading = false;
    state.vacanciesError = undefined;
    renderPage();
    expect(screen.getByTestId('input-careers-search')).toHaveAccessibleName();
    expect(screen.getByTestId('select-employment-type')).toHaveAccessibleName();
    expect(screen.getByTestId('select-workplace-type')).toHaveAccessibleName();
  });

  it('never renders authenticated app-shell navigation', () => {
    state.org = { slug: 'acme', name: 'Acme Corp', logoUrl: null };
    state.orgLoading = false;
    state.orgError = undefined;
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.vacanciesLoading = false;
    state.vacanciesError = undefined;
    renderPage();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
