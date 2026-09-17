/**
 * Tests for the AppShell organisation switcher: verifies it's rendered as a
 * real, enabled control (not the old permanently-disabled placeholder),
 * lists every organisation the caller has an active membership in via
 * useListMyOrganizations, and that selecting a different one calls the
 * switch mutation and invalidates the getMe/myOrganizations caches so every
 * org-scoped query (keyed by organizationId) refetches under the new org.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppShell } from '@/components/layout/app-shell';

const switchMutateMock = vi.fn();
const invalidateQueriesMock = vi.fn();

// Administration navigation permission gating (2026-09-07): effective
// permission keys per membership, mirroring the seeded role templates.
const EMPLOYEE_PERMISSIONS = [
  'organization.read', 'employee.read', 'branch.read', 'department.read', 'position.read',
  'leave_request.read.own', 'leave_request.write.own', 'attendance.clock.own', 'attendance.read.own',
];
// WWM "Employee — Inventory Self-Service" (Kofi Asante, EMP-0054): employee template + My Inventory keys.
const KOFI_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'office_inventory.request', 'office_inventory.approve', 'office_inventory.receipt.confirm.own',
  'office_inventory.custody.read', 'office_inventory.return', 'office_inventory.handover',
  'office_inventory.report_issue.own',
];
const HR_ADMINISTRATOR_PERMISSIONS = [
  'organization.read', 'membership.read', 'master_data.manage', 'hr_team.manage', 'audit.read.hr',
  'employee.read', 'employee.write',
];
const ORG_ADMIN_PERMISSIONS = [
  'organization.read', 'organization.update', 'membership.read', 'membership.manage', 'role.manage',
  'module.manage', 'master_data.manage', 'primary_hr.manage', 'audit.read', 'employee.read', 'employee.write',
];

const MULTI_ORG_MEMBERSHIPS = [
  {
    organizationId: 10,
    organizationName: 'Acme HQ',
    organizationSlug: 'acme',
    status: 'active',
    roles: ['org_admin'],
    permissions: ORG_ADMIN_PERMISSIONS,
    isPrimaryHr: false,
  },
  {
    organizationId: 20,
    organizationName: 'Acme Satellite',
    organizationSlug: 'acme-2',
    status: 'active',
    roles: ['employee'],
    permissions: EMPLOYEE_PERMISSIONS,
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
    permissions: ORG_ADMIN_PERMISSIONS,
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

function renderShell(path = '/dashboard') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, navigate } = memoryLocation({ path, record: true });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </Router>
    </QueryClientProvider>,
  );
  return { ...result, navigate };
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
      data: [{ organizationId: 1, organizationName: 'System Administration', organizationSlug: 'system-administration', status: 'active', roles: ['super_admin'], permissions: ORG_ADMIN_PERMISSIONS, isPrimaryHr: false }],
    });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, role: 'super_admin', organizationId: 1, activeOrganizationId: 1 } });
    renderShell();
    const indicator = screen.getByTestId('active-org-indicator');
    expect(indicator).toHaveTextContent('System Administration');
    expect(indicator).toHaveAttribute('aria-label', 'Operating in System Administration');
  });

  it('shows the WWM identity when operating in Worldwide Word Ministries', () => {
    useListMyOrganizationsMock.mockReturnValue({
      data: [{ organizationId: 3, organizationName: 'Worldwide Word Ministries', organizationSlug: 'wwm', status: 'active', roles: ['org_admin'], permissions: ORG_ADMIN_PERMISSIONS, isPrimaryHr: false }],
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

// Administration navigation permission gating (2026-09-07). Production
// defect: every member — including ordinary employees — saw an
// "Administration" group because its Organisations entry was unconditional.
// Rule now: a child renders only when the caller holds an effective
// permission its destination requires (and its module, where gated, is
// enabled for the active organization); the group renders only when at
// least one child survives. Never keyed on the employee role name.
describe('AppShell — Administration group permission gating', () => {
  function actAsWwmMember(input: {
    roles: string[];
    permissions?: string[];
    isPrimaryHr?: boolean;
    meRole?: string;
    memberships?: unknown[];
  }) {
    const membership = {
      organizationId: 3,
      organizationName: 'Worldwide Word Ministries',
      organizationSlug: 'wwm',
      status: 'active',
      roles: input.roles,
      ...(input.permissions ? { permissions: input.permissions } : {}),
      isPrimaryHr: input.isPrimaryHr ?? false,
    };
    useListMyOrganizationsMock.mockReturnValue({ data: input.memberships ?? [membership] });
    useGetMeMock.mockReturnValue({
      ...DEFAULT_ME,
      data: { ...DEFAULT_ME.data, id: 431, firstName: 'Kofi', lastName: 'Asante', role: input.meRole ?? 'employee', organizationId: 3, activeOrganizationId: 3 },
    });
  }

  async function administrationLinks(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId('button-nav-group-administration'));
    return screen.getAllByRole('link').filter((a) => (a.getAttribute('data-testid') ?? '').startsWith('link-nav-') && /organisations|organization administration|hr team management/.test(a.getAttribute('data-testid') ?? ''));
  }

  beforeEach(() => {
    switchMutateMock.mockReset();
    invalidateQueriesMock.mockReset();
    modulesMock.mockReturnValue(modulesEnabled('employee_self_service', 'office_inventory', 'attendance', 'leave'));
  });

  it('Kofi Asante (employee + wwm_employee_inventory_self_service) sees no Administration group and no administrative link', () => {
    actAsWwmMember({ roles: ['employee', 'wwm_employee_inventory_self_service'], permissions: KOFI_PERMISSIONS });
    renderShell();
    expect(screen.queryByTestId('button-nav-group-administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Organisations/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Organization Administration/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /HR Team Management/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/admin"]')).toBeNull();
    expect(document.querySelector('a[href="/organizations"]')).toBeNull();
  });

  it('keeps every legitimate employee self-service entry for Kofi (no regression)', async () => {
    actAsWwmMember({ roles: ['employee', 'wwm_employee_inventory_self_service'], permissions: KOFI_PERMISSIONS });
    const user = userEvent.setup();
    renderShell();
    expect(screen.getByTestId('button-nav-group-overview')).toBeInTheDocument();
    expect(screen.getByTestId('button-nav-group-self-service')).toBeInTheDocument();
    await user.click(screen.getByTestId('button-nav-group-self-service'));
    expect(screen.getByRole('link', { name: /Employee Self-Service/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /My Requests/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /My Forms/ })).toBeInTheDocument();
    // Inventory self-service keys never unlock the HR-only Office Inventory admin surface either.
    expect(screen.queryByTestId('button-nav-group-office-inventory')).not.toBeInTheDocument();
  });

  it('hides My Requests with the rest of Employee Self-Service when that module is disabled', async () => {
    modulesMock.mockReturnValue(modulesEnabled('office_inventory', 'attendance', 'leave'));
    actAsWwmMember({ roles: ['employee', 'wwm_employee_inventory_self_service'], permissions: KOFI_PERMISSIONS });
    const user = userEvent.setup();
    renderShell();
    const selfServiceGroup = screen.queryByTestId('button-nav-group-self-service');
    if (selfServiceGroup) await user.click(selfServiceGroup);
    expect(screen.queryByRole('link', { name: /My Requests/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Employee Self-Service/ })).not.toBeInTheDocument();
  });

  it('an ordinary employee (employee template only) sees no Administration group', () => {
    actAsWwmMember({ roles: ['employee'], permissions: EMPLOYEE_PERMISSIONS });
    renderShell();
    expect(screen.queryByTestId('button-nav-group-administration')).not.toBeInTheDocument();
  });

  it('an employee delegated one console authority (role.manage) through a custom role sees only Organization Administration', async () => {
    actAsWwmMember({ roles: ['employee', 'wwm_role_steward'], permissions: [...KOFI_PERMISSIONS, 'role.manage'] });
    const user = userEvent.setup();
    renderShell();
    const links = await administrationLinks(user);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Organization Administration']);
    expect(links[0]).toHaveAttribute('href', '/admin/3');
    expect(screen.queryByRole('link', { name: /Organisations/ })).not.toBeInTheDocument();
  });

  it('the Primary HR holding hr_team.manage sees HR Team Management only', async () => {
    actAsWwmMember({ roles: ['hr_administrator'], permissions: HR_ADMINISTRATOR_PERMISSIONS, isPrimaryHr: true });
    const user = userEvent.setup();
    renderShell();
    const links = await administrationLinks(user);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['HR Team Management']);
    expect(links[0]).toHaveAttribute('href', '/admin/3');
  });

  it('an hr_administrator who is not the Primary HR sees no Administration group', () => {
    actAsWwmMember({ roles: ['hr_administrator'], permissions: HR_ADMINISTRATOR_PERMISSIONS, isPrimaryHr: false });
    renderShell();
    expect(screen.queryByTestId('button-nav-group-administration')).not.toBeInTheDocument();
  });

  it('an org_admin sees Organisations and Organization Administration', async () => {
    actAsWwmMember({ roles: ['org_admin'], permissions: ORG_ADMIN_PERMISSIONS });
    const user = userEvent.setup();
    renderShell();
    const links = await administrationLinks(user);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Organisations', 'Organization Administration']);
    expect(screen.queryByRole('link', { name: /HR Team Management/ })).not.toBeInTheDocument();
  });

  it('module-gated administrative entries stay hidden when the module is disabled, even for an org_admin', async () => {
    actAsWwmMember({ roles: ['org_admin'], permissions: ORG_ADMIN_PERMISSIONS });
    modulesMock.mockReturnValue(modulesEnabled('leave')); // attendance NOT enabled
    renderShell();
    expect(screen.queryByTestId('button-nav-group-attendance')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Attendance Settings/ })).not.toBeInTheDocument();
  });

  it('module-gated administrative entries appear once the module is enabled for the active organization', async () => {
    actAsWwmMember({ roles: ['org_admin'], permissions: ORG_ADMIN_PERMISSIONS });
    modulesMock.mockReturnValue(modulesEnabled('attendance'));
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByTestId('button-nav-group-attendance'));
    expect(screen.getByRole('link', { name: /Attendance Settings/ })).toHaveAttribute('href', '/attendance-settings');
  });

  it('a role NAME alone (org_admin without console permissions) does not unlock Administration — permission-driven, fail closed', () => {
    actAsWwmMember({ roles: ['org_admin'], permissions: EMPLOYEE_PERMISSIONS });
    renderShell();
    expect(screen.queryByTestId('button-nav-group-administration')).not.toBeInTheDocument();
  });

  it('a membership summary without a permissions field fails closed', () => {
    actAsWwmMember({ roles: ['org_admin'] });
    renderShell();
    expect(screen.queryByTestId('button-nav-group-administration')).not.toBeInTheDocument();
  });

  it('the platform super_admin keeps the Organisations control-plane entry, with no new console bypass', async () => {
    // No membership in the organization being browsed -> Organisations only.
    actAsWwmMember({ roles: [], meRole: 'super_admin', memberships: [] });
    const user = userEvent.setup();
    renderShell();
    const links = await administrationLinks(user);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Organisations']);
  });

  it('the platform super_admin operating in its own System Administration membership keeps the full Administration group', async () => {
    actAsWwmMember({ roles: ['super_admin'], permissions: ORG_ADMIN_PERMISSIONS, meRole: 'super_admin' });
    const user = userEvent.setup();
    renderShell();
    const links = await administrationLinks(user);
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Organisations', 'Organization Administration']);
  });
});

describe('AppShell — sidebar group expand/collapse reliability', () => {
  const header = (slug: string) => screen.getByTestId(`button-nav-group-${slug}`);
  const chevron = (slug: string) => header(slug).querySelector('svg') as SVGElement;
  /** Header state, chevron rotation and rendered links must always agree. */
  const expectGroup = (slug: string, link: string, open: boolean) => {
    expect(header(slug)).toHaveAttribute('aria-expanded', String(open));
    if (open) {
      expect(chevron(slug).getAttribute('class')).not.toContain('-rotate-90');
      expect(screen.getByTestId(link)).toBeInTheDocument();
    } else {
      expect(chevron(slug).getAttribute('class')).toContain('-rotate-90');
      expect(screen.queryByTestId(link)).not.toBeInTheDocument();
    }
  };

  beforeEach(() => {
    useListMyOrganizationsMock.mockReturnValue({ data: MULTI_ORG_MEMBERSHIPS });
    useGetMeMock.mockReturnValue({ ...DEFAULT_ME, data: { ...DEFAULT_ME.data, activeOrganizationId: 10 } });
    modulesMock.mockReturnValue({
      data: ['leave', 'performance'].map((key) => ({ key, enabled: true, requiredModuleKeys: [] as string[] })),
    });
  });

  it('A/B: a module row opens when collapsed and closes immediately when expanded', async () => {
    const user = userEvent.setup();
    renderShell();
    expectGroup('personnel', 'link-nav-employees', false);
    await user.click(header('personnel'));
    expectGroup('personnel', 'link-nav-employees', true);
    await user.click(header('personnel'));
    expectGroup('personnel', 'link-nav-employees', false);
  });

  it('C/D: clicking the chevron itself opens and closes the module (no dead zone)', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(chevron('personnel'));
    expectGroup('personnel', 'link-nav-employees', true);
    await user.click(chevron('personnel'));
    expectGroup('personnel', 'link-nav-employees', false);
  });

  it('E: groups stay independently toggleable (existing multi-open design) — closing one never needs another', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(header('personnel'));
    await user.click(header('performance'));
    expectGroup('performance', 'link-nav-performance dashboard', true);
    expectGroup('personnel', 'link-nav-employees', true);
    await user.click(header('personnel'));
    expectGroup('personnel', 'link-nav-employees', false);
    expectGroup('performance', 'link-nav-performance dashboard', true);
  });

  it('F: the group holding the active route collapses on a deliberate click and stays collapsed', async () => {
    const user = userEvent.setup();
    renderShell('/leave-calendar');
    expectGroup('leave-management', 'link-nav-leave calendar', true);
    expect(screen.getByTestId('link-nav-leave calendar')).toHaveAttribute('aria-current', 'page');

    await user.click(chevron('leave-management'));
    expectGroup('leave-management', 'link-nav-leave calendar', false);

    // Further sidebar re-renders on the same route must not re-open it.
    await user.click(header('personnel'));
    await user.click(header('personnel'));
    expectGroup('leave-management', 'link-nav-leave calendar', false);

    await user.click(header('leave-management'));
    expectGroup('leave-management', 'link-nav-leave calendar', true);
  });

  it("G: navigating to another module's child reveals that module and leaves the others as the user set them", async () => {
    const user = userEvent.setup();
    const { navigate } = renderShell('/leave-calendar');
    await user.click(header('leave-management'));
    expectGroup('performance', 'link-nav-performance dashboard', false);

    act(() => navigate('/performance'));
    expectGroup('performance', 'link-nav-performance dashboard', true);
    expect(screen.getByTestId('link-nav-performance dashboard')).toHaveAttribute('aria-current', 'page');
    expectGroup('leave-management', 'link-nav-leave calendar', false);

    // Navigating back into Leave reveals it again: navigation outranks an earlier collapse.
    act(() => navigate('/leave-balances'));
    expectGroup('leave-management', 'link-nav-leave balances', true);
    expect(screen.getByTestId('link-nav-leave balances')).toHaveAttribute('aria-current', 'page');
  });

  it('H: rapid repeated clicks always leave header, chevron and panel in agreement', async () => {
    const user = userEvent.setup();
    renderShell('/leave-calendar');
    for (let i = 1; i <= 7; i++) {
      await user.click(i % 2 ? header('leave-management') : chevron('leave-management'));
      expectGroup('leave-management', 'link-nav-leave calendar', i % 2 === 0);
    }
    await user.dblClick(header('personnel'));
    expectGroup('personnel', 'link-nav-employees', false);
  });

  it('I: permission/module filtering still decides which groups exist', async () => {
    const user = userEvent.setup();
    modulesMock.mockReturnValue({ data: [{ key: 'leave', enabled: true, requiredModuleKeys: [] as string[] }] });
    renderShell('/leave-calendar');
    expect(screen.queryByTestId('button-nav-group-performance')).not.toBeInTheDocument();
    await user.click(header('leave-management'));
    expectGroup('leave-management', 'link-nav-leave calendar', false);
  });

  it('J: Enter and Space toggle the focused header, which points aria-controls at its panel', async () => {
    const user = userEvent.setup();
    renderShell('/leave-calendar');
    const leave = header('leave-management');
    const panelId = leave.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId as string)).toContainElement(screen.getByTestId('link-nav-leave calendar'));

    leave.focus();
    await user.keyboard('{Enter}');
    expectGroup('leave-management', 'link-nav-leave calendar', false);
    await user.keyboard(' ');
    expectGroup('leave-management', 'link-nav-leave calendar', true);
  });

  it('K: touch taps toggle the active group inside the mobile navigation drawer', async () => {
    const user = userEvent.setup();
    renderShell('/leave-calendar');
    await user.click(screen.getByTestId('button-open-menu'));
    const drawer = within(screen.getByRole('dialog', { name: 'Navigation menu' }));
    const leave = drawer.getByTestId('button-nav-group-leave-management');
    expect(leave).toHaveAttribute('aria-expanded', 'true');

    await user.pointer({ keys: '[TouchA]', target: leave });
    expect(leave).toHaveAttribute('aria-expanded', 'false');
    expect(drawer.queryByTestId('link-nav-leave calendar')).not.toBeInTheDocument();

    await user.pointer({ keys: '[TouchA]', target: leave });
    expect(leave).toHaveAttribute('aria-expanded', 'true');
    expect(drawer.getByTestId('link-nav-leave calendar')).toBeInTheDocument();
  });
});
