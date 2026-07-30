/**
 * Tests for the Talent Pools list page (Phase 3A, W53 — Candidate Notes,
 * Tags, and Talent Pools). @workspace/api-client-react is mocked at the
 * hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import TalentPools from '@/pages/talent-pools';
import type { TalentPool, TalentPoolMember, Candidate } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    pools: undefined as TalentPool[] | undefined,
    isLoading: false,
    error: undefined as unknown,
    members: [] as TalentPoolMember[],
    candidatesById: {} as Record<number, Candidate>,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListTalentPools: () => ({ data: state.pools, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getListTalentPoolsQueryKey: (orgId: number) => ['talentPools', orgId],
  useCreateTalentPool: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveTalentPool: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateTalentPool: () => ({ mutate: vi.fn(), isPending: false }),
  useListTalentPoolMembers: () => ({ data: state.members, isLoading: false }),
  getListTalentPoolMembersQueryKey: (orgId: number, poolId: number) => ['talentPoolMembers', orgId, poolId],
  useAddTalentPoolMember: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTalentPoolMember: () => ({ mutate: vi.fn(), isPending: false }),
  useListCandidates: () => ({ data: { items: [], total: 0, page: 1, pageSize: 10 } }),
  getListCandidatesQueryKey: (orgId: number, params: unknown) => ['candidates', orgId, params],
  useGetCandidate: (orgId: number, candidateId: number) => ({ data: state.candidatesById[candidateId] }),
  getGetCandidateQueryKey: (orgId: number, id: number) => ['candidate', orgId, id],
}));

function basePool(overrides: Partial<TalentPool> = {}): TalentPool {
  return {
    id: 1,
    organizationId: 10,
    name: 'Frontend Engineers',
    description: 'React specialists',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/talent-pools', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <TalentPools />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Talent Pools list page', () => {
  it('shows a loading state without crashing', () => {
    state.pools = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('row-talent-pool-1')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.pools = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load talent pools/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no pools', () => {
    state.pools = [];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByText(/no talent pools yet/i)).toBeInTheDocument();
  });

  it('renders pools with name, description, and active status', () => {
    state.pools = [basePool()];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-talent-pool-1');
    expect(row).toHaveTextContent('Frontend Engineers');
    expect(row).toHaveTextContent('React specialists');
    expect(row).toHaveTextContent('Active');
  });

  it('shows an archived badge and a reactivate control for an inactive pool', () => {
    state.pools = [basePool({ isActive: false })];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    const row = screen.getByTestId('row-talent-pool-1');
    expect(row).toHaveTextContent('Archived');
    expect(screen.getByTestId('button-reactivate-pool-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-archive-pool-1')).not.toBeInTheDocument();
  });

  it('renders the new-pool dialog trigger', () => {
    state.pools = [];
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-new-talent-pool')).toBeInTheDocument();
  });

  it('opens the members dialog and shows current members', () => {
    state.pools = [basePool()];
    state.isLoading = false;
    state.error = undefined;
    state.members = [{ id: 1, organizationId: 10, talentPoolId: 1, candidateId: 200, addedByMembershipId: 5, createdAt: new Date().toISOString() }];
    state.candidatesById = { 200: { id: 200, organizationId: 10, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: null, source: 'careers_portal', isActive: true, createdAt: '', updatedAt: '' } };

    renderPage();
    fireEvent.click(screen.getByTestId('button-manage-members-1'));
    expect(screen.getByTestId('row-pool-member-1')).toHaveTextContent('Jane Doe');
  });

  it('shows an empty state in the members dialog when the pool has no members', () => {
    state.pools = [basePool()];
    state.isLoading = false;
    state.error = undefined;
    state.members = [];
    state.candidatesById = {};

    renderPage();
    fireEvent.click(screen.getByTestId('button-manage-members-1'));
    expect(screen.getByText(/no candidates in this pool yet/i)).toBeInTheDocument();
  });
});
