import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetTenantContext, getGetTenantContextQueryKey } from '@workspace/api-client-react';
import { applyTenantTheme, clearTenantTheme } from '@/lib/tenant-theme-tokens';

/**
 * Renders nothing — applies the current tenant's own theme tokens (if any)
 * as inline CSS custom property overrides on the document root. Mounted
 * once near the app root so it runs identically before and after login
 * (GET /tenant-context is public and hostname-scoped either way), driving
 * both the login page and the authenticated shell from one source.
 *
 * The token mapping, derivation (hover / soft / focus / sidebar states) and
 * the readability clamp live in lib/tenant-theme-tokens.ts so the invitation
 * page — which scopes its theme to the INVITED organization, never the
 * hostname — applies exactly the same rules.
 *
 * An organization that hasn't configured a theme (every organization but
 * WWM today) leaves every property untouched — the stylesheet's own
 * default light/dark values apply exactly as they did before this
 * component existed. Switching tenants (a different hostname, or the
 * unmapped-host fallback) always first clears every previously-set
 * property, so one organization's colors can never persist onto another's
 * render.
 */
export function TenantTheme() {
  const { data: tenantContext } = useGetTenantContext({ query: { queryKey: getGetTenantContextQueryKey() } });
  const [location] = useLocation();
  // The invitation accept page owns its theme from the INVITED organization
  // (invite-accept.tsx), never from the hostname the link was opened on.
  const onInvitePage = location.startsWith('/invite/');

  useEffect(() => {
    if (onInvitePage) return;
    const root = document.documentElement;
    const theme = tenantContext?.resolved ? tenantContext.theme : null;
    if (!theme) {
      clearTenantTheme(root);
      return;
    }
    applyTenantTheme(root, theme, { dark: root.classList.contains('dark') });
  }, [tenantContext, onInvitePage]);

  return null;
}
