/**
 * ROLE-02 — Department Head cell affordances follow EFFECTIVE PERMISSIONS.
 *
 * The cell used to fetch the current head unconditionally and render the
 * assign/revoke controls for anyone who reached the page. An org_admin — who
 * may now read a head assignment but still may not appoint one — therefore
 * produced one 403 per department and was offered controls the server refuses.
 *
 * These tests pin the affordance rules, all resolved from
 * MembershipSummary.permissions and never from a role name:
 *
 *   department.head.read  (or .manage) -> the head is fetched and shown
 *   department.head.manage             -> assign / revoke controls appear
 *   neither                            -> nothing is fetched, a dash is shown
 *
 * The server remains authoritative — departmentHeadReadAuthz.test.ts covers
 * the actual authorization. @workspace/api-client-react is mocked at the hook
 * level; no real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Departments from '@/pages/departments';

const ORG = 10;
const DEPT = 100;

const state: { permissions: string[]; roles: string[]; headEnabledCalls: boolean[]; departmentStatus: string } = {
  permissions: [],
  roles: ['org_admin'],
  headEnabledCalls: [],
  departmentStatus: 'active',
};

// Confirmation-dialog spies. Each mutateAsync mirrors TanStack Query: it runs
// the per-call onSuccess/onError the page passes, then resolves or rejects.
const { spies, outcome, toastSpy } = vi.hoisted(() => {
  const outcome = { fail: false };
  const asyncMutation = () =>
    vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      if (outcome.fail) {
        const err = { error: 'Department still has dependents and cannot be archived' };
        opts?.onError?.(err);
        return Promise.reject(err);
      }
      opts?.onSuccess?.();
      return Promise.resolve({});
    });
  return {
    outcome,
    toastSpy: vi.fn(),
    spies: { archive: asyncMutation(), reactivate: asyncMutation(), revokeHead: asyncMutation() },
  };
});

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { organizationId: ORG, role: 'employee' } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({
    data: [{ organizationId: ORG, roles: state.roles, permissions: state.permissions, isPrimaryHr: false }],
    isLoading: false,
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],

  useListDepartments: () => ({
    data: [{ id: DEPT, organizationId: ORG, name: 'North Ridge Operations', code: 'NRO', status: state.departmentStatus, branchId: null, parentDepartmentId: null }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListDepartmentsQueryKey: () => ['departments', ORG],
  useCreateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveDepartment: () => ({ mutate: vi.fn(), mutateAsync: spies.archive, isPending: false }),
  useReactivateDepartment: () => ({ mutate: vi.fn(), mutateAsync: spies.reactivate, isPending: false }),
  useRestructureDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useListBranches: () => ({ data: [], isLoading: false }),
  getListBranchesQueryKey: () => ['branches', ORG],
  useListMembers: () => ({ data: [{ membershipId: 77, firstName: 'Efua', lastName: 'Boateng', status: 'active' }], isLoading: false }),
  getListMembersQueryKey: () => ['members', ORG],

  // Records whether the page asked for the head at all, so "no capability =>
  // no request" is asserted rather than assumed.
  useGetCurrentDepartmentHead: (_orgId: number, _deptId: number, opts?: { query?: { enabled?: boolean } }) => {
    const enabled = opts?.query?.enabled ?? true;
    state.headEnabledCalls.push(enabled);
    return { data: enabled ? { id: 1, organizationId: ORG, departmentId: DEPT, headMembershipId: 77 } : undefined, isLoading: false };
  },
  getGetCurrentDepartmentHeadQueryKey: () => ['departmentHead', ORG, DEPT],
  useAssignDepartmentHead: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeDepartmentHead: () => ({ mutate: vi.fn(), mutateAsync: spies.revokeHead, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Departments />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.permissions = [];
  state.roles = ['org_admin'];
  state.headEnabledCalls = [];
  state.departmentStatus = 'active';
  outcome.fail = false;
  toastSpy.mockClear();
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe('ROLE-02 — Department Head affordances follow effective permissions', () => {
  it('shows the head and no controls for a reader (department.head.read only)', () => {
    state.permissions = ['department.read', 'department.manage', 'department.head.read'];
    renderPage();

    expect(screen.getByTestId(`text-department-head-${DEPT}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`button-open-assign-head-${DEPT}`)).toBeNull();
    expect(screen.queryByTestId(`button-revoke-head-${DEPT}`)).toBeNull();
    expect(state.headEnabledCalls.some((enabled) => enabled)).toBe(true);
  });

  it('shows the head and the controls for a manager (department.head.manage)', () => {
    state.permissions = ['department.read', 'department.head.manage'];
    renderPage();

    expect(screen.getByTestId(`text-department-head-${DEPT}`)).toBeInTheDocument();
    expect(screen.getByTestId(`button-open-assign-head-${DEPT}`)).toBeInTheDocument();
    expect(screen.getByTestId(`button-revoke-head-${DEPT}`)).toBeInTheDocument();
  });

  it('fetches nothing and shows a dash without either capability', () => {
    state.permissions = ['department.read'];
    renderPage();

    expect(screen.getByTestId(`text-department-head-hidden-${DEPT}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`text-department-head-${DEPT}`)).toBeNull();
    expect(screen.queryByTestId(`button-open-assign-head-${DEPT}`)).toBeNull();
    // The doomed request is never issued.
    expect(state.headEnabledCalls.every((enabled) => enabled === false)).toBe(true);
  });

  it('is driven by permissions, not by role name — an hr-named role without the keys still sees nothing', () => {
    state.roles = ['hr'];
    state.permissions = ['department.read'];
    renderPage();

    expect(screen.getByTestId(`text-department-head-hidden-${DEPT}`)).toBeInTheDocument();
    expect(state.headEnabledCalls.every((enabled) => enabled === false)).toBe(true);
  });

  it('grants the read affordance to a custom role that holds the key, whatever it is named', () => {
    state.roles = ['some_tenant_defined_role'];
    state.permissions = ['department.head.read'];
    renderPage();

    expect(screen.getByTestId(`text-department-head-${DEPT}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`button-open-assign-head-${DEPT}`)).toBeNull();
  });
});

describe('Destructive department actions require confirmation', () => {
  const HEAD_DIALOG = `dialog-revoke-head-${DEPT}`;
  const STATUS_DIALOG = 'dialog-department-status';

  it('revoking the head opens a confirmation that runs nothing, and Cancel keeps it that way', async () => {
    const user = userEvent.setup();
    state.permissions = ['department.read', 'department.head.manage'];
    renderPage();

    await user.click(screen.getByTestId(`button-revoke-head-${DEPT}`));
    const dialog = screen.getByTestId(HEAD_DIALOG);
    expect(dialog).toHaveTextContent('Revoke department head?');
    // End-dates the appointment — never described as a deletion.
    expect(dialog).toHaveTextContent('“Efua Boateng” will no longer be head of “North Ridge Operations” from now on');
    expect(dialog).toHaveTextContent('The appointment history is kept.');
    expect(dialog.textContent ?? '').not.toMatch(/delete/i);
    expect(spies.revokeHead).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${HEAD_DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(HEAD_DIALOG)).toBeNull());
    expect(spies.revokeHead).not.toHaveBeenCalled();
  });

  it('confirming the head revoke calls the mutation once, then closes and toasts', async () => {
    const user = userEvent.setup();
    state.permissions = ['department.read', 'department.head.manage'];
    renderPage();

    await user.click(screen.getByTestId(`button-revoke-head-${DEPT}`));
    await user.click(screen.getByTestId(`${HEAD_DIALOG}-confirm`));

    await waitFor(() => expect(screen.queryByTestId(HEAD_DIALOG)).toBeNull());
    expect(spies.revokeHead).toHaveBeenCalledTimes(1);
    expect(spies.revokeHead.mock.calls[0]![0]).toEqual({ organizationId: ORG, departmentId: DEPT });
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Department Head revoked — department is now vacant' });
  });

  it('archiving asks first, then archives exactly once and closes on success', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId(`button-toggle-department-status-${DEPT}`));
    const dialog = screen.getByTestId(STATUS_DIALOG);
    expect(dialog).toHaveTextContent('Archive department?');
    expect(dialog).toHaveTextContent('“North Ridge Operations” will be archived (marked inactive)');
    expect(screen.getByTestId(`${STATUS_DIALOG}-confirm`)).toHaveTextContent('Archive Department');
    expect(spies.archive).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${STATUS_DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(STATUS_DIALOG)).toBeNull());
    expect(spies.archive).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`button-toggle-department-status-${DEPT}`));
    await user.click(screen.getByTestId(`${STATUS_DIALOG}-confirm`));
    await waitFor(() => expect(screen.queryByTestId(STATUS_DIALOG)).toBeNull());
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(spies.archive.mock.calls[0]![0]).toEqual({ organizationId: ORG, id: DEPT });
    expect(spies.reactivate).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Department archived' });
  });

  it('keeps the dialog open and the row in place when the server refuses the archive', async () => {
    const user = userEvent.setup();
    outcome.fail = true;
    renderPage();

    await user.click(screen.getByTestId(`button-toggle-department-status-${DEPT}`));
    await user.click(screen.getByTestId(`${STATUS_DIALOG}-confirm`));

    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not update department status', variant: 'destructive' })),
    );
    expect(spies.archive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(STATUS_DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId(`row-department-${DEPT}`)).toBeInTheDocument();
  });

  it('offers reactivation of an inactive department with a non-destructive confirmation', async () => {
    const user = userEvent.setup();
    state.departmentStatus = 'inactive';
    renderPage();

    await user.click(screen.getByTestId(`button-toggle-department-status-${DEPT}`));
    expect(screen.getByTestId(STATUS_DIALOG)).toHaveTextContent('Reactivate department?');
    await user.click(screen.getByTestId(`${STATUS_DIALOG}-confirm`));
    await waitFor(() => expect(spies.reactivate).toHaveBeenCalledTimes(1));
    expect(spies.archive).not.toHaveBeenCalled();
  });

  it('still hides the archive and revoke triggers from a caller without HR or head-manage capability', () => {
    state.roles = ['employee'];
    state.permissions = ['department.read', 'department.head.read'];
    renderPage();

    expect(screen.queryByTestId(`button-toggle-department-status-${DEPT}`)).toBeNull();
    expect(screen.queryByTestId(`button-revoke-head-${DEPT}`)).toBeNull();
  });
});
