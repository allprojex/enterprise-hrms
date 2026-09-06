import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { prefersReducedMotion, scrollBehavior, usePrefersReducedMotion, REDUCED_MOTION_QUERY } from '@/lib/motion';

type Listener = (e: { matches: boolean }) => void;

function mockMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  let matches = initial;
  const mql = {
    get matches() {
      return matches;
    },
    media: REDUCED_MOTION_QUERY,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => mql));
  return {
    set(next: boolean) {
      matches = next;
      for (const l of listeners) l({ matches });
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefersReducedMotion', () => {
  it('reflects the media query', () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('is false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('usePrefersReducedMotion', () => {
  it('subscribes and re-renders when the preference changes, then unsubscribes', () => {
    const media = mockMatchMedia(false);
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
