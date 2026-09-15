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
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Departments from '@/pages/departments';

const ORG = 10;
const DEPT = 100;

const state: { permissions: string[]; roles: string[]; headEnabledCalls: boolean[] } = {
  permissions: [],
  roles: ['org_admin'],
  headEnabledCalls: [],
};

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { organizationId: ORG, role: 'employee' } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({
    data: [{ organizationId: ORG, roles: state.roles, permissions: state.permissions, isPrimaryHr: false }],
    isLoading: false,
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],

  useListDepartments: () => ({
    data: [{ id: DEPT, organizationId: ORG, name: 'North Ridge Operations', code: 'NRO', status: 'active', branchId: null, parentDepartmentId: null }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListDepartmentsQueryKey: () => ['departments', ORG],
  useCreateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useRestructureDepartment: () => ({ mutate: vi.fn(), isPending: false }),
  useListBranches: () => ({ data: [], isLoading: false }),
  getListBranchesQueryKey: () => ['branches', ORG],
  useListMembers: () => ({ data: [], isLoading: false }),
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
  useRevokeDepartmentHead: () => ({ mutate: vi.fn(), isPending: false }),
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
