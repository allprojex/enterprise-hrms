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

const { useListMyOrganizationsMock, logoutMutateMock, useGetMeMock, clearTokenMock, modulesMock } = vi.hoisted(() => ({
  useListMyOrganizationsMock: vi.fn(),
  logoutMutateMock: vi.fn(),
  useGetMeMock: vi.fn(),
  clearTokenMock: vi.fn(),
  modulesMock: vi.fn(),
}));

const DEFAULT_ME = {
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
};

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock, clear: vi.fn() }),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, clearToken: clearTokenMock };
});

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => useGetMeMock(),
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
  useListOrganizationModules: () => modulesMock(),
  getListOrganizationModulesQueryKey: (id: number) => ['orgModules', id],
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

beforeEach(() => {
  useGetMeMock.mockReturnValue(DEFAULT_ME);
  clearTokenMock.mockReset();
  modulesMock.mockReturnValue({ data: [] });
});

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
    modulesMock.mockReturnValue(modulesEnabled('attendance')); // Attendance is module-gated
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

// WS-2 (Identity & Access Hardening): a session that stops being valid mid-
// use — most notably a platform-level disablement (Owner Decision #20),
// but identically for any other reason requireAuth now or in the future
// returns 401 for /auth/me — must clear the stale local token and redirect
// to login, never leave the shell rendering as if the caller were still
// authenticated.
describe('AppShell session invalidation (e.g. platform-disabled account)', () => {
  beforeEach(() => {
    useListMyOrganizationsMock.mockReturnValue({ data: SINGLE_ORG_MEMBERSHIPS });
  });

  it('clears the local token and redirects to /login when GET /auth/me returns 401', async () => {
    useGetMeMock.mockReturnValue({ data: undefined, isLoading: false, error: { status: 401 } });
    const { hook, history } = memoryLocation({ path: '/dashboard', record: true });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Router hook={hook}>
          <AppShell>
            <div>page content</div>
          </AppShell>
        </Router>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(clearTokenMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/login');
    });
  });

  it('does not clear the token or redirect for a healthy session', () => {
    renderShell();
    expect(clearTokenMock).not.toHaveBeenCalled();
  });

  it('does not clear the token for a non-401 error (e.g. a transient network failure)', () => {
    useGetMeMock.mockReturnValue({ data: undefined, isLoading: false, error: { status: 500 } });
    renderShell();
    expect(clearTokenMock).not.toHaveBeenCalled();
  });
});

function modulesEnabled(...keys: string[]) {
  return { data: keys.map((key) => ({ key, enabled: true, requiredModuleKeys: [] as string[] })) };
}

/** org 10, HR-capable (org_admin), the default active organisation. */
function hrCapableOrg() {
  useListMyOrganizationsMock.mockReturnValue({ data: MULTI_ORG_MEMBERSHIPS });
  useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, activeOrganizationId: 10 } });
}

describe('AppShell — sidebar/route authorization consistency (module-gated navigation)', () => {
  it('hides module-gated groups when the module is not enabled for the active organisation', () => {
    hrCapableOrg();
    modulesMock.mockReturnValue({ data: [] }); // no modules enabled (e.g. System Administration)
    renderShell();
    // Module-gated groups are absent...
    expect(screen.queryByTestId('button-nav-group-attendance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-nav-group-leave-management')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-nav-group-performance')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-nav-group-recruitment')).not.toBeInTheDocument();
    // ...while permission-only Personnel and Administration remain available.
    expect(screen.getByTestId('button-nav-group-personnel')).toBeInTheDocument();
    expect(screen.getByTestId('button-nav-group-administration')).toBeInTheDocument();
  });

  it('shows a module-gated group when the module is enabled and the caller is authorized', () => {
    hrCapableOrg();
    modulesMock.mockReturnValue(modulesEnabled('attendance', 'leave'));
    renderShell();
    expect(screen.getByTestId('button-nav-group-attendance')).toBeInTheDocument();
    expect(screen.getByTestId('button-nav-group-leave-management')).toBeInTheDocument();
    // A module NOT enabled stays hidden even alongside enabled ones.
    expect(screen.queryByTestId('button-nav-group-performance')).not.toBeInTheDocument();
  });

  it('hides a module-gated group when the module is enabled but the caller lacks the role', () => {
    // Active org 20 where this caller is only an employee (not HR-capable).
    useListMyOrganizationsMock.mockReturnValue({ data: MULTI_ORG_MEMBERSHIPS });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, role: 'employee', activeOrganizationId: 20 } });
    modulesMock.mockReturnValue(modulesEnabled('attendance'));
    renderShell();
    // Enabled module, but the HR-only Attendance group needs a role the
    // employee does not have -> still hidden (no bypass either direction).
    expect(screen.queryByTestId('button-nav-group-attendance')).not.toBeInTheDocument();
  });

  it('keeps the WS-26 Forms navigation (not module-gated) intact', async () => {
    hrCapableOrg();
    modulesMock.mockReturnValue({ data: [] });
    const user = userEvent.setup();
    renderShell();
    // Forms lives in the permission-only Personnel group; expand it and assert.
    await user.click(screen.getByTestId('button-nav-group-personnel'));
    expect(await screen.findByRole('link', { name: /^Forms$/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Form Templates/ })).toBeInTheDocument();
  });
});

describe('AppShell — organization-context indicator', () => {
  it('names the active organisation prominently in the top bar', () => {
    hrCapableOrg();
    renderShell();
    expect(screen.getByTestId('active-org-indicator')).toHaveTextContent('Acme HQ');
  });

  it('shows "System Administration" when operating in organisation 1', () => {
    useListMyOrganizationsMock.mockReturnValue({
      data: [{ organizationId: 1, organizationName: 'System Administration', organizationSlug: 'system-administration', status: 'active', roles: ['super_admin'], isPrimaryHr: false }],
    });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, role: 'super_admin', organizationId: 1, activeOrganizationId: 1 } });
    renderShell();
    const indicator = screen.getByTestId('active-org-indicator');
    expect(indicator).toHaveTextContent('System Administration');
    expect(indicator).toHaveAttribute('aria-label', 'Operating in System Administration');
  });

  it('shows the WWM identity when operating in Worldwide Word Ministries', () => {
    useListMyOrganizationsMock.mockReturnValue({
      data: [{ organizationId: 3, organizationName: 'Worldwide Word Ministries', organizationSlug: 'wwm', status: 'active', roles: ['org_admin'], isPrimaryHr: false }],
    });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, organizationId: 3, activeOrganizationId: 3 } });
    renderShell();
    expect(screen.getByTestId('active-org-indicator')).toHaveTextContent('Worldwide Word Ministries');
  });

  it('reflects a different active organisation (org switch)', () => {
    useListMyOrganizationsMock.mockReturnValue({ data: MULTI_ORG_MEMBERSHIPS });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, activeOrganizationId: 20 } });
    renderShell();
    expect(screen.getByTestId('active-org-indicator')).toHaveTextContent('Acme Satellite');
  });
});
