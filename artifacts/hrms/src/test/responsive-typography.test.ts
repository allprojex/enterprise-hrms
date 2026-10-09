/**
 * UI-01B — responsive typography contract.
 *
 * The scale lives in CSS custom properties that three `:root` blocks redefine
 * per breakpoint, and every `text-*` utility reads those properties. These
 * tests pin the resolved value of each token at each tier against TYPE_SCALE
 * in design-tokens.ts, so:
 *
 *   - a page migration (UI-01C) cannot quietly flatten the scale,
 *   - desktop density cannot drift away from what shipped before UI-01B,
 *   - and nothing can slip back under the 12px floor UI-01A established.
 *
 * Parsed from the stylesheet source rather than a rendered page: jsdom does
 * not evaluate media queries, so source is the only honest oracle here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TYPE_SCALE,
  TYPE_TIERS,
  TYPE_MIN_PX,
  CONTROL_HEIGHT,
  TYPE_SCALE_UTILITIES,
  type TypeTier,
} from '@/lib/design-tokens';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** The slice that owns the responsive scale, so stray `:root` blocks elsewhere in the sheet cannot confuse the parse. */
const slice = (() => {
  const start = css.indexOf('/* RESPONSIVE TYPE SCALE (UI-01B)');
  const end = css.indexOf('/* TYPE SCALE — enterprise hierarchy', start);
  expect(start, 'responsive type scale block not found').toBeGreaterThan(-1);
  expect(end, 'type scale utilities block not found').toBeGreaterThan(start);
  return css.slice(start, end);
})();

const rootBlocks = [...slice.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const tierOrder: TypeTier[] = ['phone', 'tablet', 'desktop'];
const declaredPerTier = rootBlocks.map(declarations);

/** Cascade: a tier inherits any property it does not redefine. */
function resolved(tier: TypeTier): Map<string, string> {
  const upTo = tierOrder.indexOf(tier);
  const out = new Map<string, string>();
  for (let i = 0; i <= upTo; i += 1) for (const [k, v] of declaredPerTier[i]) out.set(k, v);
  return out;
}

const remToPx = (v: string): number => {
  const m = v.match(/^([\d.]+)rem$/);
  expect(m, `expected a rem value, got "${v}"`).toBeTruthy();
  return Number(m![1]) * 16;
};

describe('UI-01B: the responsive scale is wired correctly', () => {
  it('declares exactly three tiers, gated at the documented breakpoints', () => {
    expect(rootBlocks).toHaveLength(3);
    expect(slice).toMatch(new RegExp(`@media \\(min-width:\\s*${TYPE_TIERS.tablet}px\\)`));
    expect(slice).toMatch(new RegExp(`@media \\(min-width:\\s*${TYPE_TIERS.desktop}px\\)`));
  });

  it('defines every type-scale utility in the base (phone) tier', () => {
    const phone = declaredPerTier[0];
    for (const u of TYPE_SCALE_UTILITIES) {
      const name = u.replace(/^text-/, '');
      expect(phone.has(`--type-${name}`), `--type-${name} missing from base tier`).toBe(true);
      expect(phone.has(`--type-${name}-lh`), `--type-${name}-lh missing from base tier`).toBe(true);
    }
  });

  it('covers every utility in TYPE_SCALE', () => {
    const named = TYPE_SCALE_UTILITIES.map((u) => u.replace(/^text-/, '')).sort();
    expect(Object.keys(TYPE_SCALE).sort()).toEqual(named);
  });
});

describe.each(tierOrder)('UI-01B: %s tier', (tier) => {
  const values = resolved(tier);

  it('matches TYPE_SCALE for every token', () => {
    for (const [name, byTier] of Object.entries(TYPE_SCALE)) {
      const [size, lineHeight] = byTier[tier];
      expect(remToPx(values.get(`--type-${name}`)!), `${name} font-size @ ${tier}`).toBe(size);
      expect(remToPx(values.get(`--type-${name}-lh`)!), `${name} line-height @ ${tier}`).toBe(lineHeight);
    }
  });

  it(`never drops below the ${TYPE_MIN_PX}px floor`, () => {
    for (const [name, byTier] of Object.entries(TYPE_SCALE)) {
      expect(byTier[tier][0], `${name} @ ${tier}`).toBeGreaterThanOrEqual(TYPE_MIN_PX);
    }
  });

  it('keeps line-height at or above the font size', () => {
    for (const [name, byTier] of Object.entries(TYPE_SCALE)) {
      const [size, lineHeight] = byTier[tier];
      expect(lineHeight, `${name} @ ${tier}`).toBeGreaterThanOrEqual(size);
    }
  });

  it('preserves the hierarchy: display >= title >= heading >= section >= card-title >= body >= body-sm >= helper >= table-head', () => {
    const chain = ['display', 'title', 'heading', 'section', 'card-title', 'body', 'body-sm', 'helper', 'table-head'] as const;
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = TYPE_SCALE[chain[i]][tier][0];
      const b = TYPE_SCALE[chain[i + 1]][tier][0];
      expect(a, `${chain[i]} (${a}) must be >= ${chain[i + 1]} (${b}) @ ${tier}`).toBeGreaterThanOrEqual(b);
    }
  });
});

describe('UI-01B: the point of the change', () => {
  it('reads larger on a phone than on a desktop for every running-text token', () => {
    for (const name of ['body', 'body-sm', 'label', 'helper', 'table', 'button'] as const) {
      const phone = TYPE_SCALE[name].phone[0];
      const desktop = TYPE_SCALE[name].desktop[0];
      expect(phone, `${name}: phone ${phone} must exceed desktop ${desktop}`).toBeGreaterThan(desktop);
    }
  });

  it('puts body text at 16px on phones, which also stops iOS zooming on input focus', () => {
    expect(TYPE_SCALE.body.phone[0]).toBe(16);
  });

  it('gives tablet its own step rather than copying a neighbour', () => {
    const distinct = (['body', 'body-sm', 'helper'] as const).filter(
      (n) => TYPE_SCALE[n].tablet[0] !== TYPE_SCALE[n].phone[0] && TYPE_SCALE[n].tablet[0] !== TYPE_SCALE[n].desktop[0],
    );
    expect(distinct.length, 'tablet must differ from both neighbours for the core running-text tokens').toBeGreaterThanOrEqual(3);
  });

  it('leaves desktop density exactly as it shipped before UI-01B', () => {
    // The pre-UI-01B fixed scale, transcribed from cfa525f. If a desktop value
    // changes, that is a density regression on the primary platform.
    const before: Record<string, [number, number]> = {
      display: [28, 34], title: [22, 28], heading: [18, 24], section: [17, 24],
      'card-title': [15, 22], body: [14, 20], 'body-sm': [13, 18], label: [13, 18],
      helper: [12, 16], meta: [12, 16], kpi: [28, 32], 'kpi-sm': [20, 24],
      button: [14, 20], table: [13, 20], 'table-head': [12, 16], overline: [12, 16],
    };
    for (const [name, pair] of Object.entries(before)) {
      expect(TYPE_SCALE[name as keyof typeof TYPE_SCALE].desktop, `${name} desktop`).toEqual(pair);
    }
  });

  it('shrinks the display size on phones so long headings do not overflow a 390px column', () => {
    expect(TYPE_SCALE.display.phone[0]).toBeLessThan(TYPE_SCALE.display.desktop[0]);
    expect(TYPE_SCALE.title.phone[0]).toBeLessThan(TYPE_SCALE.title.desktop[0]);
  });
});

describe('UI-01B: control heights', () => {
  it('reaches the 44px touch standard below the desktop breakpoint', () => {
    expect(CONTROL_HEIGHT.touch.md).toBe(44);
    expect(CONTROL_HEIGHT.touch.sm).toBeGreaterThanOrEqual(40);
  });

  it('restores enterprise density at the desktop breakpoint, in the same block as the desktop type tier', () => {
    const desktopBlock = rootBlocks[2];
    const decls = declarations(desktopBlock);
    expect(remToPx(decls.get('--control-height-sm')!)).toBe(CONTROL_HEIGHT.desktop.sm);
    expect(remToPx(decls.get('--control-height')!)).toBe(CONTROL_HEIGHT.desktop.md);
    expect(remToPx(decls.get('--control-height-lg')!)).toBe(CONTROL_HEIGHT.desktop.lg);
  });

  it('keeps the desktop control heights unchanged from before UI-01B', () => {
    expect(CONTROL_HEIGHT.desktop).toEqual({ sm: 32, md: 36, lg: 40 });
  });
});
