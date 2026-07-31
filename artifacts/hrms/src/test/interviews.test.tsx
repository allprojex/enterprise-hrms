/**
 * Tests for the Interviews list page (Phase 3A, W54 — Interviews &
 * Scheduling). @workspace/api-client-react is mocked at the hook level — no
 * real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Interviews from '@/pages/interviews';
import type { InterviewListResponse, Interview } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    result: undefined as InterviewListResponse | undefined,
    isLoading: false,
    error: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListInterviews: () => ({ data: state.result, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListInterviewsQueryKey: (orgId: number, params: unknown) => ['interviews', orgId, params],
}));

function baseInterview(overrides: Partial<Interview> = {}): Interview {
  return {
    id: 1,
    organizationId: 10,
    applicationId: 500,
    interviewType: 'virtual',
    scheduledAt: new Date('2026-08-01T10:00:00Z').toISOString(),
    durationMinutes: 45,
    location: null,
    meetingLink: 'https://example.com/meet',
    status: 'scheduled',
    outcome: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    panelMembers: [],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/interviews', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Interviews />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Interviews list page', () => {
  it('shows a loading state without crashing', () => {
    state.result = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-interview-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.result = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load interviews/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no interviews', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no interviews found/i)).toBeInTheDocument();
  });

  it('renders interviews with application link, type, duration, and status', () => {
    state.result = { items: [baseInterview()], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-interview-1');
    expect(row).toHaveTextContent('Application #500');
    expect(row).toHaveTextContent('Virtual');
    expect(row).toHaveTextContent('45 min');
    expect(row).toHaveTextContent('scheduled');
    expect(screen.getByTestId('link-interview-1')).toHaveAttribute('href', '/interviews/1');
  });

  it('shows a destructive badge for a cancelled interview', () => {
    state.result = { items: [baseInterview({ status: 'cancelled' })], total: 1, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-interview-1')).toHaveTextContent('cancelled');
  });

  it('renders the status filter', () => {
    state.result = { items: [], total: 0, page: 1, pageSize: 20 };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('select-filter-interview-status')).toBeInTheDocument();
  });
});
