import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetTenantContext, getGetTenantContextQueryKey } from '@workspace/api-client-react';

// Maps TenantThemeTokens keys straight onto the CSS custom property names
// index.css already defines (see :root / .dark there). Deliberately a
// small, fixed list — not a general theming engine — so an organization
// can only ever recolor these specific tokens, never inject arbitrary CSS.
const CSS_VARIABLE_BY_THEME_KEY = {
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  ring: '--ring',
} as const;

const ALL_CSS_VARIABLES = Object.values(CSS_VARIABLE_BY_THEME_KEY);

/**
 * Renders nothing — applies the current tenant's own theme tokens (if any)
 * as inline CSS custom property overrides on the document root. Mounted
 * once near the app root so it runs identically before and after login
 * (GET /tenant-context is public and hostname-scoped either way), driving
 * both the login page and the authenticated shell from one source.
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
    for (const cssVar of ALL_CSS_VARIABLES) {
      root.style.removeProperty(cssVar);
    }

    const theme = tenantContext?.resolved ? tenantContext.theme : null;
    if (!theme) return;

    for (const [themeKey, cssVar] of Object.entries(CSS_VARIABLE_BY_THEME_KEY)) {
      const value = theme[themeKey as keyof typeof CSS_VARIABLE_BY_THEME_KEY];
      if (value) root.style.setProperty(cssVar, value);
    }
  }, [tenantContext, onInvitePage]);

  return null;
}
