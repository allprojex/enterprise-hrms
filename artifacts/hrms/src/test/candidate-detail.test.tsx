/**
 * Tests for the Candidate detail page (Phase 3A, W53 — Candidate Notes,
 * Tags, and Talent Pools). @workspace/api-client-react is mocked at the
 * hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CandidateDetail from '@/pages/candidate-detail';
import type { Candidate, CandidateNote, CandidateTag } from '@workspace/api-client-react';

type MutateOpts = { onSuccess?: (data?: unknown) => void; onError?: (err: unknown) => void };

const { state } = vi.hoisted(() => ({
  state: {
    candidate: undefined as Candidate | undefined,
    isLoading: false,
    error: undefined as unknown,
    notes: [] as CandidateNote[],
    tags: [] as CandidateTag[],
    removeTagAsync: (() => Promise.resolve()) as (vars: unknown, opts?: unknown) => Promise<unknown>,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetCandidate: () => ({ data: state.candidate, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetCandidateQueryKey: (orgId: number, id: number) => ['candidate', orgId, id],
  useListCandidateNotes: () => ({ data: state.notes, isLoading: false }),
  getListCandidateNotesQueryKey: (orgId: number, id: number) => ['candidateNotes', orgId, id],
  useCreateCandidateNote: () => ({ mutate: vi.fn(), isPending: false }),
  useListCandidateTags: () => ({ data: state.tags, isLoading: false }),
  getListCandidateTagsQueryKey: (orgId: number, id: number) => ['candidateTags', orgId, id],
  useAddCandidateTag: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveCandidateTag: () => ({ mutate: vi.fn(), mutateAsync: state.removeTagAsync, isPending: false }),
}));

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 200,
    organizationId: 10,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '555-1234',
    source: 'careers_portal',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/candidates/200', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/candidates/:id">{() => <CandidateDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Candidate detail page', () => {
  it('shows a loading state without crashing', () => {
    state.candidate = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.candidate = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this candidate/i)).toBeInTheDocument();
  });

  it('renders candidate info', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [];
    state.tags = [];
    renderPage();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('555-1234')).toBeInTheDocument();
  });

  it('renders tags with remove controls', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [];
    state.tags = [{ id: 1, organizationId: 10, candidateId: 200, tag: 'senior', createdAt: new Date().toISOString() }];
    renderPage();
    expect(screen.getByTestId('badge-tag-1')).toHaveTextContent('senior');
    expect(screen.getByTestId('button-remove-tag-1')).toBeInTheDocument();
  });

  it('shows an empty state when there are no tags', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [];
    state.tags = [];
    renderPage();
    expect(screen.getByText(/no tags yet/i)).toBeInTheDocument();
  });

  it('renders notes, distinguishing an application-scoped note', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [
      { id: 1, organizationId: 10, candidateId: 200, applicationId: null, authorMembershipId: 5, note: 'Strong communicator', createdAt: new Date().toISOString() },
      { id: 2, organizationId: 10, candidateId: 200, applicationId: 500, authorMembershipId: 5, note: 'Great screening call', createdAt: new Date().toISOString() },
    ];
    state.tags = [];
    renderPage();
    expect(screen.getByTestId('row-note-1')).toHaveTextContent('Strong communicator');
    expect(screen.getByTestId('row-note-2')).toHaveTextContent('Application #500');
  });

  it('shows an empty state when there are no notes', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [];
    state.tags = [];
    renderPage();
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it('disables the add-note and add-tag buttons until text is entered', () => {
    state.candidate = baseCandidate();
    state.isLoading = false;
    state.error = undefined;
    state.notes = [];
    state.tags = [];
    renderPage();
    expect(screen.getByTestId('button-add-note')).toBeDisabled();
    expect(screen.getByTestId('button-add-tag')).toBeDisabled();
  });

  describe('remove tag confirmation', () => {
    function setup() {
      state.candidate = baseCandidate();
      state.isLoading = false;
      state.error = undefined;
      state.notes = [];
      state.tags = [{ id: 1, organizationId: 10, candidateId: 200, tag: 'senior', createdAt: new Date().toISOString() }];
    }

    it('asks before removing a tag, and Cancel removes nothing', async () => {
      setup();
      state.removeTagAsync = vi.fn(() => Promise.resolve());
      renderPage();
      await userEvent.click(screen.getByTestId('button-remove-tag-1'));
      const dialog = screen.getByTestId('dialog-remove-candidate-tag');
      expect(dialog).toHaveTextContent('Remove tag?');
      expect(dialog).toHaveTextContent('remove the tag “senior” from Jane Doe');
      expect(state.removeTagAsync).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('dialog-remove-candidate-tag-cancel'));
      await waitFor(() => expect(screen.queryByTestId('dialog-remove-candidate-tag')).not.toBeInTheDocument());
      expect(state.removeTagAsync).not.toHaveBeenCalled();
    });

    it('removes the tag exactly once on confirm, invalidates the tag list, and closes', async () => {
      setup();
      state.removeTagAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
        opts?.onSuccess?.();
        return Promise.resolve();
      });
      const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      renderPage();
      await userEvent.click(screen.getByTestId('button-remove-tag-1'));
      await userEvent.click(screen.getByTestId('dialog-remove-candidate-tag-confirm'));

      await waitFor(() => expect(screen.queryByTestId('dialog-remove-candidate-tag')).not.toBeInTheDocument());
      expect(state.removeTagAsync).toHaveBeenCalledTimes(1);
      expect(state.removeTagAsync).toHaveBeenCalledWith({ organizationId: 10, id: 200, tagId: 1 }, expect.anything());
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['candidateTags', 10, 200] });
      invalidateSpy.mockRestore();
    });

    it('keeps the dialog open and the tag rendered when removal fails', async () => {
      setup();
      state.removeTagAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
        const err = { error: 'boom' };
        opts?.onError?.(err);
        return Promise.reject(err);
      });
      renderPage();
      await userEvent.click(screen.getByTestId('button-remove-tag-1'));
      await userEvent.click(screen.getByTestId('dialog-remove-candidate-tag-confirm'));

      await waitFor(() => expect(state.removeTagAsync).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('dialog-remove-candidate-tag')).toBeInTheDocument();
      expect(screen.getByTestId('badge-tag-1')).toBeInTheDocument();
    });
  });
});
