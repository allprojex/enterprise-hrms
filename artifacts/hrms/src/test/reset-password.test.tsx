/**
 * Tests the public reset-password page (W19). Mocks
 * @workspace/api-client-react so no real network calls are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import ResetPassword from '@/pages/reset-password';

const { getStatusResult, resetMutate, resetMutationState } = vi.hoisted(() => ({
  getStatusResult: { data: undefined as unknown, isLoading: false, error: null as unknown },
  resetMutate: vi.fn(),
  resetMutationState: { isPending: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPasswordResetStatus: () => getStatusResult,
  getGetPasswordResetStatusQueryKey: (token: string) => ['passwordResetStatus', token],
  useResetPassword: () => ({ mutate: resetMutate, isPending: resetMutationState.isPending }),
}));

function renderPage(token = 'sometoken') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, history } = memoryLocation({ path: `/reset-password/${token}`, record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path="/reset-password/:token">{() => <ResetPassword />}</Route>
      </Router>
    </QueryClientProvider>,
  );
  return history!;
}

describe('ResetPassword', () => {
  it('shows an invalid-link message for an invalid token', async () => {
    getStatusResult.data = { status: 'invalid' };
    getStatusResult.isLoading = false;
    getStatusResult.error = null;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Invalid reset link')).toBeInTheDocument();
    });
  });

  it('shows an expired message for an expired token', async () => {
    getStatusResult.data = { status: 'expired' };
    getStatusResult.isLoading = false;
    getStatusResult.error = null;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('This reset link has expired')).toBeInTheDocument();
    });
  });

  it('renders the reset form for a valid token and submits it', async () => {
    getStatusResult.data = { status: 'valid' };
    getStatusResult.isLoading = false;
    getStatusResult.error = null;
    resetMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());

    const user = userEvent.setup();
    renderPage('good-token');

    await waitFor(() => {
      expect(screen.getByTestId('form-reset-password')).toBeInTheDocument();
    });

    await user.type(screen.getByTestId('input-password'), 'correct-horse-battery');
    await user.click(screen.getByTestId('button-submit'));

    expect(resetMutate).toHaveBeenCalledWith(
      { token: 'good-token', data: { password: 'correct-horse-battery' } },
      expect.anything(),
    );
    await waitFor(() => {
      expect(screen.getByText('Password reset')).toBeInTheDocument();
    });
  });
});
