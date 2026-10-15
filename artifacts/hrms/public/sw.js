/*
 * HRIS Plus service worker.
 *
 * ITS JOBS ARE INSTALLABILITY AND A SAFE OFFLINE PAGE. It exists so supported
 * browsers offer "Install app", so the installed window has a controller, and
 * so a navigation made without a connection shows a static "you are offline"
 * page instead of the browser's error screen. It is deliberately NOT an
 * offline data layer.
 *
 * WHAT IT CACHES
 *   Only static, non-sensitive files that are identical for every tenant and
 *   every user:
 *     - the offline page and its stylesheet/script;
 *     - the manifest and its icons, which the browser needs to render the
 *       installed app.
 *   The application shell document ("/") is NOT cached (v1 cached it): the
 *   offline page replaces it as the fallback, so no copy of the application
 *   can ever be revived from disk after a release, a logout or a revoked
 *   session.
 *
 * WHAT IT MUST NEVER CACHE — enforced by bailing out before any cache write:
 *   - anything under /api/ (employee and personnel records, authentication
 *     and session responses, reports, payroll, personnel documents, leave,
 *     attendance, performance, inventory, assets, audit data — every
 *     tenant-scoped business response the platform serves);
 *   - any non-GET request;
 *   - any cross-origin request;
 *   - any response that is not a basic, 200, same-origin response.
 *
 * Authenticated business data therefore continues to come from the server on
 * every request, under the existing authorization and tenant-isolation model.
 * Nothing a signed-in user sees is written to disk by this file.
 *
 * WHY NOT PRECACHE THE HASHED BUILD ASSETS
 *   Vite emits content-hashed, immutably-cacheable asset filenames, which the
 *   browser's own HTTP cache already handles correctly. Precaching them would
 *   add a second, independent cache with its own invalidation rules — the
 *   classic way a PWA ends up serving a stale bundle against a newer API after
 *   a release. Navigations always go to the network, so a new release is
 *   picked up on the next load; an already-open window is told about it by the
 *   in-app update check (src/lib/app-update.ts), never reloaded by force.
 *
 * UPDATE BEHAVIOUR
 *   CACHE_NAME is versioned. On activate, every cache whose name does not match
 *   is deleted, so a release cannot leave an orphaned cache behind — upgrading
 *   from v1 removes the cached shell document. The worker claims clients
 *   immediately so an installed window is controlled without a second launch.
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `hrms-shell-${CACHE_VERSION}`;

/** Served for a navigation that fails because the network is unavailable. */
const OFFLINE_URL = '/offline.html';

/** Static files the offline page and the installed app need. Nothing tenant-specific. */
const PRECACHE_ASSETS = [
  OFFLINE_URL,
  '/offline.css',
  '/offline.js',
  '/manifest.webmanifest',
  '/icons/pwa-192.png',
  '/icons/pwa-512.png',
  '/icons/pwa-maskable-192.png',
  '/icons/pwa-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/favicon.svg',
];

/** Paths whose responses must never be written to any cache. */
function isForbiddenToCache(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

/** True only for requests this worker is allowed to store. */
function isCacheableRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (isForbiddenToCache(url)) return false;
  return true;
}

function isCacheableResponse(response) {
  return Boolean(response) && response.status === 200 && response.type === 'basic';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Failure to warm any single asset must not fail the installation —
      // installability does not depend on the cache being complete.
      await Promise.allSettled(PRECACHE_ASSETS.map((path) => cache.add(path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API traffic is never inspected, never cached, and never served from
  // cache. Returning without calling respondWith leaves it entirely to the
  // browser's normal networking, exactly as if no worker were installed.
  if (isForbiddenToCache(url)) return;
  if (!isCacheableRequest(request)) return;

  // Navigations: always the network. Only when the network itself fails (no
  // connection — not a 4xx/5xx, which are returned as-is) is the static
  // offline page served. Navigation responses are never stored.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline · HRIS Plus</title>' +
              '<p>HRIS Plus needs an internet connection. Reconnect and reload this page.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }
      })(),
    );
    return;
  }

  // The precached static files: cache-first, since they change only with a
  // release and the activate handler drops the old cache when that happens.
  if (PRECACHE_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const response = await fetch(request);
        if (isCacheableResponse(response)) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }

  // Everything else — including Vite's content-hashed JS and CSS — is left to
  // the browser's HTTP cache, which already handles immutable assets correctly.
});
