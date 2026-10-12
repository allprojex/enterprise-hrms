import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useRouter } from 'wouter';
import { ConfirmActionDialog } from '@/components/foundation';
import {
  clearActiveNavigationGuard,
  setActiveNavigationGuard,
  type ActiveNavigationGuard,
} from '@/lib/navigation-guard-registry';

/**
 * Unsaved-changes protection for every way of leaving a page.
 *
 * wouter has no route blocker, so this guard intercepts the four mechanisms
 * that actually move the app, while it is active:
 *
 *   1. Link / anchor clicks (sidebar, breadcrumbs, "Back to …", header
 *      links). A capture-phase listener on `document` runs before React's
 *      root listener, so wouter's <Link onClick> never sees a blocked click.
 *   2. Programmatic navigation. wouter's navigate() — and anything else —
 *      ends in history.pushState / replaceState; those are wrapped for the
 *      lifetime of the guard and a call that changes the path is held.
 *   3. Browser back / forward. The URL has already changed when `popstate`
 *      fires; the guard immediately restores the guarded URL in the same
 *      task, before React re-renders, so the page never unmounts.
 *   4. Closing or reloading the tab: the browser's own `beforeunload` prompt.
 *
 * "Leaving" means changing the route: the path OR the query string. A
 * query-only change (`?tab=…`) is guarded; a hash-only change (`#section`)
 * is in-page scrolling and is never held.
 *
 * The History API wrappers are removed on deactivation only if they are still
 * the installed functions; a wrapper another component layered on top is
 * never overwritten (ours then becomes an inert pass-through).
 *
 * A held navigation opens one confirmation. "Leave page" performs exactly the
 * navigation that was held; "Keep editing" discards it.
 *
 * A successful save must not warn: call `releaseNavigationGuard()` before
 * navigating away. Release is one-shot and ends when the guard unmounts.
 */

type ActiveGuard = ActiveNavigationGuard;

interface PendingNavigation {
  /** Path relative to the router base, exactly as navigate() expects it. */
  to: string;
  replace: boolean;
}

/**
 * A route is the path PLUS the query string: `?tab=…`, `?page=…` and the like
 * are meaningful navigation and must be guarded. The hash is NOT part of the
 * route — `#section` links scroll within the same page and never prompt.
 * Trailing slashes are ignored.
 */
function routeKey(url: URL | Location): string {
  return `${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
}

function sameRoute(a: URL | Location, b: URL | Location): boolean {
  return routeKey(a) === routeKey(b);
}

function fullUrl(loc: URL | Location): string {
  return loc.pathname + loc.search + loc.hash;
}

export interface NavigationGuardProps {
  /** Guard only while this is true (typically the form's isDirty). */
  when: boolean;
  title?: string;
  description?: string;
}

export function NavigationGuard({
  when,
  title = 'Leave without saving?',
  description = 'You have unsaved changes on this form. If you leave now they will be lost.',
}: NavigationGuardProps) {
  const [, navigate] = useLocation();
  const { base } = useRouter();
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const guardRef = useRef<ActiveGuard | null>(null);

  const stripBase = useCallback(
    (pathWithBase: string) => {
      if (base && pathWithBase.startsWith(base)) return pathWithBase.slice(base.length) || '/';
      return pathWithBase;
    },
    [base],
  );

  useEffect(() => {
    if (!when) return undefined;
    const guard: ActiveGuard = { released: false };
    guardRef.current = guard;
    setActiveNavigationGuard(guard);
    // The URL the form lives at. Hash-only moves (#section) are allowed and
    // update it, so Back/Forward restores exactly where the person was.
    let lastAllowedUrl = fullUrl(window.location);
    // Set on deactivation: a wrapper that could not be removed (because a
    // later wrapper sits on top of it) becomes a pure pass-through.
    let disposed = false;
    const isBlocking = () => !disposed && !guard.released;

    // 1. Anchor clicks.
    const onClick = (event: MouseEvent) => {
      if (!isBlocking() || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (sameRoute(url, window.location)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ to: stripBase(url.pathname) + url.search + url.hash, replace: false });
    };
    document.addEventListener('click', onClick, true);

    // 2. Programmatic navigation (pushState / replaceState).
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const wrap = (original: typeof history.pushState, replace: boolean) =>
      function guardedHistoryMethod(this: History, data: unknown, unused: string, url?: string | URL | null) {
        if (isBlocking() && url != null) {
          const next = new URL(String(url), window.location.href);
          if (!sameRoute(next, window.location)) {
            setPending({ to: stripBase(next.pathname) + next.search + next.hash, replace });
            return;
          }
        }
        const result = original.call(this, data, unused, url);
        if (!disposed) lastAllowedUrl = fullUrl(window.location);
        return result;
      };
    const pushWrapper = wrap(originalPush, false);
    const replaceWrapper = wrap(originalReplace, true);
    history.pushState = pushWrapper;
    history.replaceState = replaceWrapper;

    // 3. Back / forward (also fires for hash-only traversal, which is allowed).
    const onPopState = () => {
      if (!isBlocking()) return;
      const lastAllowed = new URL(lastAllowedUrl, window.location.href);
      if (sameRoute(window.location, lastAllowed)) {
        lastAllowedUrl = fullUrl(window.location);
        return;
      }
      const attempted = fullUrl(window.location);
      // Restore immediately (same task), through the router's own patched
      // pushState so it re-reads the location before re-rendering.
      originalPush.call(history, history.state, '', lastAllowedUrl);
      setPending({ to: stripBase(attempted), replace: false });
    };
    window.addEventListener('popstate', onPopState);

    // 4. Tab close / reload.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isBlocking()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Remove only what this guard installed. If another component wrapped
      // the History API after us, its wrapper calls ours; overwriting it
      // would silently uninstall that component. Ours stays in its chain as
      // an inert pass-through instead (`disposed` turns blocking off).
      disposed = true;
      if (history.pushState === pushWrapper) history.pushState = originalPush;
      if (history.replaceState === replaceWrapper) history.replaceState = originalReplace;
      clearActiveNavigationGuard(guard);
      guardRef.current = null;
    };
  }, [when, stripBase]);

  return (
    <ConfirmActionDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={title}
      description={description}
      confirmLabel="Leave page"
      cancelLabel="Keep editing"
      tone="destructive"
      onConfirm={() => {
        const target = pending;
        setPending(null);
        if (guardRef.current) guardRef.current.released = true;
        if (target) navigate(target.to, { replace: target.replace });
      }}
      testId="dialog-unsaved-changes"
    />
  );
}
