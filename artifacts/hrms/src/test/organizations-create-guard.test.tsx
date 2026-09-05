/**
 * Platform ownership boundary (frontend): the "+ New Organisation" control is
 * shown ONLY to the genuine platform super_admin (users.role). A tenant HR
 * Administrator (or any tenant role) must not see it. The server enforces the
 * same via requireSuperAdmin; this test guards the UI affordance.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const { meRef } = vi.hoisted(() => ({ meRef: { current: undefined as unknown } }));

vi.mock('@workspace/api-client-react', () => {
  const empty = () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  const emptyObj = () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() });
  const noMutation = () => ({ mutate: vi.fn(), isPending: false });
  return ({
  useListOrganizations: () => ({ data: [{ id: 3, name: 'Worldwide Word Ministries', slug: 'wwm', status: 'active', type: 'church', createdAt: new Date().toISOString(), tenantUuid: null, industry: null, logoUrl: null, employeeCount: null }], isLoading: false, error: null, refetch: vi.fn() }),
  getListOrganizationsQueryKey: () => ['orgs'],
  useGetOrganization: emptyObj,
  getGetOrganizationQueryKey: (id: number) => ['org', id],
  useCreateOrganization: noMutation,
  useUpdateOrganization: noMutation,
  useSuspendOrganization: noMutation,
  useReactivateOrganization: noMutation,
  useGetMe: () => ({ data: meRef.current, isLoading: false }),
  getGetMeQueryKey: () => ['me'],
  useListMyOrganizations: () => ({ data: [{ organizationId: 3, organizationName: 'Worldwide Word Ministries', organizationSlug: 'wwm', status: 'active', roles: ['hr_administrator'], isPrimaryHr: true }], isLoading: false }),
  getListMyOrganizationsQueryKey: () => ['myOrgs'],
  useListOrganizationDomains: empty,
  getListOrganizationDomainsQueryKey: (id: number) => ['domains', id],
  useCreateOrganizationDomain: noMutation,
  useActivateOrganizationDomain: noMutation,
  useDisableOrganizationDomain: noMutation,
  useSetPrimaryOrganizationDomain: noMutation,
  useGetTenantIdentity: emptyObj,
  getGetTenantIdentityQueryKey: (id: number) => ['identity', id],
  });
});

import Organizations from '@/pages/organizations';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/organizations' });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Organizations />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Organisations page — New Organisation control', () => {
  it('is hidden for a tenant HR Administrator (Primary HR)', async () => {
    meRef.current = { id: 433, role: 'employee', organizationId: 3, activeOrganizationId: 3 };
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Organisations')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('button-add-organization')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-platform-admin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-toggle-organization-status')).not.toBeInTheDocument();
  });

  it('is visible for the genuine platform super_admin', async () => {
    meRef.current = { id: 1, role: 'super_admin', organizationId: 1, activeOrganizationId: 1 };
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('button-add-organization')).toBeInTheDocument();
    });
    expect(screen.getByTestId('button-platform-admin')).toBeInTheDocument();
  });
});
