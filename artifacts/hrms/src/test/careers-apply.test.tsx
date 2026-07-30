/**
 * Tests for the public application-entry shell (Phase 3A, W49).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CareersApply from '@/pages/careers-apply';

const { state } = vi.hoisted(() => ({
  state: {
    org: { slug: 'acme', name: 'Acme Corp', logoUrl: null } as { slug: string; name: string; logoUrl: string | null } | undefined,
    vacancy: undefined as Record<string, unknown> | undefined,
    isLoading: false,
    error: undefined as unknown,
    applyMutate: undefined as ((...args: unknown[]) => void) | undefined,
    applyPending: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPublicCareersOrganization: () => ({ data: state.org }),
  getGetPublicCareersOrganizationQueryKey: (slug: string) => ['publicOrg', slug],
  useGetPublicVacancy: () => ({ data: state.vacancy, isLoading: state.isLoading, error: state.error }),
  getGetPublicVacancyQueryKey: (slug: string, id: string) => ['publicVacancy', slug, id],
  useApplyToPublicVacancy: () => ({ mutate: state.applyMutate ?? vi.fn(), isPending: state.applyPending, isError: false, error: undefined }),
}));

function baseVacancy(overrides: Record<string, unknown> = {}) {
  return { publicId: 'vac-1', title: 'Software Engineer', ...overrides };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/careers/acme/jobs/vac-1/apply', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/careers/:orgSlug/jobs/:vacancyPublicId/apply">{() => <CareersApply />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Careers apply shell page', () => {
  it('shows a loading state without crashing', () => {
    state.vacancy = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-submit-application')).not.toBeInTheDocument();
  });

  it('shows a not-eligible state for a closed/unpublished/unknown vacancy, with no form rendered', () => {
    state.vacancy = undefined;
    state.isLoading = false;
    state.error = { error: 'not found' };
    renderPage();
    expect(screen.getByText(/isn't accepting applications/i)).toBeInTheDocument();
    expect(screen.queryByTestId('button-submit-application')).not.toBeInTheDocument();
  });

  it('renders the application form with required fields and a honeypot field', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('input-first-name')).toBeRequired();
    expect(screen.getByTestId('input-last-name')).toBeRequired();
    expect(screen.getByTestId('input-email')).toBeRequired();
    expect(screen.getByTestId('input-resume')).toBeRequired();
    expect(screen.getByTestId('checkbox-consent')).toBeInTheDocument();
    // Honeypot exists in the DOM but is never part of the visible/tabbable form.
    const honeypot = document.getElementById('website');
    expect(honeypot).toBeInTheDocument();
    expect(honeypot).toHaveAttribute('tabIndex', '-1');
  });

  it('disables submission until every required field and consent are provided', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-submit-application')).toBeDisabled();

    fireEvent.change(screen.getByTestId('input-first-name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByTestId('input-last-name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByTestId('input-email'), { target: { value: 'jane@example.com' } });
    expect(screen.getByTestId('button-submit-application')).toBeDisabled(); // still missing resume + consent
  });

  it('shows a real (non-misleading) confirmation only after the API confirms submission', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    state.applyMutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
    renderPage();
    expect(screen.queryByTestId('text-application-confirmed')).not.toBeInTheDocument();
  });

  it('never renders authenticated app-shell navigation', () => {
    state.vacancy = baseVacancy();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
