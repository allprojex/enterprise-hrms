/**
 * The single active unsaved-changes guard (see components/navigation-guard.tsx).
 *
 * Kept outside the component module so pages can release the guard — after a
 * successful save, or after the person already confirmed discarding — without
 * importing a component file.
 */
export interface ActiveNavigationGuard {
  released: boolean;
}

let active: ActiveNavigationGuard | null = null;

export function setActiveNavigationGuard(guard: ActiveNavigationGuard): void {
  active = guard;
}

export function clearActiveNavigationGuard(guard: ActiveNavigationGuard): void {
  if (active === guard) active = null;
}

/** Let navigation through without a prompt (e.g. after a successful save). One-shot per guard. */
export function releaseNavigationGuard(): void {
  if (active) active.released = true;
}
