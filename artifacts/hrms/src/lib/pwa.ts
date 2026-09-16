/**
 * Service-worker registration for the installable application.
 *
 * The worker itself (public/sw.js) exists to make the HRMS installable and
 * caches only the application shell and its icons — never API responses, never
 * anything tenant-scoped. See that file for the full cache policy.
 *
 * Registration is deliberately conservative:
 *   - skipped entirely outside a secure context, so `vite dev` over plain HTTP
 *     and any non-HTTPS environment never registers a worker;
 *   - skipped when the browser has no service-worker support, leaving the app
 *     working exactly as before;
 *   - deferred until after `load`, so it never competes with the first render
 *     or the initial authenticated data fetch;
 *   - failure is logged and swallowed. A worker that cannot register must
 *     never stop the application from starting — it only affects whether the
 *     browser offers to install.
 *
 * `localhost` counts as a secure context, so the worker is exercisable in
 * development without a certificate.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      // Non-fatal by design — see the doc comment above.
      console.warn('[hrms] service worker registration failed', error);
    });
  });
}
