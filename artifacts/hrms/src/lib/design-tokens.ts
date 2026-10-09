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

/**
 * The three typography tiers (UI-01B). `tablet` is a deliberate middle step,
 * not an inheritance of either neighbour, and it is the tier 768px portrait
 * resolves to. `desktop` starts at 1024 — the same width the shell switches
 * from drawer to sidebar — so density and layout change together.
 */
export const TYPE_TIERS = { phone: 0, tablet: 640, desktop: 1024 } as const;
export type TypeTier = keyof typeof TYPE_TIERS;

/**
 * Responsive semantic type scale (px). Every entry is [fontSize, lineHeight]
 * and maps 1:1 onto the `--type-<name>` / `--type-<name>-lh` custom properties
 * in index.css, which the `text-*` utilities read. The desktop column is
 * byte-identical to the pre-UI-01B fixed scale.
 *
 * Nothing here may drop below TYPE_MIN_PX at any tier (UI-01A's floor).
 */
export const TYPE_SCALE = {
  display: { phone: [24, 30], tablet: [26, 32], desktop: [28, 34] },
  title: { phone: [20, 26], tablet: [21, 27], desktop: [22, 28] },
  heading: { phone: [18, 24], tablet: [18, 24], desktop: [18, 24] },
  section: { phone: [17, 24], tablet: [17, 24], desktop: [17, 24] },
  'card-title': { phone: [16, 22], tablet: [16, 22], desktop: [15, 22] },
  body: { phone: [16, 24], tablet: [15, 22], desktop: [14, 20] },
  'body-sm': { phone: [15, 22], tablet: [14, 20], desktop: [13, 18] },
  label: { phone: [15, 20], tablet: [14, 19], desktop: [13, 18] },
  helper: { phone: [14, 20], tablet: [13, 18], desktop: [12, 16] },
  meta: { phone: [13, 18], tablet: [12, 16], desktop: [12, 16] },
  kpi: { phone: [24, 28], tablet: [26, 30], desktop: [28, 32] },
  'kpi-sm': { phone: [18, 22], tablet: [19, 23], desktop: [20, 24] },
  button: { phone: [15, 20], tablet: [14, 20], desktop: [14, 20] },
  table: { phone: [14, 20], tablet: [13, 20], desktop: [13, 20] },
  'table-head': { phone: [12, 16], tablet: [12, 16], desktop: [12, 16] },
  overline: { phone: [12, 16], tablet: [12, 16], desktop: [12, 16] },
} as const satisfies Record<string, Record<TypeTier, readonly [number, number]>>;

/** Readability floor established by UI-01A; holds at every tier. */
export const TYPE_MIN_PX = 12;

/**
 * Control heights (px) for inputs, selects and buttons. Two tiers, not three:
 * below 1024 the control is pressed with a finger, so the default reaches the
 * 44px TOUCH_TARGET standard; at 1024+ the original enterprise density returns.
 */
export const CONTROL_HEIGHT = {
  touch: { sm: 40, md: 44, lg: 48 },
  desktop: { sm: 32, md: 36, lg: 40 },
} as const;

/** Minimum touch target below the `lg` breakpoint (px). */
export const TOUCH_TARGET = 44;

/**
 * Interactive area the 16px controls (checkbox, radio, switch) expand to via
 * the `touch-target` utility, without changing what is painted. Deliberately
 * below TOUCH_TARGET: those controls sit in layouts that stack them with 16px
 * gaps, so a 44px area would overlap its neighbour.
 *
 * UI-01B raised the *control* heights (button/input/select) to 44 on touch
 * tiers but left this at 32: closing the remaining 12px needs row-spacing
 * changes in the surrounding layouts, which is UI-02's scope, not a typography
 * change. Recorded rather than silently widened.
 */
export const TOUCH_TARGET_MIN = 32;

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
