/**
 * Show/hide password on every authenticated-credential surface.
 *
 * The repository has three screens where a user types a password — sign-in,
 * password reset, and invitation acceptance — and one shared, already-accessible
 * control (components/foundation/PasswordInput). These tests pin that each
 * screen uses that control and that the behaviour is identical everywhere:
 * hidden by default, revealed on activation, masked again on a second
 * activation, with the typed value never altered.
 *
 * There is no separate platform/super-admin sign-in and no change-password or
 * account-setup screen in this codebase; /forgot-password collects an email
 * address only. If any of those are added later, they should reuse the same
 * control and extend this file.
 *
 * @workspace/api-client-react is mocked throughout — no network calls are made
 * and no password value leaves the component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Login from '@/pages/login';
import ResetPassword from '@/pages/reset-password';
import InviteAccept from '@/pages/invite-accept';

const { loginMutate, resetMutate, acceptMutate, getStatusResult, getInvitationResult } = vi.hoisted(() => ({
  loginMutate: vi.fn(),
  resetMutate: vi.fn(),
  acceptMutate: vi.fn(),
  getStatusResult: { data: { status: 'valid' } as unknown, isLoading: false, error: null as unknown },
  getInvitationResult: {
    data: { email: 'new.person@example.test', organizationName: 'Example Org', firstName: '', lastName: '' } as unknown,
    isLoading: false,
    error: null as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useLogin: () => ({ mutate: loginMutate, isPending: false }),
  useGetTenantContext: () => ({ data: undefined }),
  getGetTenantContextQueryKey: () => ['tenantContext'],
  useGetPasswordResetStatus: () => getStatusResult,
  getGetPasswordResetStatusQueryKey: (token: string) => ['passwordResetStatus', token],
  useResetPassword: () => ({ mutate: resetMutate, isPending: false }),
  useGetInvitation: () => getInvitationResult,
  getGetInvitationQueryKey: (token: string) => ['invitation', token],
  useAcceptInvitation: () => ({ mutate: acceptMutate, isPending: false }),
}));

function renderAt(path: string, pattern: string, node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Route path={pattern}>{() => node}</Route>
      </Router>
    </QueryClientProvider>,
  );
}

const SURFACES = [
  {
    name: 'sign-in',
    autoComplete: 'current-password',
    render: () => renderAt('/login', '/login', <Login />),
  },
  {
    name: 'password reset',
    autoComplete: 'new-password',
    render: () => renderAt('/reset-password/tok', '/reset-password/:token', <ResetPassword />),
  },
  {
    name: 'invitation acceptance',
    autoComplete: 'new-password',
    render: () => renderAt('/invite/tok', '/invite/:token', <InviteAccept />),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(SURFACES)('password visibility — $name', (surface) => {
  it('is hidden by default', () => {
    surface.render();
    expect(screen.getByTestId('input-password')).toHaveAttribute('type', 'password');
  });

  it('reveals the value when the control is activated, and masks it again', async () => {
    const user = userEvent.setup();
    surface.render();
    const field = screen.getByTestId('input-password');
    const toggle = screen.getByTestId('password-visibility-toggle');

    expect(field).toHaveAttribute('type', 'password');
    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'text');
    await user.click(toggle);
    expect(field).toHaveAttribute('type', 'password');
  });

  it('never alters the typed value while toggling', async () => {
    const user = userEvent.setup();
    surface.render();
    const field = screen.getByTestId('input-password') as HTMLInputElement;
    const toggle = screen.getByTestId('password-visibility-toggle');

    await user.type(field, 'Correct horse battery staple 1!');
    expect(field.value).toBe('Correct horse battery staple 1!');

    await user.click(toggle);
    expect(field.value).toBe('Correct horse battery staple 1!');
    await user.click(toggle);
    expect(field.value).toBe('Correct horse battery staple 1!');
  });

  it('exposes an accessible, keyboard-operable control', async () => {
    const user = userEvent.setup();
    surface.render();
    const field = screen.getByTestId('input-password');
    const toggle = screen.getByTestId('password-visibility-toggle');

    // A real button, labelled for its action, with pressed state announced.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName('Show password');

    // Reachable and operable from the keyboard alone.
    await user.tab();
    let guard = 0;
    while (document.activeElement !== toggle && guard < 12) {
      await user.tab();
      guard += 1;
    }
    expect(document.activeElement).toBe(toggle);

    await user.keyboard('{Enter}');
    expect(field).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Hide password');

    await user.keyboard(' ');
    expect(field).toHaveAttribute('type', 'password');
  });

  it('preserves password-manager autocomplete semantics', () => {
    surface.render();
    expect(screen.getByTestId('input-password')).toHaveAttribute('autocomplete', surface.autoComplete);
  });

  it('keeps the field required so existing validation is unchanged', () => {
    surface.render();
    expect(screen.getByTestId('input-password')).toBeRequired();
  });
});

describe('submission is unaffected by the visibility control', () => {
  it('sign-in still submits the typed credentials', async () => {
    const user = userEvent.setup();
    renderAt('/login', '/login', <Login />);

    await user.type(screen.getByTestId('input-email'), 'person@example.test');
    await user.type(screen.getByTestId('input-password'), 'hunter2hunter2');
    // Reveal first — submission must behave identically either way.
    await user.click(screen.getByTestId('password-visibility-toggle'));
    await user.click(screen.getByTestId('button-submit'));

    expect(loginMutate).toHaveBeenCalledTimes(1);
    const payload = JSON.stringify(loginMutate.mock.calls[0]?.[0] ?? {});
    expect(payload).toContain('hunter2hunter2');
  });

  it('password reset still submits the new password', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password/tok', '/reset-password/:token', <ResetPassword />);

    await user.type(screen.getByTestId('input-password'), 'brand-new-secret-9');
    await user.click(screen.getByTestId('password-visibility-toggle'));
    await user.click(screen.getByTestId('button-submit'));

    expect(resetMutate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(resetMutate.mock.calls[0]?.[0] ?? {})).toContain('brand-new-secret-9');
  });
});
