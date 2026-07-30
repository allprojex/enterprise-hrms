/**
 * Tests for the anonymous application status-check page (Phase 3A, W49).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CareersStatus from '@/pages/careers-status';

const { state } = vi.hoisted(() => ({
  state: {
    data: undefined as { vacancyTitle: string; submittedAt: string; status: string } | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPublicApplicationStatus: () => ({ data: state.data, isLoading: state.isLoading, error: state.error }),
  getGetPublicApplicationStatusQueryKey: (slug: string, token: string) => ['publicApplicationStatus', slug, token],
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/careers/acme/status/good-token', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/careers/:orgSlug/status/:token">{() => <CareersStatus />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Careers application status page', () => {
  it('shows a loading state without crashing', () => {
    state.data = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('text-status-found')).not.toBeInTheDocument();
  });

  it('shows a not-found state for an unknown or expired token', () => {
    state.data = undefined;
    state.isLoading = false;
    state.error = { error: 'not found' };
    renderPage();
    expect(screen.getByTestId('text-status-not-found')).toBeInTheDocument();
  });

  it('renders the application status for a valid token', () => {
    state.data = { vacancyTitle: 'Software Engineer', submittedAt: new Date().toISOString(), status: 'submitted' };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const found = screen.getByTestId('text-status-found');
    expect(found).toHaveTextContent('Software Engineer');
    expect(found).toHaveTextContent(/submitted/i);
  });

  it('links back to the careers landing page', () => {
    state.data = { vacancyTitle: 'Software Engineer', submittedAt: new Date().toISOString(), status: 'submitted' };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-back-to-careers')).toHaveAttribute('href', '/careers/acme');
  });
});
