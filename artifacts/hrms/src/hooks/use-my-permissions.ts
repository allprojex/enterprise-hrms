import { useMemo } from 'react';
import { useListMyOrganizations, getListMyOrganizationsQueryKey } from '@workspace/api-client-react';

/**
 * The caller's EFFECTIVE permission keys for one organization, as a Set.
 *
 * Reads the same source the sidebar's Administration gating already trusts —
 * `MembershipSummary.permissions` from GET /me/organizations, computed
 * server-side from membership_roles → role_permissions. Never `me.role`, which
 * is the legacy platform-wide column and says nothing about what a membership
 * may do inside a tenant.
 *
 * Fails closed: while the query is loading, or if the field is absent, the set
 * is empty, so a permission-gated control stays hidden rather than flashing
 * into view and then failing server-side.
 *
 * This only decides what to SHOW. Every capability it gates is independently
 * enforced by the API.
 */
export function useMyPermissions(organizationId: number): ReadonlySet<string> {
  const { data } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: organizationId > 0 },
  });

  return useMemo(() => {
    const membership = data?.find((m) => m.organizationId === organizationId);
    return new Set<string>(membership?.permissions ?? []);
  }, [data, organizationId]);
}
