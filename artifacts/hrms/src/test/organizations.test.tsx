/**
 * Tests for the platform Organisations page, and specifically for the
 * Organisation Details panel.
 *
 * The defect these were written for: GET /organizations is hostname-neutral
 * and returns every tenant to a platform super_admin, while
 * GET /organizations/:id is hostname-BOUND (organizations.ts runs
 * tenantHostnameAllowsOrganization before authorizing, with no super_admin
 * exemption — see organizationTenantHostname.test.ts case 12b). Browsing from
 * a tenant address therefore lists organisations whose details that address
 * may not open, and the panel used to render `null` in exactly that case: a
 * card with a heading, an empty body, and nothing telling the operator what
 * had happened or what to do instead.
 *
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Organizations from '@/pages/organizations';

vi.mock('@workspace/api-client-react', () => ({
  useListOrganizations: vi.fn(),
  getListOrganizationsQueryKey: () => ['organizations'],
  useGetOrganization: vi.fn(),
  getGetOrganizationQueryKey: (id: number) => ['organization', id],
  useCreateOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useSuspendOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useGetMe: vi.fn(),
  getGetMeQueryKey: () => ['me'],
  useListMyOrganizations: vi.fn(),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListOrganizationDomains: () => ({ data: [], isLoading: false }),
  getListOrganizationDomainsQueryKey: (id: number) => ['domains', id],
  useCreateOrganizationDomain: () => ({ mutate: vi.fn(), isPending: false }),
  useActivateOrganizationDomain: () => ({ mutate: vi.fn(), isPending: false }),
  useDisableOrganizationDomain: () => ({ mutate: vi.fn(), isPending: false }),
  useSetPrimaryOrganizationDomain: () => ({ mutate: vi.fn(), isPending: false }),
  useGetTenantIdentity: () => ({ data: undefined, isLoading: false }),
  getGetTenantIdentityQueryKey: (id: number) => ['tenantIdentity', id],
  useGetTenantContext: vi.fn(),
  getGetTenantContextQueryKey: () => ['tenantContext'],
}));

import {
  useListOrganizations,
  useGetOrganization,
  useGetMe,
  useListMyOrganizations,
  useGetTenantContext,
} from '@workspace/api-client-react';

const WWM = {
  id: 3,
  tenantUuid: 'uuid-wwm',
  name: 'Worldwide Word Ministries',
  slug: 'wwm',
  type: 'church',
  status: 'trial',
  logoUrl: null,
  industry: null,
  employeeCount: 10,
  createdAt: '2026-08-14T00:00:00.000Z',
};

const ACME = {
  id: 4,
  tenantUuid: 'uuid-acme',
  name: 'Acme',
  slug: 'acme',
  type: 'business',
  status: 'active',
  logoUrl: null,
  industry: null,
  employeeCount: 2,
  createdAt: '2026-08-12T00:00:00.000Z',
};

const SUSPENDED = { ...ACME, id: 5, tenantUuid: 'uuid-old', name: 'Retired Tenant', slug: 'retired', status: 'suspended' };

/** The detail query, keyed by id, so selection changes swap the response the way the real hook does. */
function mockDetailsByOrgId(byId: Record<number, unknown>, opts: { error?: unknown } = {}) {
  vi.mocked(useGetOrganization).mockImplementation(
    ((id: number) => {
      const data = byId[id];
      return {
        data,
        isLoading: false,
        error: data === undefined ? (opts.error ?? null) : null,
        refetch: vi.fn(),
      };
    }) as never,
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Organizations />
    </QueryClientProvider>,
  );
}

function selectOrganisation(name: string) {
  fireEvent.click(screen.getByText(name));
}

function detailsPanel(): HTMLElement {
  return screen.getByText('Organisation Details').closest('[class*="sticky"]') as HTMLElement;
}

describe('Organisations page — details panel', () => {
  beforeEach(() => {
    vi.mocked(useGetMe).mockReturnValue({ data: { id: 1, role: 'super_admin' } } as never);
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 3, roles: ['org_admin'], permissions: [] }],
    } as never);
    vi.mocked(useListOrganizations).mockReturnValue({
      data: [WWM, ACME, SUSPENDED],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never);
    // Default: the platform address, which resolves to no tenant.
    vi.mocked(useGetTenantContext).mockReturnValue({ data: { resolved: false } } as never);
    mockDetailsByOrgId({ 3: WWM, 4: ACME, 5: SUSPENDED });
  });

  it('prompts for a selection before anything is chosen', () => {
    renderPage();
    expect(screen.getByText(/click on an organisation to see more details/i)).toBeInTheDocument();
  });

  it('selecting Acme renders Acme details', () => {
    renderPage();
    selectOrganisation('Acme');

    const panel = detailsPanel();
    expect(within(panel).getByTestId('text-org-slug')).toHaveTextContent('acme');
    expect(within(panel).getByTestId('text-org-internal-id')).toHaveTextContent('#4');
    expect(within(panel).getByTestId('text-org-tenant-uuid')).toHaveTextContent('uuid-acme');
  });

  it('changing selection updates the details panel, and never shows another tenant', () => {
    renderPage();

    selectOrganisation('Acme');
    let panel = detailsPanel();
    expect(within(panel).getByTestId('text-org-slug')).toHaveTextContent('acme');
    expect(within(panel).queryByText('uuid-wwm')).not.toBeInTheDocument();

    selectOrganisation('Worldwide Word Ministries');
    panel = detailsPanel();
    expect(within(panel).getByTestId('text-org-slug')).toHaveTextContent('wwm');
    expect(within(panel).getByTestId('text-org-tenant-uuid')).toHaveTextContent('uuid-wwm');
    // The previous tenant's identity is fully gone, not merely covered up.
    expect(within(panel).queryByText('uuid-acme')).not.toBeInTheDocument();
    expect(within(panel).getByTestId('text-org-internal-id')).toHaveTextContent('#3');
  });

  it('an active organisation exposes the governed Suspend action to a platform super_admin', () => {
    renderPage();
    selectOrganisation('Acme');

    const toggle = screen.getByTestId('button-toggle-organization-status');
    expect(toggle).toHaveTextContent('Suspend');
  });

  it('a trial organisation renders its trial status and is still suspendable', () => {
    renderPage();
    selectOrganisation('Worldwide Word Ministries');

    const panel = detailsPanel();
    // WWM is a live customer on `trial`; the panel must report that honestly.
    expect(within(panel).getByText('trial')).toBeInTheDocument();
    expect(screen.getByTestId('button-toggle-organization-status')).toHaveTextContent('Suspend');
  });

  it('a suspended organisation exposes Reactivate instead of Suspend', () => {
    renderPage();
    selectOrganisation('Retired Tenant');

    const toggle = screen.getByTestId('button-toggle-organization-status');
    expect(toggle).toHaveTextContent('Reactivate');
    expect(toggle).not.toHaveTextContent('Suspend');
  });

  it('a non-super_admin gets no platform organisation lifecycle control', () => {
    vi.mocked(useGetMe).mockReturnValue({ data: { id: 9, role: 'user' } } as never);
    vi.mocked(useListMyOrganizations).mockReturnValue({
      data: [{ organizationId: 4, roles: ['org_admin'], permissions: [] }],
    } as never);

    renderPage();
    selectOrganisation('Acme');

    // Details still render for an organisation they belong to...
    expect(within(detailsPanel()).getByTestId('text-org-slug')).toHaveTextContent('acme');
    // ...but suspend/reactivate is platform authority, and must not appear.
    expect(screen.queryByTestId('button-toggle-organization-status')).not.toBeInTheDocument();
  });

  describe('when the browsed address is bound to a different tenant', () => {
    beforeEach(() => {
      // On WWM's own address: the server allows org 3 and refuses every other
      // organisation with a 403 before authorization even runs.
      vi.mocked(useGetTenantContext).mockReturnValue({
        data: { resolved: true, organizationId: 3, organizationName: 'Worldwide Word Ministries' },
      } as never);
      mockDetailsByOrgId({ 3: WWM }, { error: { status: 403 } });
    });

    it('explains the denial instead of rendering an empty panel', () => {
      renderPage();
      selectOrganisation('Acme');

      const blocked = screen.getByTestId('org-details-tenant-host-blocked');
      expect(blocked).toBeInTheDocument();
      // Names the tenant the address is bound to, and the organisation that
      // cannot be opened from it — the two facts the operator needs.
      expect(blocked).toHaveTextContent(/Worldwide Word Ministries/);
      expect(blocked).toHaveTextContent(/Acme/);
      expect(blocked).toHaveTextContent(/platform address/i);
      // This is the regression: the panel body was previously empty.
      expect(within(detailsPanel()).queryByTestId('text-org-slug')).not.toBeInTheDocument();
    });

    it('is announced as an alert, not left silent for assistive technology', () => {
      renderPage();
      selectOrganisation('Acme');
      expect(screen.getByTestId('org-details-tenant-host-blocked')).toHaveAttribute('role', 'alert');
    });

    it('offers no retry, because retrying cannot succeed from this address', () => {
      renderPage();
      selectOrganisation('Acme');

      const blocked = screen.getByTestId('org-details-tenant-host-blocked');
      expect(within(blocked).queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    });

    it('still renders full details for the organisation this address IS bound to', () => {
      renderPage();
      selectOrganisation('Worldwide Word Ministries');

      expect(within(detailsPanel()).getByTestId('text-org-slug')).toHaveTextContent('wwm');
      expect(screen.queryByTestId('org-details-tenant-host-blocked')).not.toBeInTheDocument();
    });

    it('leaks no part of the blocked tenant beyond the name already in the list response', () => {
      renderPage();
      selectOrganisation('Acme');

      const panel = detailsPanel();
      expect(within(panel).queryByText('uuid-acme')).not.toBeInTheDocument();
      expect(within(panel).queryByTestId('text-org-internal-id')).not.toBeInTheDocument();
      expect(screen.queryByTestId('button-toggle-organization-status')).not.toBeInTheDocument();
    });
  });

  describe('when the detail request fails for any other reason', () => {
    beforeEach(() => {
      mockDetailsByOrgId({ 3: WWM, 5: SUSPENDED }, { error: { status: 500 } });
    });

    it('shows a retryable error rather than an empty panel', () => {
      renderPage();
      selectOrganisation('Acme');

      const error = screen.getByTestId('org-details-error');
      expect(error).toBeInTheDocument();
      expect(error).toHaveAttribute('role', 'alert');
      expect(within(error).getByRole('button', { name: /retry/i })).toBeInTheDocument();
      expect(screen.queryByTestId('org-details-tenant-host-blocked')).not.toBeInTheDocument();
    });
  });

  describe('while the details are still resolving', () => {
    it('shows progress, never a premature failure', () => {
      vi.mocked(useGetOrganization).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      } as never);

      renderPage();
      selectOrganisation('Acme');

      expect(screen.getByLabelText(/loading organisation details/i)).toBeInTheDocument();
      expect(screen.queryByTestId('org-details-error')).not.toBeInTheDocument();
    });

    it('does not report a failure when the query has been enabled but has not started', () => {
      // isLoading false, no data, no error — the gap the old `: null` branch
      // shared with a genuine failure.
      vi.mocked(useGetOrganization).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as never);

      renderPage();
      selectOrganisation('Acme');

      expect(screen.getByLabelText(/loading organisation details/i)).toBeInTheDocument();
      expect(screen.queryByTestId('org-details-error')).not.toBeInTheDocument();
    });
  });

  it('keeps the details panel in the normal document flow so it stacks on narrow screens', () => {
    renderPage();
    selectOrganisation('Acme');

    // The grid declares columns only at `lg`, so below that breakpoint it is
    // a single column and the panel stacks under the list rather than being
    // squeezed into a third of a phone screen.
    const column = detailsPanel().parentElement as HTMLElement;
    expect(column.className).toContain('lg:col-span-1');
    const grid = column.parentElement as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-3');
    expect(grid.className).not.toMatch(/(^|\s)grid-cols-[2-9]/);
  });
});
