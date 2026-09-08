/**
 * cn() / tailwind-merge configuration for the design foundation.
 *
 * Regression for the Super Admin "+ New Installation" contrast defect: with
 * tailwind-merge's default configuration every unknown `text-*` class is a text
 * COLOUR, so the type-scale utilities (text-button, text-body-sm, text-label …)
 * competed with the real foreground colour and only the last one survived.
 * cn() now registers the type scale as font-size utilities.
 */
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';
import { TYPE_SCALE_UTILITIES } from '@/lib/design-tokens';

const tokens = (value: string) => value.split(/\s+/).filter(Boolean);

describe('cn() — type-scale utilities never displace a text colour', () => {
  it('keeps the primary foreground on a small primary button (the reported defect)', () => {
    const out = tokens(
      cn(
        'inline-flex rounded-md text-button',
        'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        'h-control-sm min-h-control-sm rounded-md px-3 text-body-sm font-medium',
      ),
    );
    expect(out).toContain('text-primary-foreground');
    expect(out).toContain('bg-primary');
    expect(out).toContain('hover:bg-primary-hover');
    // The two type-scale utilities conflict with each other: the size-specific one wins.
    expect(out).toContain('text-body-sm');
    expect(out).not.toContain('text-button');
  });

  it('keeps both size and colour for every type-scale utility paired with a foreground colour', () => {
    for (const utility of TYPE_SCALE_UTILITIES) {
      for (const colour of ['text-foreground', 'text-muted-foreground', 'text-primary-foreground', 'text-danger-foreground', 'text-secondary-foreground']) {
        expect(tokens(cn(utility, colour)), `${utility} + ${colour}`).toEqual([utility, colour]);
        expect(tokens(cn(colour, utility)), `${colour} + ${utility}`).toEqual([colour, utility]);
      }
    }
  });

  it('treats type-scale utilities as font sizes: they replace each other and Tailwind sizes (last wins)', () => {
    expect(cn('text-button', 'text-body-sm')).toBe('text-body-sm');
    expect(cn('text-body-sm', 'text-button')).toBe('text-button');
    expect(cn('text-sm', 'text-body-sm')).toBe('text-body-sm');
    expect(cn('text-body-sm', 'text-sm')).toBe('text-sm');
    expect(cn('text-body', 'text-foreground', 'text-label')).toBe('text-foreground text-label');
  });

  it('still lets a caller override the colour without losing the size', () => {
    expect(cn('text-body-sm text-primary-foreground', 'text-danger')).toBe('text-body-sm text-danger');
  });

  it('leaves the other custom utilities (control heights, motion, z layers) untouched', () => {
    expect(cn('h-control-sm min-h-control-sm motion-interactive z-modal duration-fast')).toBe(
      'h-control-sm min-h-control-sm motion-interactive z-modal duration-fast',
    );
  });

  it('keeps ordinary Tailwind conflict resolution intact', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('bg-primary', 'bg-primary-hover')).toBe('bg-primary-hover');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});
