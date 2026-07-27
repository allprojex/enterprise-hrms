/**
 * Tests the public accept-invitation page (W10). Mocks
 * @workspace/api-client-react so no real network calls are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import InviteAccept from '@/pages/invite-accept';

const { getInvitationResult, acceptMutate, acceptMutationState } = vi.hoisted(() => ({
  getInvitationResult: { data: undefined as unknown, isLoading: false, error: null as unknown },
  acceptMutate: vi.fn(),
  acceptMutationState: { isPending: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetInvitation: () => getInvitationResult,
  getGetInvitationQueryKey: (token: string) => ['invitation', token],
  useAcceptInvitation: () => ({ mutate: acceptMutate, isPending: acceptMutationState.isPending }),
}));

function renderPage(token = 'sometoken') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, history } = memoryLocation({ path: `/invite/${token}`, record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/invite/:token">{() => <InviteAccept />}</Route>
      </Router>
    </QueryClientProvider>,
  );
  return history!;
}

describe('InviteAccept', () => {
  it('shows an invalid-link message when the token does not resolve to an invitation', async () => {
    getInvitationResult.data = undefined;
    getInvitationResult.isLoading = false;
    getInvitationResult.error = { status: 404 };

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Invalid invitation link')).toBeInTheDocument();
    });
  });

  it('shows an expired message for an expired invitation', async () => {
    getInvitationResult.data = { organizationName: 'Acme Co', email: 'invitee@example.com', status: 'expired' };
    getInvitationResult.isLoading = false;
    getInvitationResult.error = null;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('This invitation has expired')).toBeInTheDocument();
    });
  });

  it('shows an already-used message for an accepted invitation', async () => {
    getInvitationResult.data = { organizationName: 'Acme Co', email: 'invitee@example.com', status: 'accepted' };
    getInvitationResult.isLoading = false;
    getInvitationResult.error = null;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('This invitation was already used')).toBeInTheDocument();
    });
  });

  it('renders the accept form for a pending invitation and submits it', async () => {
    getInvitationResult.data = { organizationName: 'Acme Co', email: 'invitee@example.com', status: 'pending' };
    getInvitationResult.isLoading = false;
    getInvitationResult.error = null;
    acceptMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());

    const user = userEvent.setup();
    renderPage('good-token');

    await waitFor(() => {
      expect(screen.getByTestId('form-accept-invitation')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('input-first-name'), 'Jane');
    await user.type(screen.getByTestId('input-last-name'), 'Doe');
    await user.type(screen.getByTestId('input-password'), 'correct-horse-battery');
    await user.click(screen.getByTestId('button-submit'));

    expect(acceptMutate).toHaveBeenCalledWith(
      { token: 'good-token', data: { firstName: 'Jane', lastName: 'Doe', password: 'correct-horse-battery' } },
      expect.anything(),
    );
    await waitFor(() => {
      expect(screen.getByText('Account created')).toBeInTheDocument();
    });
  });
});
