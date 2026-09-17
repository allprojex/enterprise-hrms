/**
 * Tests for the Interview detail page (Phase 3A, W54 — Interviews &
 * Scheduling). @workspace/api-client-react is mocked at the hook level — no
 * real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import InterviewDetail from '@/pages/interview-detail';
import type { Interview } from '@workspace/api-client-react';

type MutateOpts = { onSuccess?: (data?: unknown) => void; onError?: (err: unknown) => void };

const { state } = vi.hoisted(() => ({
  state: {
    interview: undefined as Interview | undefined,
    isLoading: false,
    error: undefined as unknown,
    cancelAsync: (() => Promise.resolve()) as (vars: unknown, opts?: unknown) => Promise<unknown>,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetInterview: () => ({ data: state.interview, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetInterviewQueryKey: (orgId: number, id: number) => ['interview', orgId, id],
  useCancelInterview: () => ({ mutate: vi.fn(), mutateAsync: state.cancelAsync, isPending: false }),
  useUpdateInterview: () => ({ mutate: vi.fn(), isPending: false }),
  useListMembers: () => ({ data: [{ membershipId: 5, applicationUserId: 1, email: 'lead@example.com', firstName: 'Lead', lastName: 'Interviewer', status: 'active', roles: [], isPrimaryHr: false }] }),
  getListMembersQueryKey: (orgId: number) => ['members', orgId],
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
  const { hook } = memoryLocation({ path: '/interviews/1', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/interviews/:id">{() => <InterviewDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Interview detail page', () => {
  it('shows a loading state without crashing', () => {
    state.interview = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('badge-interview-status')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.interview = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this interview/i)).toBeInTheDocument();
  });

  it('renders interview details and links to the application', () => {
    state.interview = baseInterview();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-interview-application')).toHaveAttribute('href', '/applications/500');
    expect(screen.getByTestId('badge-interview-status')).toHaveTextContent('scheduled');
    expect(screen.getByText('45 min')).toBeInTheDocument();
  });

  it('shows scheduling actions for a scheduled interview', () => {
    state.interview = baseInterview();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-reschedule-interview')).toBeInTheDocument();
    expect(screen.getByTestId('button-mark-completed')).toBeInTheDocument();
    expect(screen.getByTestId('button-mark-no-show')).toBeInTheDocument();
    expect(screen.getByTestId('button-cancel-interview')).toBeInTheDocument();
    expect(screen.getByTestId('button-edit-panel')).toBeInTheDocument();
  });

  it('hides scheduling actions for a completed interview and shows its outcome', () => {
    state.interview = baseInterview({ status: 'completed', outcome: 'Went well' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-reschedule-interview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-cancel-interview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-panel')).not.toBeInTheDocument();
    expect(screen.getByText('Went well')).toBeInTheDocument();
  });

  it('shows an empty state when there are no panel members', () => {
    state.interview = baseInterview();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no panel members added yet/i)).toBeInTheDocument();
  });

  it('renders an internal panel member resolved by name, and an external one', () => {
    state.interview = baseInterview({
      panelMembers: [
        { id: 1, organizationId: 10, interviewId: 1, interviewerMembershipId: 5, externalInterviewerName: null, externalInterviewerEmail: null, role: 'lead', conflictDeclared: false, createdAt: new Date().toISOString() },
        { id: 2, organizationId: 10, interviewId: 1, interviewerMembershipId: null, externalInterviewerName: 'External Panelist', externalInterviewerEmail: 'ext@example.com', role: 'member', conflictDeclared: true, createdAt: new Date().toISOString() },
      ],
    });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-panel-member-1')).toHaveTextContent('Lead Interviewer');
    expect(screen.getByTestId('row-panel-member-2')).toHaveTextContent('External Panelist');
    expect(screen.getByTestId('row-panel-member-2')).toHaveTextContent('Conflict declared');
  });

  describe('cancel confirmation', () => {
    it('asks before cancelling, and Keep Interview cancels nothing', async () => {
      state.interview = baseInterview();
      state.isLoading = false;
      state.error = undefined;
      state.cancelAsync = vi.fn(() => Promise.resolve());
      renderPage();
      await userEvent.click(screen.getByTestId('button-cancel-interview'));
      const dialog = screen.getByTestId('dialog-cancel-interview');
      expect(dialog).toHaveTextContent('Cancel interview?');
      expect(dialog).toHaveTextContent('cancel the interview for Application #500');
      expect(state.cancelAsync).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('dialog-cancel-interview-cancel'));
      await waitFor(() => expect(screen.queryByTestId('dialog-cancel-interview')).not.toBeInTheDocument());
      expect(state.cancelAsync).not.toHaveBeenCalled();
    });

    it('cancels exactly once on confirm, invalidates the interview, and closes', async () => {
      state.interview = baseInterview();
      state.isLoading = false;
      state.error = undefined;
      state.cancelAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      });
      const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      renderPage();
      await userEvent.click(screen.getByTestId('button-cancel-interview'));
      await userEvent.click(screen.getByTestId('dialog-cancel-interview-confirm'));

      await waitFor(() => expect(screen.queryByTestId('dialog-cancel-interview')).not.toBeInTheDocument());
      expect(state.cancelAsync).toHaveBeenCalledTimes(1);
      expect(state.cancelAsync).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['interview', 10, 1] });
      invalidateSpy.mockRestore();
    });

    it('keeps the dialog open when cancelling fails', async () => {
      state.interview = baseInterview();
      state.isLoading = false;
      state.error = undefined;
      state.cancelAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
        const err = { error: 'boom' };
        opts?.onError?.(err);
        return Promise.reject(err);
      });
      renderPage();
      await userEvent.click(screen.getByTestId('button-cancel-interview'));
      await userEvent.click(screen.getByTestId('dialog-cancel-interview-confirm'));

      await waitFor(() => expect(state.cancelAsync).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('dialog-cancel-interview')).toBeInTheDocument();
      expect(screen.getByTestId('badge-interview-status')).toHaveTextContent('scheduled');
    });
  });
});
