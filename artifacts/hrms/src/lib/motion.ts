/**
 * Motion foundation (WS-25A).
 *
 * CSS owns the motion system: durations, easings and the Radix
 * `data-[state]` enter/exit classes live in src/index.css, and a global
 * `prefers-reduced-motion: reduce` rule collapses every animation and
 * transition. The runtime pieces here exist for the few places JavaScript
 * decides whether to animate at all (framer-motion call sites until Phase C
 * removes them, programmatic `scrollIntoView` behaviour, auto-play).
 */
import * as React from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** One-off check, safe on the server and in jsdom. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

/** Subscribes to the user's reduced-motion preference and re-renders on change. */
export function usePrefersReducedMotion(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return React.useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** `scrollIntoView` behaviour that honours the preference. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
