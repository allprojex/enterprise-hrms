/**
 * Tests the Admin console's route guard: it's a UX-level gate (the real
 * enforcement is server-side, see artifacts/api-server), but a non-admin
 * navigating here directly should still be redirected rather than shown a
 * console full of actions that would all 403.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Admin from '@/pages/admin';

const { emptyList, emptyObject } = vi.hoisted(() => ({
  emptyList: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  emptyObject: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: vi.fn(),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListMembers: emptyList,
  getListMembersQueryKey: (id: number) => ['members', id],
  useAddMember: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInvitation: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMember: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useListOrganizationRoles: emptyList,
  getListOrganizationRolesQueryKey: (id: number) => ['organizationRoles', id],
  useGetPrimaryHr: emptyObject,
  getGetPrimaryHrQueryKey: (id: number) => ['primaryHr', id],
  useSetPrimaryHr: () => ({ mutate: vi.fn(), isPending: false }),
  useGetOrganizationConfig: () => ({
    data: { organizationId: 10, namespace: 'general', schemaVersion: 1, data: {}, updatedAt: null },
    isLoading: false,
  }),
  getGetOrganizationConfigQueryKey: (id: number, namespace: string) => ['config', id, namespace],
  useUpdateOrganizationConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useListAuditEvents: () => ({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListAuditEventsQueryKey: (id: number) => ['auditEvents', id],
}));

import { useListMyOrganizations } from '@workspace/api-client-react';

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, history } = memoryLocation({ path: '/admin', record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Admin />
      </Router>
    </QueryClientProvider>,
  );
  return history!;
}

describe('Admin console route guard', () => {
  it('redirects a non-admin member to /unauthorized', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['employee'], isPrimaryHr: false }],
      isLoading: false,
    } as never);

    const history = renderAdmin();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/unauthorized');
    });
  });

  it('renders the console for an org_admin', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['org_admin'], isPrimaryHr: false }],
      isLoading: false,
    } as never);

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Admin Console')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-members')).toBeInTheDocument();
    expect(screen.getByTestId('tab-hr-settings')).toBeInTheDocument();
    expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
  });

  // Primary HR Administrator delegation: the ACTIVE Primary HR holding
  // hr_administrator gets the console in HR-team mode (Members + Roles only).
  it('renders HR Team Management (Members and Roles only) for the Primary HR holding hr_administrator', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['hr_administrator'], isPrimaryHr: true }],
      isLoading: false,
    } as never);

    const history = renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('HR Team Management')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-members')).toBeInTheDocument();
    expect(screen.getByTestId('tab-roles')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-hr-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-modules')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-master-data')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-audit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-reports')).not.toBeInTheDocument();
    expect(history).not.toContain('/unauthorized');
  });

  it('redirects an hr_administrator who is not the Primary HR', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['hr_administrator'], isPrimaryHr: false }],
      isLoading: false,
    } as never);

    const history = renderAdmin();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/unauthorized');
    });
  });

  it('redirects a Primary HR who does not hold hr_administrator', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['hr_manager'], isPrimaryHr: true }],
      isLoading: false,
    } as never);

    const history = renderAdmin();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/unauthorized');
    });
  });

  it('keeps the full console for an org_admin who is also the Primary HR', async () => {
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 10, organizationName: 'Acme', organizationSlug: 'acme', status: 'active', roles: ['org_admin', 'hr_administrator'], isPrimaryHr: true }],
      isLoading: false,
    } as never);

    renderAdmin();

    await waitFor(() => {
      expect(screen.getByText('Admin Console')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-modules')).toBeInTheDocument();
  });
});
