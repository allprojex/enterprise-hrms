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

const { useListMyOrganizationsMock, logoutMutateMock } = vi.hoisted(() => ({
  useListMyOrganizationsMock: vi.fn(),
  logoutMutateMock: vi.fn(),
}));

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
  getGetDashboardSummaryQueryKey: () => ['dashboardSummary'],
  useSwitchOrganization: () => ({ mutate: switchMutateMock, isPending: false }),
  useLogout: () => ({ mutate: logoutMutateMock, isPending: false }),
  useGetMyEmployee: () => ({ data: { linked: false, employee: null } }),
  getGetMyEmployeeQueryKey: () => ['getMyEmployee'],
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
    // Regression check: GET /dashboard/summary takes no parameters, so its
    // query key never changes across an org switch and needs its own
    // explicit invalidation — without this, a caller who switches
    // organizations kept seeing the previous organization's dashboard
    // figures (discovered live during WWM Presentation Readiness QA).
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['dashboardSummary'] });
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

// WWM Presentation Readiness: organization logo/system-name rendering in
// the consolidated sidebar brand header.
describe('AppShell brand header', () => {
  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
  });

  it('renders the organization logo image when logoUrl is set', () => {
    useListMyOrganizationsMock.mockReturnValue({
      data: [{ ...SINGLE_ORG_MEMBERSHIPS[0], logoUrl: 'https://example.com/wwm-logo.png' }],
    });
    renderShell();
    expect(screen.getByTestId('img-org-logo')).toHaveAttribute('src', 'https://example.com/wwm-logo.png');
  });

  it('falls back to a generic icon (never a broken image) when logoUrl is null', () => {
    useListMyOrganizationsMock.mockReturnValue({ data: [{ ...SINGLE_ORG_MEMBERSHIPS[0], logoUrl: null }] });
    renderShell();
    expect(screen.queryByTestId('img-org-logo')).not.toBeInTheDocument();
  });

  it("shows the organization's own system display name when configured", () => {
    useListMyOrganizationsMock.mockReturnValue({
      data: [{ ...SINGLE_ORG_MEMBERSHIPS[0], systemDisplayName: 'Human Resource Management System' }],
    });
    renderShell();
    expect(screen.getByTestId('text-org-current')).toHaveTextContent('Human Resource Management System');
  });

  it('shows no system display name line when the organization has not configured one', () => {
    useListMyOrganizationsMock.mockReturnValue({ data: [{ ...SINGLE_ORG_MEMBERSHIPS[0], systemDisplayName: null }] });
    renderShell();
    expect(screen.getByTestId('text-org-current')).not.toHaveTextContent('Human Resource Management System');
  });
});

// WWM Presentation Readiness: the ~50-item flat nav list was regrouped into
// labelled, collapsible sections — every underlying href/permission
// condition is unchanged, only the grouping/rendering.
describe('AppShell grouped navigation', () => {
  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    useListMyOrganizationsMock.mockReturnValue({ data: SINGLE_ORG_MEMBERSHIPS });
  });

  it('renders labelled, collapsible group headers', () => {
    renderShell();
    expect(screen.getByTestId('button-nav-group-overview')).toBeInTheDocument();
    expect(screen.getByTestId('button-nav-group-personnel')).toBeInTheDocument();
    expect(screen.getByTestId('button-nav-group-attendance')).toBeInTheDocument();
  });

  it('starts with the group containing the current route expanded', () => {
    renderShell();
    expect(screen.getByTestId('button-nav-group-overview')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('link-nav-dashboard')).toBeInTheDocument();
  });

  it('starts other groups collapsed, and expands one on click without collapsing others', async () => {
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByTestId('button-nav-group-personnel')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('link-nav-employees')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('button-nav-group-personnel'));

    expect(screen.getByTestId('button-nav-group-personnel')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('link-nav-employees')).toBeInTheDocument();
    // The already-expanded Overview group stays expanded.
    expect(screen.getByTestId('button-nav-group-overview')).toHaveAttribute('aria-expanded', 'true');
  });

  it('never shows a Notifications sidebar entry — that surface lives only in the header bell', () => {
    renderShell();
    expect(screen.queryByTestId('link-nav-notifications')).not.toBeInTheDocument();
  });

  it('never renders a decorative, non-functional search input', () => {
    renderShell();
    expect(screen.queryByTestId('input-search')).not.toBeInTheDocument();
  });
});

// Bug report: users had no way to log out from the top of the app — only
// the sidebar's bottom section had a logout control. The header avatar is
// now a real account menu (not a plain profile link) with a Log out item.
describe('AppShell header account menu', () => {
  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    logoutMutateMock.mockReset();
    useListMyOrganizationsMock.mockReturnValue({ data: SINGLE_ORG_MEMBERSHIPS });
  });

  it('opens an account menu from the header with a working Log out item', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId('button-user-menu'));

    const logoutItem = await screen.findByTestId('button-header-logout');
    expect(logoutItem).toBeInTheDocument();
    expect(screen.getAllByTestId('link-profile').length).toBeGreaterThan(0);

    await user.click(logoutItem);
    expect(logoutMutateMock).toHaveBeenCalled();
  });
});
