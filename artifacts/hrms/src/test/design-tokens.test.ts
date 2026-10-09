/**
 * Token contract test (WS-25A).
 *
 * Parses src/index.css and asserts the design foundation's guarantees:
 * every required colour token is defined in both themes as an HSL triple,
 * text/background pairs meet WCAG AA, shadows are neutral, fonts are
 * self-hosted, and reduced motion is honoured. Runs on the source file so a
 * regression is caught before any component test needs to notice it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHslTriple, AA_TEXT_CONTRAST, AA_LARGE_CONTRAST, type Hsl } from '@/lib/color';
import { REQUIRED_COLOR_TOKENS, TENANT_BRAND_TOKENS, TENANT_DERIVED_TOKENS, PLATFORM_OWNED_TOKENS, TYPE_SCALE_UTILITIES, Z_INDEX, DURATION, SHELL, CONTROL_HEIGHT, CONTENT_WIDTH, TOUCH_TARGET_MIN } from '@/lib/design-tokens';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block`);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated ${selector} block`);
}

/** Reads `--name: value;` declarations from a block into a map (last wins). */
function declarations(blockCss: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockCss))) out.set(m[1], m[2].trim());
  return out;
}

/** Resolves `var(--x)` aliases within a theme to a concrete HSL triple. */
function resolveHsl(vars: Map<string, string>, name: string, depth = 0): Hsl {
  const raw = vars.get(name);
  if (raw === undefined) throw new Error(`${name} is not defined`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  if (alias) {
    if (depth > 5) throw new Error(`${name} alias chain too deep`);
    return resolveHsl(vars, alias[1], depth + 1);
  }
  const hsl = parseHslTriple(raw);
  if (!hsl) throw new Error(`${name} is not an HSL triple: ${raw}`);
  return hsl;
}

const light = declarations(block(':root'));
const dark = declarations(block('.dark'));

/** [foreground, background, minimum] pairs that must hold in both themes. */
const TEXT_PAIRS: Array<[string, string, number]> = [
  ['--foreground', '--background', AA_TEXT_CONTRAST],
  ['--foreground', '--surface', AA_TEXT_CONTRAST],
  ['--foreground', '--surface-muted', AA_TEXT_CONTRAST],
  ['--foreground', '--surface-sunken', AA_TEXT_CONTRAST],
  ['--foreground-muted', '--background', AA_TEXT_CONTRAST],
  ['--foreground-muted', '--surface', AA_TEXT_CONTRAST],
  ['--foreground-muted', '--surface-muted', AA_TEXT_CONTRAST],
  ['--foreground-subtle', '--surface', AA_TEXT_CONTRAST],
  ['--primary-foreground', '--primary', AA_TEXT_CONTRAST],
  // Primary button hover/active state keeps the same foreground.
  ['--primary-foreground', '--primary-hover', AA_TEXT_CONTRAST],
  ['--primary-soft-foreground', '--primary-soft', AA_TEXT_CONTRAST],
  ['--accent-foreground', '--accent', AA_TEXT_CONTRAST],
  ['--accent-soft-foreground', '--accent-soft', AA_TEXT_CONTRAST],
  ['--secondary-foreground', '--secondary', AA_TEXT_CONTRAST],
  ['--success-foreground', '--success', AA_TEXT_CONTRAST],
  ['--success-soft-foreground', '--success-soft', AA_TEXT_CONTRAST],
  ['--warning-foreground', '--warning', AA_TEXT_CONTRAST],
  ['--warning-soft-foreground', '--warning-soft', AA_TEXT_CONTRAST],
  ['--danger-foreground', '--danger', AA_TEXT_CONTRAST],
  ['--danger-soft-foreground', '--danger-soft', AA_TEXT_CONTRAST],
  ['--info-foreground', '--info', AA_TEXT_CONTRAST],
  ['--info-soft-foreground', '--info-soft', AA_TEXT_CONTRAST],
  ['--sidebar-foreground', '--sidebar', AA_TEXT_CONTRAST],
  ['--sidebar-active-foreground', '--sidebar-active', AA_TEXT_CONTRAST],
  ['--sidebar-foreground', '--sidebar-hover', AA_TEXT_CONTRAST],
  ['--disabled-foreground', '--disabled-surface', AA_LARGE_CONTRAST],
  // UI component contrast (3:1): borders and focus against their ground
  ['--border-strong', '--surface', AA_LARGE_CONTRAST],
  ['--focus', '--surface', AA_LARGE_CONTRAST],
  ['--primary', '--surface', AA_LARGE_CONTRAST],
  ['--success', '--surface', AA_LARGE_CONTRAST],
  ['--warning', '--surface', AA_LARGE_CONTRAST],
  ['--danger', '--surface', AA_LARGE_CONTRAST],
  ['--info', '--surface', AA_LARGE_CONTRAST],
];

describe('design tokens: definition', () => {
  it.each([['light', light], ['dark', dark]] as const)('%s theme defines every required colour token as an HSL triple', (_name, vars) => {
    const missing = REQUIRED_COLOR_TOKENS.filter((t) => !vars.has(t));
    expect(missing).toEqual([]);
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(() => resolveHsl(vars, token)).not.toThrow();
    }
  });

  it('keeps the shadcn compatibility aliases resolving', () => {
    for (const vars of [light, dark]) {
      for (const alias of ['--card', '--card-foreground', '--popover', '--popover-foreground', '--muted', '--muted-foreground', '--destructive', '--destructive-foreground', '--ring']) {
        expect(() => resolveHsl(vars, alias)).not.toThrow();
      }
    }
  });

  it('separates tenant-writable, derived and platform-owned tokens with no overlap', () => {
    const brand = new Set<string>(TENANT_BRAND_TOKENS);
    const derived = new Set<string>(TENANT_DERIVED_TOKENS);
    for (const t of PLATFORM_OWNED_TOKENS) {
      expect(brand.has(t)).toBe(false);
      expect(derived.has(t)).toBe(false);
    }
    for (const t of TENANT_BRAND_TOKENS) expect(derived.has(t)).toBe(false);
    // semantic status colours are platform-owned
    for (const t of ['--success', '--warning', '--danger', '--info']) expect(PLATFORM_OWNED_TOKENS).toContain(t);
  });

  it('exposes every semantic token through the Tailwind theme bridge', () => {
    const theme = block('@theme inline');
    for (const name of ['surface', 'surface-elevated', 'surface-muted', 'surface-sunken', 'surface-hover', 'border-strong', 'foreground-muted', 'foreground-subtle', 'primary-hover', 'primary-soft', 'accent-soft', 'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'info', 'info-soft', 'focus', 'disabled', 'disabled-foreground', 'overlay', 'sidebar-hover', 'sidebar-active']) {
      expect(theme).toContain(`--color-${name}:`);
    }
  });
});

describe('design tokens: contrast (WCAG AA)', () => {
  it.each([['light', light], ['dark', dark]] as const)('%s theme text pairs meet their minimum', (_name, vars) => {
    const failures: string[] = [];
    for (const [fg, bg, min] of TEXT_PAIRS) {
      const ratio = contrastRatio(resolveHsl(vars, fg), resolveHsl(vars, bg));
      if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('design tokens: shape, depth, layout, motion', () => {
  it('uses neutral shadows (no coloured tint) in both themes', () => {
    for (const vars of [light, dark]) {
      for (const name of ['--shadow-xs-value', '--shadow-sm-value', '--shadow-md-value', '--shadow-lg-value']) {
        const v = vars.get(name)!;
        expect(v).toBeDefined();
        const tints = [...v.matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) => m.slice(1, 4).map(Number));
        expect(tints.length).toBeGreaterThan(0);
        for (const [r, g, b] of tints) {
          // slate / black only: red never dominates
          expect(r).toBeLessThanOrEqual(Math.max(g, b));
        }
      }
    }
  });

  it('pins radius, control heights, shell and content widths to the TypeScript constants', () => {
    expect(light.get('--radius')).toBe('6px');
    expect(light.get('--radius-sm-value')).toBe('4px');
    expect(light.get('--radius-lg-value')).toBe('8px');
    expect(light.get('--radius-xl-value')).toBe('12px');
    // :root carries the TOUCH tier; the desktop tier lives in the 1024 block
    // and is asserted by the responsive suite below.
    expect(light.get('--control-height-sm')).toBe(`${CONTROL_HEIGHT.touch.sm / 16}rem`);
    expect(light.get('--control-height')).toBe(`${CONTROL_HEIGHT.touch.md / 16}rem`);
    expect(light.get('--control-height-lg')).toBe(`${CONTROL_HEIGHT.touch.lg / 16}rem`);
    expect(light.get('--sidebar-width')).toBe(`${SHELL.sidebar}px`);
    expect(light.get('--sidebar-width-rail')).toBe(`${SHELL.sidebarRail}px`);
    expect(light.get('--header-height')).toBe(`${SHELL.header}px`);
    expect(light.get('--content-max-width')).toBe(`${CONTENT_WIDTH.max}px`);
    expect(light.get('--content-narrow-width')).toBe(`${CONTENT_WIDTH.narrow}px`);
    expect(light.get('--content-form-width')).toBe(`${CONTENT_WIDTH.form}px`);
    expect(light.get('--touch-target')).toBe('44px');
    expect(light.get('--touch-target-min')).toBe(`${TOUCH_TARGET_MIN / 16}rem`);
  });

  it('lets the user pinch-zoom: the viewport pins no maximum scale (WCAG 1.4.4)', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/maximum-scale/);
    expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
    expect(viewport).not.toMatch(/minimum-scale/);
  });

  it('expands small controls to the minimum interactive area without repainting them (UI-01A)', () => {
    const utility = css.match(/@utility touch-target \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(utility).toBeTruthy();
    expect(utility).toMatch(/position:\s*relative/);
    expect(utility).toMatch(/touch-action:\s*manipulation/);
    // The hit area is a pseudo-element, so the painted control keeps its size.
    expect(utility).toMatch(/&::before/);
    expect(utility).toMatch(/width:\s*max\(100%,\s*var\(--touch-target-min\)\)/);
    expect(utility).toMatch(/height:\s*max\(100%,\s*var\(--touch-target-min\)\)/);
  });

  it('pins z-index layers and motion durations to the TypeScript constants', () => {
    for (const [name, value] of Object.entries(Z_INDEX)) expect(light.get(`--z-${name}`)).toBe(String(value));
    for (const [name, value] of Object.entries(DURATION)) expect(light.get(`--dur-${name}`)).toBe(`${value}ms`);
    expect(light.get('--ease-standard')).toMatch(/^cubic-bezier\(/);
    expect(light.get('--ease-exit')).toMatch(/^cubic-bezier\(/);
  });

  it('defines the motion primitives and the type scale as utilities', () => {
    for (const u of ['motion-interactive', 'motion-menu', 'motion-dialog', 'motion-sheet', 'motion-toast', 'motion-exit', 'motion-collapse', 'motion-indicator', 'duration-fast', 'duration-base', 'duration-slow']) {
      expect(css).toContain(`@utility ${u} `);
    }
    for (const u of TYPE_SCALE_UTILITIES) {
      expect(css).toContain(`@utility ${u} `);
    }
  });

  it('lists every stylesheet type-scale utility in TYPE_SCALE_UTILITIES (cn() relies on the list being complete)', () => {
    const inCss = [...css.matchAll(/@utility (text-[a-z-]+) \{/g)].map((m) => m[1]).sort();
    expect(inCss).toEqual([...TYPE_SCALE_UTILITIES].sort());
  });

  it('drives every type-scale utility from the responsive custom properties, never a literal (UI-01B)', () => {
    // This is the guard that stops UI-01C's page migration silently pinning a
    // utility back to a fixed size: if a literal reappears here, the whole
    // responsive scale stops moving for that token and this fails.
    for (const u of TYPE_SCALE_UTILITIES) {
      const block = css.match(new RegExp(`@utility ${u} \\{[^}]*\\}`))?.[0] ?? '';
      expect(block, `${u} block missing`).toBeTruthy();
      const name = u.replace(/^text-/, '');
      expect(block, `${u} must read var(--type-${name})`).toMatch(
        new RegExp(`font-size:\\s*var\\(--type-${name}\\)`),
      );
      expect(block, `${u} must read var(--type-${name}-lh)`).toMatch(
        new RegExp(`line-height:\\s*var\\(--type-${name}-lh\\)`),
      );
      expect(block, `${u} must not hard-code a font-size`).not.toMatch(/font-size:\s*[\d.]+r?e?m/);
    }
  });
});

describe('design tokens: typography and fonts', () => {
  it('uses one self-hosted family and no remote font or style origin', () => {
    expect(light.get('--app-font-sans')).toMatch(/^'Inter Variable'/);
    expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|@import url\(/);
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(css).not.toMatch(/Fraunces|DM Sans/);
    // no serif heading override remains
    expect(css).not.toMatch(/--app-font-serif/);
  });

  it('gives headings a confident, non-serif weight', () => {
    const base = block('@layer base');
    expect(base).toMatch(/h1, h2, h3, h4, h5, h6 \{[^}]*font-family: var\(--app-font-sans\)/);
    expect(base).toMatch(/h1, h2, h3, h4, h5, h6 \{[^}]*font-weight: 600/);
  });
});

describe('design tokens: accessibility and motion', () => {
  it('collapses animation and transitions under prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation-duration: 0\.01ms !important;[\s\S]*transition-duration: 0\.01ms !important;/);
  });

  it('defines one global visible focus treatment', () => {
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid hsl\(var\(--focus\)\);\s*outline-offset: 2px;/);
  });

  it('removed the pseudo-element elevate hover system', () => {
    expect(css).not.toMatch(/hover-elevate|toggle-elevate|--elevate-/);
  });
});
