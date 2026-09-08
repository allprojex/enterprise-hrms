/**
 * Design foundation constants (WS-25A).
 *
 * The stylesheet (src/index.css) is the source of truth for every visual
 * value; this module mirrors the *names* and the handful of numbers that
 * TypeScript needs at runtime (breakpoint checks, icon sizes, the list of
 * tokens a tenant may write to) so that nothing is duplicated as a magic
 * number in components. src/test/design-tokens.test.ts asserts the two stay
 * in step.
 */

/** Tailwind default breakpoints — the responsive foundation uses these unchanged. */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/** Widths every base component is expected to work at. */
export const AUDIT_WIDTHS = [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1180, 1280, 1440] as const;

/** Control heights (px). Inputs, selects and buttons share these. */
export const CONTROL_HEIGHT = { sm: 32, md: 36, lg: 40 } as const;

/** Minimum touch target below the `lg` breakpoint (px). */
export const TOUCH_TARGET = 44;

/** Content widths (px). */
export const CONTENT_WIDTH = { max: 1440, narrow: 720, form: 960 } as const;

/** Shell dimensions (px). */
export const SHELL = { sidebar: 264, sidebarRail: 56, header: 56 } as const;

/** Layering — matches the `--z-*` custom properties. */
export const Z_INDEX = {
  base: 0,
  raised: 10,
  sticky: 20,
  sidebar: 30,
  header: 30,
  overlay: 40,
  modal: 50,
  popover: 60,
  toast: 100,
} as const;

/** Motion durations (ms) — matches `--dur-*`. */
export const DURATION = { fast: 120, base: 180, slow: 240 } as const;

/** Icon sizes (px). One family (lucide), stroke 2 everywhere; sizes by role. */
export const ICON_SIZE = {
  /** inline with body/label text, table cells, badges */
  status: 14,
  /** inside buttons and inputs */
  control: 16,
  /** navigation items, menu items */
  nav: 18,
  /** page-header / empty-state emphasis */
  feature: 24,
} as const;

/** Tailwind classes for the icon sizes above (keeps size + stroke consistent). */
export const ICON_CLASS = {
  status: 'size-3.5 shrink-0',
  control: 'size-4 shrink-0',
  nav: 'size-[18px] shrink-0',
  feature: 'size-6 shrink-0',
} as const;

/**
 * The type-scale utilities the stylesheet defines with `@utility text-*`
 * (font-size / line-height / weight — never a colour, except the three
 * semantic captions text-meta, text-table-head and text-overline). Listed
 * here because `cn()` must teach tailwind-merge that these are FONT-SIZE
 * utilities: without that, tailwind-merge classifies any unknown `text-*`
 * class as a text COLOUR, so `cn('text-button text-primary-foreground
 * text-body-sm')` kept only the last one — a small primary button lost its
 * foreground colour (dark label on the brand background) and every
 * `text-body-sm text-muted-foreground` pairing silently lost its size.
 * src/test/design-tokens.test.ts asserts this list matches the stylesheet.
 */
export const TYPE_SCALE_UTILITIES = [
  'text-display',
  'text-title',
  'text-heading',
  'text-section',
  'text-card-title',
  'text-body',
  'text-body-sm',
  'text-label',
  'text-helper',
  'text-meta',
  'text-kpi',
  'text-kpi-sm',
  'text-button',
  'text-table',
  'text-table-head',
  'text-overline',
] as const;

/**
 * Brand tokens a tenant is allowed to write (the nine keys the backend's
 * branding theme schema accepts today). Everything else in the stylesheet is
 * platform-owned.
 */
export const TENANT_BRAND_TOKENS = [
  '--primary',
  '--primary-foreground',
  '--accent',
  '--accent-foreground',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--ring',
] as const;

/**
 * Tokens the platform derives from a tenant's brand colours. They are written
 * alongside the brand tokens and cleared with them, never set by the tenant.
 */
export const TENANT_DERIVED_TOKENS = [
  '--primary-hover',
  '--primary-soft',
  '--primary-soft-foreground',
  '--accent-soft',
  '--accent-soft-foreground',
  '--focus',
  '--sidebar-hover',
  '--sidebar-active',
  '--sidebar-active-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
] as const;

/** Semantic tokens that must never change per tenant. */
export const PLATFORM_OWNED_TOKENS = [
  '--background',
  '--foreground',
  '--foreground-muted',
  '--foreground-subtle',
  '--surface',
  '--surface-elevated',
  '--surface-muted',
  '--surface-sunken',
  '--surface-hover',
  '--border',
  '--border-strong',
  '--input',
  '--success',
  '--success-foreground',
  '--success-soft',
  '--success-soft-foreground',
  '--warning',
  '--warning-foreground',
  '--warning-soft',
  '--warning-soft-foreground',
  '--danger',
  '--danger-foreground',
  '--danger-soft',
  '--danger-soft-foreground',
  '--info',
  '--info-foreground',
  '--info-soft',
  '--info-soft-foreground',
  '--disabled-surface',
  '--disabled-foreground',
  '--overlay',
] as const;

/** Every colour token the stylesheet must define in both `:root` and `.dark`. */
export const REQUIRED_COLOR_TOKENS = [
  ...PLATFORM_OWNED_TOKENS,
  ...TENANT_BRAND_TOKENS,
  ...TENANT_DERIVED_TOKENS,
  '--secondary',
  '--secondary-foreground',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar-border',
  '--sidebar-ring',
] as const;
