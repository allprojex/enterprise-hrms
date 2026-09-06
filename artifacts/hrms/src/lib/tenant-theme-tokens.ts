/**
 * Tenant branding → design tokens (WS-25A).
 *
 * Tenant branding sits ON TOP of the enterprise design system. An
 * organization's stored `branding.theme` (nine optional HSL triples, written
 * through PATCH /organizations/:id/config/branding and served by
 * GET /tenant-context and GET /invitations/:token) may recolour the brand
 * tokens listed in TENANT_BRAND_TOKENS — and nothing else. From those the
 * platform derives the companion tokens (hover, soft tint, focus, sidebar
 * states) so that every surface that uses the brand colour stays coherent,
 * and it clamps any foreground that would be unreadable on its background.
 *
 * Guarantees (tested in src/test/tenant-theme.test.tsx):
 *   - Only the nine accepted keys are read; unknown keys are ignored.
 *   - A value that is not an HSL triple is ignored, never written to the DOM.
 *   - A supplied foreground that fails WCAG AA (4.5:1) against its background
 *     is replaced by a readable one; a missing foreground is derived.
 *   - Semantic status colours, text, borders, surfaces, spacing, radius and
 *     type are never touched.
 *   - Clearing removes every brand and derived token, so one organization's
 *     colours can never persist onto another's render.
 */
import {
  contrastRatio,
  formatHslTriple,
  hoverVariant,
  parseHslTriple,
  readableForeground,
  softForeground,
  softVariant,
  AA_TEXT_CONTRAST,
  type Hsl,
} from '@/lib/color';
import { TENANT_BRAND_TOKENS, TENANT_DERIVED_TOKENS } from '@/lib/design-tokens';

/** The nine theme keys the backend branding schema accepts today. */
export const CSS_VARIABLE_BY_THEME_KEY = {
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

export type TenantThemeKey = keyof typeof CSS_VARIABLE_BY_THEME_KEY;
export type TenantThemeInput = Partial<Record<TenantThemeKey, string | null | undefined>>;

/** Every custom property the tenant pipeline may write — and must clear. */
export const ALL_TENANT_CSS_VARIABLES: readonly string[] = [
  ...TENANT_BRAND_TOKENS,
  ...TENANT_DERIVED_TOKENS,
];

/**
 * Resolves a tenant theme into the exact custom-property writes to apply.
 * Pure: takes the stored theme object, returns `{ '--primary': '222 47% 31%', … }`.
 */
export function resolveTenantTheme(
  theme: TenantThemeInput | null | undefined,
  options: { dark?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!theme || typeof theme !== 'object') return out;
  const dark = options.dark === true;

  const parsed: Partial<Record<TenantThemeKey, Hsl>> = {};
  for (const key of Object.keys(CSS_VARIABLE_BY_THEME_KEY) as TenantThemeKey[]) {
    const hsl = parseHslTriple(theme[key]);
    if (hsl) parsed[key] = hsl;
  }

  const pair = (bgKey: TenantThemeKey, fgKey: TenantThemeKey): { bg: Hsl; fg: Hsl } | null => {
    const bg = parsed[bgKey];
    if (!bg) return null;
    const supplied = parsed[fgKey];
    const fg =
      supplied && contrastRatio(supplied, bg) >= AA_TEXT_CONTRAST ? supplied : readableForeground(bg);
    return { bg, fg };
  };

  const primary = pair('primary', 'primaryForeground');
  if (primary) {
    out['--primary'] = formatHslTriple(primary.bg);
    out['--primary-foreground'] = formatHslTriple(primary.fg);
    out['--primary-hover'] = formatHslTriple(hoverVariant(primary.bg));
    out['--primary-soft'] = formatHslTriple(softVariant(primary.bg, dark));
    out['--primary-soft-foreground'] = formatHslTriple(softForeground(primary.bg, dark));
    out['--focus'] = formatHslTriple(parsed.ring ?? primary.bg);
    out['--sidebar-primary'] = out['--primary'];
    out['--sidebar-primary-foreground'] = out['--primary-foreground'];
    out['--sidebar-active'] = out['--primary-soft'];
    out['--sidebar-active-foreground'] = out['--primary-soft-foreground'];
  } else if (parsed.primaryForeground) {
    // A foreground without its background cannot be validated; ignore it.
  }

  const accent = pair('accent', 'accentForeground');
  if (accent) {
    out['--accent'] = formatHslTriple(accent.bg);
    out['--accent-foreground'] = formatHslTriple(accent.fg);
    out['--accent-soft'] = formatHslTriple(softVariant(accent.bg, dark));
    out['--accent-soft-foreground'] = formatHslTriple(softForeground(accent.bg, dark));
  }

  const sidebar = pair('sidebar', 'sidebarForeground');
  if (sidebar) {
    out['--sidebar'] = formatHslTriple(sidebar.bg);
    out['--sidebar-foreground'] = formatHslTriple(sidebar.fg);
    out['--sidebar-hover'] = formatHslTriple(hoverVariant(sidebar.bg));
    // On a tinted/brand sidebar the active item must read against the
    // sidebar, not against the page: use a hover-step tint with the sidebar's
    // own readable foreground rather than the page-level primary-soft pair.
    const active = { ...sidebar.bg, l: sidebar.bg.l > 50 ? Math.max(sidebar.bg.l - 8, 0) : Math.min(sidebar.bg.l + 12, 100) };
    out['--sidebar-active'] = formatHslTriple(active);
    out['--sidebar-active-foreground'] = formatHslTriple(
      contrastRatio(sidebar.fg, active) >= AA_TEXT_CONTRAST ? sidebar.fg : readableForeground(active),
    );
  }

  const sidebarAccent = pair('sidebarAccent', 'sidebarAccentForeground');
  if (sidebarAccent) {
    out['--sidebar-accent'] = formatHslTriple(sidebarAccent.bg);
    out['--sidebar-accent-foreground'] = formatHslTriple(sidebarAccent.fg);
  }

  if (parsed.ring) {
    out['--ring'] = formatHslTriple(parsed.ring);
    out['--focus'] = out['--ring'];
  }

  return out;
}

/** Removes every tenant-writable and derived property from `root`. */
export function clearTenantTheme(root: HTMLElement): void {
  for (const cssVar of ALL_TENANT_CSS_VARIABLES) root.style.removeProperty(cssVar);
}

/**
 * Clears, then applies. Returns the list of properties written so a scoped
 * caller (the invitation page) can remove exactly those on unmount.
 */
export function applyTenantTheme(
  root: HTMLElement,
  theme: TenantThemeInput | null | undefined,
  options: { dark?: boolean } = {},
): string[] {
  clearTenantTheme(root);
  const resolved = resolveTenantTheme(theme, options);
  for (const [cssVar, value] of Object.entries(resolved)) root.style.setProperty(cssVar, value);
  return Object.keys(resolved);
}
