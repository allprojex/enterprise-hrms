/**
 * Colour math for the design foundation (WS-25A).
 *
 * The stylesheet's colour contract is an HSL triple string — `"222 47% 31%"` —
 * consumed as `hsl(var(--token))`. Tenant branding writes the same shape
 * (organization_settings.branding.theme). These helpers parse that contract,
 * measure WCAG contrast, and derive the companion tokens (hover, soft,
 * readable foreground) the foundation needs from a single tenant colour.
 *
 * Pure functions, no DOM, no dependencies — unit-tested in
 * src/test/color.test.ts and used by the token contrast test.
 */

export interface Hsl {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

export interface Rgb {
  r: number; // 0–255
  g: number;
  b: number;
}

/** WCAG 2.1 AA minimum contrast for normal text. */
export const AA_TEXT_CONTRAST = 4.5;
/** WCAG 2.1 AA minimum contrast for large text (≥ 18.66px bold / 24px) and UI components. */
export const AA_LARGE_CONTRAST = 3;

const HSL_TRIPLE = /^\s*(-?\d+(?:\.\d+)?)(?:deg)?\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/;

/**
 * Parses the stylesheet contract (`"h s% l%"`). Returns null for anything
 * else — a hex colour, an `hsl()` function, an empty string — so callers can
 * refuse malformed tenant input instead of writing it into the document.
 */
export function parseHslTriple(value: string | null | undefined): Hsl | null {
  if (typeof value !== 'string') return null;
  const m = HSL_TRIPLE.exec(value);
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = clamp(Number(m[2]), 0, 100);
  const l = clamp(Number(m[3]), 0, 100);
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;
  return { h, s, l };
}

export function formatHslTriple({ h, s, l }: Hsl): string {
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = light - c / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Relative luminance per WCAG 2.1 (sRGB). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two colours (1–21). */
export function contrastRatio(a: Hsl, b: Hsl): number {
  const la = relativeLuminance(hslToRgb(a));
  const lb = relativeLuminance(hslToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsAaText(fg: Hsl, bg: Hsl): boolean {
  return contrastRatio(fg, bg) >= AA_TEXT_CONTRAST;
}

const WHITE: Hsl = { h: 0, s: 0, l: 100 };
const NEAR_BLACK: Hsl = { h: 222, s: 30, l: 12 };

/**
 * The readable text colour for a given background: white when it clears AA,
 * otherwise the foundation's near-black. Used when a tenant supplies a brand
 * colour without a foreground, or supplies a foreground that fails AA.
 */
export function readableForeground(bg: Hsl): Hsl {
  return contrastRatio(WHITE, bg) >= AA_TEXT_CONTRAST ? WHITE : NEAR_BLACK;
}

/** Slightly darker (light backgrounds) or lighter (dark backgrounds) for hover. */
export function hoverVariant(base: Hsl): Hsl {
  const delta = base.l > 50 ? 6 : -6;
  return { ...base, l: clamp(base.l + delta, 0, 100) };
}

/**
 * A soft tint of the base hue for backgrounds (selected rows, badges,
 * highlighted cards). Lightness is pinned near white so any brand hue reads as
 * a tint rather than a colour block; saturation is capped so vivid tenant
 * colours do not produce neon tints.
 */
export function softVariant(base: Hsl, dark = false): Hsl {
  return {
    h: base.h,
    s: clamp(Math.min(base.s, 70), 20, 70),
    l: dark ? 18 : 95,
  };
}

/** Text that reads on top of `softVariant(base)`: the brand hue, darkened. */
export function softForeground(base: Hsl, dark = false): Hsl {
  return {
    h: base.h,
    s: clamp(Math.max(base.s, 35), 35, 80),
    l: dark ? 82 : 26,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
