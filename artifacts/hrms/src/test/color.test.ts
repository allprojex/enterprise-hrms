import { describe, expect, it } from 'vitest';
import {
  AA_TEXT_CONTRAST,
  contrastRatio,
  formatHslTriple,
  hoverVariant,
  hslToRgb,
  meetsAaText,
  parseHslTriple,
  readableForeground,
  softForeground,
  softVariant,
} from '@/lib/color';

describe('color: parseHslTriple', () => {
  it('parses the stylesheet contract', () => {
    expect(parseHslTriple('222 47% 31%')).toEqual({ h: 222, s: 47, l: 31 });
    expect(parseHslTriple('  0 0% 100% ')).toEqual({ h: 0, s: 0, l: 100 });
    expect(parseHslTriple('210.5 30% 92%')).toEqual({ h: 210.5, s: 30, l: 92 });
  });

  it('refuses anything that is not an HSL triple', () => {
    expect(parseHslTriple('#123456')).toBeNull();
    expect(parseHslTriple('hsl(222 47% 31%)')).toBeNull();
    expect(parseHslTriple('red')).toBeNull();
    expect(parseHslTriple('')).toBeNull();
    expect(parseHslTriple(undefined)).toBeNull();
    expect(parseHslTriple(null)).toBeNull();
    expect(parseHslTriple('222 47 31')).toBeNull();
    expect(parseHslTriple('url(javascript:alert(1))')).toBeNull();
  });

  it('normalises hue and clamps saturation / lightness', () => {
    expect(parseHslTriple('-30 150% 120%')).toEqual({ h: 330, s: 100, l: 100 });
  });

  it('round-trips through formatHslTriple', () => {
    expect(formatHslTriple(parseHslTriple('220 55% 16%')!)).toBe('220 55% 16%');
  });
});

describe('color: contrast', () => {
  it('converts pure colours', () => {
    expect(hslToRgb({ h: 0, s: 0, l: 100 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(hslToRgb({ h: 0, s: 0, l: 0 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('black on white is 21:1 and symmetric', () => {
    const black = { h: 0, s: 0, l: 0 };
    const white = { h: 0, s: 0, l: 100 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
  });

  it('judges AA text contrast', () => {
    expect(meetsAaText({ h: 0, s: 0, l: 100 }, { h: 222, s: 47, l: 31 })).toBe(true);
    // white on saturated yellow fails badly
    expect(meetsAaText({ h: 0, s: 0, l: 100 }, { h: 48, s: 100, l: 50 })).toBe(false);
  });
});

describe('color: derivation', () => {
  it('picks white on dark brand colours and near-black on light ones', () => {
    expect(readableForeground({ h: 220, s: 55, l: 16 })).toEqual({ h: 0, s: 0, l: 100 });
    expect(readableForeground({ h: 48, s: 100, l: 50 })).toEqual({ h: 222, s: 30, l: 12 });
    // either way, the result clears AA
    for (const bg of [{ h: 220, s: 55, l: 16 }, { h: 48, s: 100, l: 50 }, { h: 200, s: 60, l: 50 }]) {
      expect(contrastRatio(readableForeground(bg), bg)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  it('hover darkens light colours and lightens dark ones', () => {
    expect(hoverVariant({ h: 222, s: 47, l: 31 }).l).toBe(25);
    expect(hoverVariant({ h: 222, s: 47, l: 70 }).l).toBe(76);
    expect(hoverVariant({ h: 222, s: 47, l: 2 }).l).toBe(0);
  });

  it('soft tint stays near white with capped saturation, and its foreground reads on it', () => {
    const base = { h: 38, s: 100, l: 50 };
    const soft = softVariant(base);
    expect(soft.l).toBe(95);
    expect(soft.s).toBeLessThanOrEqual(70);
    expect(contrastRatio(softForeground(base), soft)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    const darkSoft = softVariant(base, true);
    expect(darkSoft.l).toBe(18);
    expect(contrastRatio(softForeground(base, true), darkSoft)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });
});
