/**
 * Tests for the public vacancy detail page (Phase 3A, W49).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CareersVacancyDetail from '@/pages/careers-vacancy-detail';

const { state } = vi.hoisted(() => ({
  state: {
    org: { slug: 'acme', name: 'Acme Corp', logoUrl: null } as { slug: string; name: string; logoUrl: string | null } | undefined,
    vacancy: undefined as Record<string, unknown> | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPublicCareersOrganization: () => ({ data: state.org }),
  getGetPublicCareersOrganizationQueryKey: (slug: string) => ['publicOrg', slug],
  useGetPublicVacancy: () => ({ data: state.vacancy, isLoading: state.isLoading, error: state.error }),
  getGetPublicVacancyQueryKey: (slug: string, id: string) => ['publicVacancy', slug, id],
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
    jobDescription: 'We build great things here.',
    responsibilities: 'Ship code.',
    requirements: '5 years experience.',
    preferredQualifications: 'A degree.',
    seoTitle: null,
    seoDescription: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/careers/acme/jobs/vac-1', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/careers/:orgSlug/jobs/:vacancyPublicId">{() => <CareersVacancyDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Careers vacancy detail page', () => {
  it('shows a loading state without crashing', () => {
    state.vacancy = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-apply')).not.toBeInTheDocument();
  });

  it('shows a not-found state for an ineligible or unknown vacancy', () => {
    state.vacancy = undefined;
    state.isLoading = false;
    state.error = { error: 'not found' };
    renderPage();
    expect(screen.getByText(/job not found/i)).toBeInTheDocument();
    expect(screen.getByTestId('link-back-to-careers')).toBeInTheDocument();
  });

  it('renders public-safe fields and an apply call to action', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    expect(screen.getByText(/we build great things here/i)).toBeInTheDocument();
    expect(screen.getByText(/ship code/i)).toBeInTheDocument();
    const apply = screen.getByTestId('link-apply');
    expect(apply).toHaveAttribute('href', '/careers/acme/jobs/vac-1/apply');
  });

  it('never renders private fields (hiring manager, recruiter, salary, internal IDs)', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/hiring manager/i);
    expect(body).not.toMatch(/recruiter/i);
    expect(body).not.toMatch(/salary/i);
    expect(body).not.toMatch(/requisition/i);
  });

  it('never renders authenticated app-shell navigation', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
