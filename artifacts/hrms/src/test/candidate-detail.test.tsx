/**
 * Tests for the Candidate detail page (Phase 3A, W53 — Candidate Notes,
 * Tags, and Talent Pools). @workspace/api-client-react is mocked at the
 * hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import CandidateDetail from '@/pages/candidate-detail';
import type { Candidate, CandidateNote, CandidateTag } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    candidate: undefined as Candidate | undefined,
    isLoading: false,
    error: undefined as unknown,
    notes: [] as CandidateNote[],
    tags: [] as CandidateTag[],
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
  useRemoveCandidateTag: () => ({ mutate: vi.fn(), isPending: false }),
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
});
