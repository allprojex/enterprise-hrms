/**
 * Admin console — one-click removals now go through a confirmation step:
 *
 *   - revoking a role from a member (DELETE membership_roles link);
 *   - revoking a permission from a custom role (DELETE role_permissions link);
 *   - disabling a module (enabling stays a single, unconfirmed switch).
 *
 * The mock set mirrors admin-reports-tab.test.tsx — the console reaches for all
 * of these hooks on mount. No real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const { outcome, spies, toastSpy } = vi.hoisted(() => {
  const outcome = { fail: false };
  const asyncMutation = () =>
    vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      if (outcome.fail) {
        const err = { error: 'Forbidden' };
        opts?.onError?.(err);
        return Promise.reject(err);
      }
      opts?.onSuccess?.();
      return Promise.resolve({});
    });
  return {
    outcome,
    toastSpy: vi.fn(),
    spies: { revokeRole: asyncMutation(), revokePermission: asyncMutation(), updateModule: asyncMutation() },
  };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({
    data: [
      {
        organizationId: 10,
        organizationName: 'Acme',
        organizationSlug: 'acme',
        status: 'active',
        roles: ['org_admin'],
        permissions: ['organization.read', 'organization.update', 'membership.read', 'membership.manage', 'role.manage', 'module.manage', 'primary_hr.manage', 'audit.read'],
        isPrimaryHr: false,
      },
    ],
    isLoading: false,
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListMembers: () => ({
    data: [
      {
        membershipId: 55,
        firstName: 'Ama',
        lastName: 'Mensah',
        email: 'ama@example.com',
        status: 'active',
        roles: ['hr'],
        isPrimaryHr: false,
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListMembersQueryKey: (id: number) => ['members', id],
  useAddMember: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInvitation: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMember: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMemberRole: () => ({ mutate: vi.fn(), mutateAsync: spies.revokeRole, isPending: false }),
  useListOrganizationRoles: () => ({
    data: [
      { id: 3, key: 'hr', label: 'HR', isSystemRole: true, delegable: true, permissionKeys: ['employee.read'] },
      { id: 9, key: 'ward_clerk', label: 'Ward Clerk', isSystemRole: false, delegable: true, permissionKeys: ['employee.read'] },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListOrganizationRolesQueryKey: (id: number) => ['organizationRoles', id],
  useCopyRoleTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useGrantRolePermission: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeRolePermission: () => ({ mutate: vi.fn(), mutateAsync: spies.revokePermission, isPending: false }),
  useListPermissions: () => ({ data: [{ id: 101, key: 'employee.read' }], isLoading: false }),
  getListPermissionsQueryKey: () => ['permissions'],
  useListOrganizationModules: () => ({
    data: [
      { key: 'leave', name: 'Leave', description: 'Leave requests', status: 'active', enabled: true },
      { key: 'payroll', name: 'Payroll', description: 'Payroll runs', status: 'active', enabled: false },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListOrganizationModulesQueryKey: (id: number) => ['modules', id],
  useUpdateOrganizationModule: () => ({ mutate: vi.fn(), mutateAsync: spies.updateModule, isPending: false }),
  useGetPrimaryHr: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  getGetPrimaryHrQueryKey: (id: number) => ['primaryHr', id],
  useSetPrimaryHr: () => ({ mutate: vi.fn(), isPending: false }),
  useGetOrganizationConfig: () => ({
    data: { organizationId: 10, namespace: 'general', schemaVersion: 1, data: {}, updatedAt: null },
    isLoading: false,
  }),
  getGetOrganizationConfigQueryKey: (id: number, namespace: string) => ['config', id, namespace],
  useUpdateOrganizationConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useGetOrganization: () => ({
    data: { id: 10, name: 'Acme', slug: 'acme', type: 'business', status: 'active', logoUrl: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getGetOrganizationQueryKey: (id: number) => ['organization', id],
  useUploadOrganizationLogo: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrganizationLogo: () => ({ mutate: vi.fn(), isPending: false }),
  getGetTenantContextQueryKey: () => ['tenantContext'],
  useListAuditEvents: () => ({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListAuditEventsQueryKey: (id: number) => ['auditEvents', id],
  useListReports: () => ({ data: [], isLoading: false }),
  getListReportsQueryKey: () => ['reports'],
  useRunReport: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  getRunReportQueryKey: () => ['runReport'],
  getRunReportUrl: () => 'https://example.invalid/report.csv',
}));

const { default: Admin } = await import('@/pages/admin');

function renderAdmin() {
  const { hook } = memoryLocation({ path: '/admin/10' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Switch>
          <Route path="/admin/:organizationId" component={Admin} />
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  outcome.fail = false;
  toastSpy.mockClear();
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe('Admin console — revoke a role from a member', () => {
  const DIALOG = 'dialog-revoke-role';

  it('opens a confirmation naming the member and role, and Cancel revokes nothing', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByTestId('button-revoke-role-55-hr'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Revoke role?');
    expect(dialog).toHaveTextContent('“Ama Mensah” will no longer hold the “HR” role');
    expect(spies.revokeRole).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.revokeRole).not.toHaveBeenCalled();
  });

  it('revokes exactly once on confirm, then closes', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByTestId('button-revoke-role-55-hr'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.revokeRole).toHaveBeenCalledTimes(1);
    expect(spies.revokeRole.mock.calls[0]![0]).toEqual({ organizationId: 10, membershipId: 55, roleId: 3 });
  });

  it('stays open with the member row intact when the server refuses', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderAdmin();

    await user.click(await screen.findByTestId('button-revoke-role-55-hr'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not revoke role', variant: 'destructive' })),
    );
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('row-member-55')).toBeInTheDocument();
  });
});

describe('Admin console — revoke a permission from a custom role', () => {
  const DIALOG = 'dialog-revoke-permission';

  it('asks first, runs nothing on Cancel, and revokes exactly once on confirm', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByTestId('tab-roles'));
    await user.click(await screen.findByTestId('button-revoke-permission-9-employee.read'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Revoke permission?');
    expect(dialog).toHaveTextContent('“employee.read” will be removed from the “Ward Clerk” role');
    expect(spies.revokePermission).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.revokePermission).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('button-revoke-permission-9-employee.read'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.revokePermission).toHaveBeenCalledTimes(1);
    expect(spies.revokePermission.mock.calls[0]![0]).toEqual({ organizationId: 10, roleId: 9, permissionId: 101 });
  });

  it('stays open with the role row intact when the server refuses', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderAdmin();

    await user.click(await screen.findByTestId('tab-roles'));
    await user.click(await screen.findByTestId('button-revoke-permission-9-employee.read'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not revoke permission', variant: 'destructive' })),
    );
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('row-role-9')).toBeInTheDocument();
  });
});

describe('Admin console — disabling a module', () => {
  const DIALOG = 'dialog-disable-module';

  it('asks before disabling, runs nothing on Cancel, and disables exactly once on confirm', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByTestId('tab-modules'));
    await user.click(await screen.findByTestId('switch-module-leave'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Disable module?');
    expect(dialog).toHaveTextContent('“Leave” will be turned off for this organisation');
    expect(dialog).toHaveTextContent('Its existing data is kept');
    expect(spies.updateModule).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.updateModule).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('switch-module-leave'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(spies.updateModule).toHaveBeenCalledTimes(1);
    expect(spies.updateModule.mock.calls[0]![0]).toEqual({ organizationId: 10, moduleKey: 'leave', data: { enabled: false } });
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Module disabled' });
  });

  it('keeps the dialog open when the server refuses to disable', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderAdmin();

    await user.click(await screen.findByTestId('tab-modules'));
    await user.click(await screen.findByTestId('switch-module-leave'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not disable module', variant: 'destructive' })),
    );
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('row-module-leave')).toBeInTheDocument();
  });

  it('enables a module directly, without a confirmation', async () => {
    const user = userEvent.setup();
    renderAdmin();

    await user.click(await screen.findByTestId('tab-modules'));
    await user.click(await screen.findByTestId('switch-module-payroll'));

    expect(screen.queryByTestId(DIALOG)).toBeNull();
    await waitFor(() => expect(spies.updateModule).toHaveBeenCalledTimes(1));
    expect(spies.updateModule.mock.calls[0]![0]).toEqual({ organizationId: 10, moduleKey: 'payroll', data: { enabled: true } });
  });
});
