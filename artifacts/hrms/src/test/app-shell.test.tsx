/**
 * Tests for the AppShell organisation switcher: verifies it's rendered as a
 * real, enabled control (not the old permanently-disabled placeholder),
 * lists every organisation the caller has an active membership in via
 * useListMyOrganizations, and that selecting a different one calls the
 * switch mutation and invalidates the getMe/myOrganizations caches so every
 * org-scoped query (keyed by organizationId) refetches under the new org.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppShell } from '@/components/layout/app-shell';

const switchMutateMock = vi.fn();
const invalidateQueriesMock = vi.fn();

const MULTI_ORG_MEMBERSHIPS = [
  {
    organizationId: 10,
    organizationName: 'Acme HQ',
    organizationSlug: 'acme',
    status: 'active',
    roles: ['org_admin'],
    isPrimaryHr: false,
  },
  {
    organizationId: 20,
    organizationName: 'Acme Satellite',
    organizationSlug: 'acme-2',
    status: 'active',
    roles: ['employee'],
    isPrimaryHr: false,
  },
];

// organizationId matches useGetMe's fixed activeOrganizationId (10) below,
// so this stands in for "the caller's one and only membership."
const SINGLE_ORG_MEMBERSHIPS = [
  {
    organizationId: 10,
    organizationName: 'wwm',
    organizationSlug: 'wwm',
    status: 'active',
    roles: ['org_admin'],
    isPrimaryHr: false,
  },
];

const { useListMyOrganizationsMock } = vi.hoisted(() => ({ useListMyOrganizationsMock: vi.fn() }));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock, clear: vi.fn() }),
  };
});

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({
    data: {
      id: 1,
      firstName: 'Ama',
      lastName: 'Owusu',
      role: 'org_admin',
      organizationId: 10,
      activeOrganizationId: 10,
    },
    isLoading: false,
    error: null,
  }),
  getGetMeQueryKey: () => ['getMe'],
  useListNotifications: () => ({ data: [] }),
  getListNotificationsQueryKey: () => ['notifications'],
  useListMyOrganizations: () => useListMyOrganizationsMock(),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useSwitchOrganization: () => ({ mutate: switchMutateMock, isPending: false }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/dashboard', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </Router>
    </QueryClientProvider>,
  );
}

describe('AppShell organisation switcher', () => {
  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    useListMyOrganizationsMock.mockReturnValue({ data: MULTI_ORG_MEMBERSHIPS });
  });

  it('shows the active organisation and is not disabled', () => {
    renderShell();
    const trigger = screen.getByTestId('button-org-selector');
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveTextContent('Acme HQ');
  });

  it('lists every organisation the caller belongs to when opened', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId('button-org-selector'));

    await waitFor(() => {
      expect(screen.getByTestId('option-org-10')).toBeInTheDocument();
      expect(screen.getByTestId('option-org-20')).toBeInTheDocument();
    });
  });

  it('switches organisation and invalidates org-scoped caches on success', async () => {
    switchMutateMock.mockImplementation((_vars, opts) => {
      opts.onSuccess();
    });

    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId('button-org-selector'));

    const targetOption = await screen.findByTestId('option-org-20');
    await user.click(targetOption);

    await waitFor(() => {
      expect(switchMutateMock).toHaveBeenCalledWith(
        { data: { organizationId: 20 } },
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
      );
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['getMe'] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['myOrganizations'] });
  });

  it('does not re-switch when selecting the already-active organisation', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId('button-org-selector'));

    const currentOption = await screen.findByTestId('option-org-10');
    await user.click(currentOption);

    await waitFor(() => {
      expect(screen.queryByTestId('option-org-10')).not.toBeInTheDocument();
    });
    expect(switchMutateMock).not.toHaveBeenCalled();
  });
});

// Multi-Organization Tenant Infrastructure: a caller with only one
// legitimate membership must never see a switcher — there is nothing real
// to switch to, and the brief explicitly requires it hidden.
describe('AppShell organisation display — single-organisation caller', () => {
  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    useListMyOrganizationsMock.mockReturnValue({ data: SINGLE_ORG_MEMBERSHIPS });
  });

  it('shows a plain organisation label, not a switcher control', () => {
    renderShell();
    expect(screen.getByTestId('text-org-current')).toHaveTextContent('wwm');
    expect(screen.queryByTestId('button-org-selector')).not.toBeInTheDocument();
  });

  it('exposes no unrelated tenant inventory (no switcher menu to open)', () => {
    renderShell();
    expect(screen.queryByText('Switch organisation')).not.toBeInTheDocument();
  });
});
