import { describe, expect, it } from 'vitest';
import { applyTenantTheme, clearTenantTheme, resolveTenantTheme, ALL_TENANT_CSS_VARIABLES } from '@/lib/tenant-theme-tokens';
import { contrastRatio, parseHslTriple, AA_TEXT_CONTRAST } from '@/lib/color';
import { PLATFORM_OWNED_TOKENS } from '@/lib/design-tokens';

/** WWM's stored Production branding theme, exactly as saved. */
const WWM = {
  ring: '220 55% 16%',
  accent: '38 70% 50%',
  primary: '220 55% 16%',
  sidebar: '220 55% 16%',
  sidebarAccent: '38 70% 50%',
  accentForeground: '220 55% 15%',
  primaryForeground: '0 0% 100%',
  sidebarForeground: '210 30% 92%',
  sidebarAccentForeground: '220 55% 15%',
};

describe('resolveTenantTheme', () => {
  it("applies WWM's stored values unchanged and derives the companion tokens", () => {
    const r = resolveTenantTheme(WWM);
    expect(r['--primary']).toBe('220 55% 16%');
    expect(r['--primary-foreground']).toBe('0 0% 100%');
    expect(r['--accent']).toBe('38 70% 50%');
    expect(r['--accent-foreground']).toBe('220 55% 15%');
    expect(r['--sidebar']).toBe('220 55% 16%');
    expect(r['--sidebar-foreground']).toBe('210 30% 92%');
    expect(r['--sidebar-accent']).toBe('38 70% 50%');
    expect(r['--sidebar-accent-foreground']).toBe('220 55% 15%');
    expect(r['--ring']).toBe('220 55% 16%');
    // derived
    expect(r['--primary-hover']).toBeDefined();
    expect(r['--primary-soft']).toBeDefined();
    expect(r['--primary-soft-foreground']).toBeDefined();
    expect(r['--accent-soft']).toBeDefined();
    expect(r['--focus']).toBe('220 55% 16%');
    expect(r['--sidebar-active']).toBeDefined();
    expect(r['--sidebar-active-foreground']).toBeDefined();
  });

  it('every derived pair is readable (AA) for WWM', () => {
    const r = resolveTenantTheme(WWM);
    const pairs: Array<[string, string]> = [
      ['--primary-foreground', '--primary'],
      ['--primary-soft-foreground', '--primary-soft'],
      ['--accent-foreground', '--accent'],
      ['--accent-soft-foreground', '--accent-soft'],
      ['--sidebar-foreground', '--sidebar'],
      ['--sidebar-active-foreground', '--sidebar-active'],
      ['--sidebar-foreground', '--sidebar-hover'],
    ];
    for (const [fg, bg] of pairs) {
      const ratio = contrastRatio(parseHslTriple(r[fg])!, parseHslTriple(r[bg])!);
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  it('replaces a foreground that fails AA against its background', () => {
    // white on saturated yellow: unreadable
    const r = resolveTenantTheme({ primary: '48 100% 50%', primaryForeground: '0 0% 100%' });
    expect(r['--primary']).toBe('48 100% 50%');
    expect(r['--primary-foreground']).not.toBe('0 0% 100%');
    expect(contrastRatio(parseHslTriple(r['--primary-foreground'])!, parseHslTriple(r['--primary'])!)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });

  it('derives a foreground when the tenant supplies only the background', () => {
    const r = resolveTenantTheme({ primary: '220 55% 16%' });
    expect(r['--primary-foreground']).toBe('0 0% 100%');
    const r2 = resolveTenantTheme({ accent: '48 100% 50%' });
    expect(parseHslTriple(r2['--accent-foreground'])!.l).toBeLessThan(50);
  });

  it('ignores a foreground supplied without its background', () => {
    const r = resolveTenantTheme({ primaryForeground: '0 0% 100%', accentForeground: '0 0% 0%' });
    expect(r).toEqual({});
  });

  it('ignores malformed values and unknown keys', () => {
    const r = resolveTenantTheme({
      primary: '#112233',
      accent: 'hsl(38 70% 50%)',
      ring: 'red',
      // @ts-expect-error — unknown keys are not part of the contract
      success: '0 100% 50%',
      background: '0 0% 0%',
    });
    expect(r).toEqual({});
  });

  it('never writes a platform-owned token, whatever the tenant sends', () => {
    const hostile = Object.fromEntries(PLATFORM_OWNED_TOKENS.map((t) => [t.replace(/^--/, ''), '0 100% 50%']));
    const r = resolveTenantTheme({ ...WWM, ...hostile });
    for (const t of PLATFORM_OWNED_TOKENS) expect(r[t]).toBeUndefined();
    for (const key of Object.keys(r)) expect(ALL_TENANT_CSS_VARIABLES).toContain(key);
  });

  it('returns nothing for a missing theme', () => {
    expect(resolveTenantTheme(null)).toEqual({});
    expect(resolveTenantTheme(undefined)).toEqual({});
    expect(resolveTenantTheme({})).toEqual({});
  });

  it('derives dark-appropriate soft tints when asked', () => {
    const light = resolveTenantTheme(WWM);
    const dark = resolveTenantTheme(WWM, { dark: true });
    expect(parseHslTriple(light['--primary-soft'])!.l).toBeGreaterThan(90);
    expect(parseHslTriple(dark['--primary-soft'])!.l).toBeLessThan(30);
  });
});

describe('applyTenantTheme / clearTenantTheme', () => {
  it('writes the resolved tokens onto the element and returns what it wrote', () => {
    const el = document.createElement('div');
    const written = applyTenantTheme(el, WWM);
    expect(written).toContain('--primary');
    expect(written).toContain('--primary-soft');
    expect(el.style.getPropertyValue('--primary')).toBe('220 55% 16%');
    expect(el.style.getPropertyValue('--success')).toBe('');
  });

  it('clears every previously written token, including derived ones', () => {
    const el = document.createElement('div');
    applyTenantTheme(el, WWM);
    clearTenantTheme(el);
    for (const cssVar of ALL_TENANT_CSS_VARIABLES) expect(el.style.getPropertyValue(cssVar)).toBe('');
  });

  it('applying a new theme first removes the old one', () => {
    const el = document.createElement('div');
    applyTenantTheme(el, WWM);
    applyTenantTheme(el, { primary: '200 60% 40%' });
    expect(el.style.getPropertyValue('--primary')).toBe('200 60% 40%');
    expect(el.style.getPropertyValue('--sidebar')).toBe('');
    expect(el.style.getPropertyValue('--accent')).toBe('');
  });
});
