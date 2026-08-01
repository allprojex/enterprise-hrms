/**
 * Tests for the Offer detail page (Phase 3A, W57 — Offers).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import OfferDetail from '@/pages/offer-detail';
import type { OfferDetail as OfferDetailType, OfferVersion } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    offer: undefined as OfferDetailType | undefined,
    isLoading: false,
    error: undefined as unknown,
    approvals: [] as unknown[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetOffer: () => ({ data: state.offer, isLoading: state.isLoading, error: state.error, refetch: vi.fn() }),
  getGetOfferQueryKey: (orgId: number, id: number) => ['offer', orgId, id],
  useUpdateDraftOfferVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateNewOfferVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSubmitOfferVersionForApproval: () => ({ mutate: vi.fn(), isPending: false }),
  useListOfferApprovals: () => ({ data: state.approvals }),
  getListOfferApprovalsQueryKey: (orgId: number, id: number) => ['offer-approvals', orgId, id],
  useApproveOfferVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useIssueOfferVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawOfferVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

function baseVersion(overrides: Partial<OfferVersion> = {}): OfferVersion {
  return {
    id: 1,
    organizationId: 10,
    offerId: 1,
    versionNumber: 1,
    proposedStartDate: null,
    employmentType: 'full_time',
    workplaceType: 'onsite',
    location: 'Accra',
    compensationSummary: null,
    conditions: null,
    expiryDate: null,
    letterTemplateId: null,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function baseOffer(versionOverrides: Partial<OfferVersion> = {}): OfferDetailType {
  return {
    offer: { id: 1, organizationId: 10, applicationId: 500, currentVersionId: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    versions: [baseVersion(versionOverrides)],
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/offers/1', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/offers/:id">{() => <OfferDetail />}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

describe('Offer detail page', () => {
  it('shows a loading state without crashing', () => {
    state.offer = undefined;
    state.isLoading = true;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('badge-offer-status')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.offer = undefined;
    state.isLoading = false;
    state.error = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load this offer/i)).toBeInTheDocument();
  });

  it('renders offer details and links to the application', () => {
    state.offer = baseOffer();
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('link-offer-application')).toHaveAttribute('href', '/applications/500');
    expect(screen.getByTestId('badge-offer-status')).toHaveTextContent('draft');
    expect(screen.getByText('Accra')).toBeInTheDocument();
  });

  it('shows edit and submit actions for a draft version', () => {
    state.offer = baseOffer({ status: 'draft' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-edit-offer')).toHaveTextContent('Edit');
    expect(screen.getByTestId('button-submit-offer')).toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-issue-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-withdraw-offer')).not.toBeInTheDocument();
  });

  it('shows approve and withdraw actions for a pending_approval version', () => {
    state.offer = baseOffer({ status: 'pending_approval' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-approve-offer')).toBeInTheDocument();
    expect(screen.getByTestId('button-withdraw-offer')).toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-submit-offer')).not.toBeInTheDocument();
  });

  it('shows create-new-version, issue, and withdraw actions for an approved version', () => {
    state.offer = baseOffer({ status: 'approved' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-edit-offer')).toHaveTextContent('Create New Version');
    expect(screen.getByTestId('button-issue-offer')).toBeInTheDocument();
    expect(screen.getByTestId('button-withdraw-offer')).toBeInTheDocument();
  });

  it('shows only withdraw for an issued version', () => {
    state.offer = baseOffer({ status: 'issued' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('button-edit-offer')).toHaveTextContent('Create New Version');
    expect(screen.getByTestId('button-withdraw-offer')).toBeInTheDocument();
    expect(screen.queryByTestId('button-issue-offer')).not.toBeInTheDocument();
  });

  it('shows no actions for a terminal (withdrawn) version', () => {
    state.offer = baseOffer({ status: 'withdrawn' });
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.queryByTestId('button-edit-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-submit-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-issue-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-withdraw-offer')).not.toBeInTheDocument();
  });

  it('renders version history for every version, including superseded ones', () => {
    state.offer = {
      offer: { id: 1, organizationId: 10, applicationId: 500, currentVersionId: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      versions: [baseVersion({ id: 1, versionNumber: 1, status: 'superseded' }), baseVersion({ id: 2, versionNumber: 2, status: 'approved' })],
    };
    state.isLoading = false;
    state.error = undefined;
    renderPage();
    expect(screen.getByTestId('row-offer-version-1')).toHaveTextContent('superseded');
    expect(screen.getByTestId('row-offer-version-2')).toHaveTextContent('approved');
  });

  it('renders approval history when present', () => {
    state.offer = baseOffer({ status: 'approved' });
    state.approvals = [{ id: 1, organizationId: 10, offerVersionId: 1, sequence: 1, approverMembershipId: 5, decision: 'approved', decidedAt: new Date().toISOString(), comment: 'Looks good', createdAt: new Date().toISOString() }];
    renderPage();
    expect(screen.getByTestId('row-offer-approval-1')).toHaveTextContent('approved');
    expect(screen.getByTestId('row-offer-approval-1')).toHaveTextContent('Looks good');
  });
});
