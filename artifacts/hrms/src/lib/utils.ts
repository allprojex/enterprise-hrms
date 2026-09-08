import { extendTailwindMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';
import { TYPE_SCALE_UTILITIES } from '@/lib/design-tokens';

/**
 * tailwind-merge configured for the design foundation's custom utilities.
 *
 * tailwind-merge only knows Tailwind's own class names. Any other `text-*`
 * class (our type scale: text-button, text-body-sm, text-label, …) it
 * classifies as a text COLOUR, so it treated `text-button`,
 * `text-primary-foreground` and `text-body-sm` as three competing colours
 * and kept only the last. Visible symptom: every `size="sm"` primary Button
 * (e.g. Super Admin → Installations → "+ New Installation") lost
 * `text-primary-foreground` and rendered a dark label and icon on the dark
 * brand background; less visibly, `text-body-sm text-muted-foreground`
 * pairings across Card/Dialog/Toast descriptions lost their size.
 *
 * Registering the type scale in the font-size group makes those utilities
 * conflict with each other and with Tailwind's `text-sm`-style sizes
 * (last wins, as intended) while never displacing a colour utility.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE_UTILITIES.map((utility) => utility.replace(/^text-/, '')) }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
