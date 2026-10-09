/*
 * Enterprise HRMS service worker.
 *
 * ITS ONLY JOB IS INSTALLABILITY. It exists so supported browsers offer
 * "Install app" and so the installed window has a controller. It is
 * deliberately NOT an offline data layer.
 *
 * WHAT IT CACHES
 *   Exactly two things, both non-sensitive and identical for every tenant:
 *     - the application shell document ("/"), network-first;
 *     - the manifest and its icons, which the browser needs to render the
 *       installed app.
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
 *   a release. Network-first on the one unhashed document (the shell) means a
 *   new HRMS release is picked up on the next load with no cache versioning to
 *   get wrong, and the only stale artefact possible is a shell served while the
 *   network is unavailable.
 *
 * UPDATE BEHAVIOUR
 *   CACHE_NAME is versioned. On activate, every cache whose name does not match
 *   is deleted, so a release cannot leave an orphaned cache behind. The worker
 *   claims clients immediately so an installed window is controlled without a
 *   second launch.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `hrms-shell-${CACHE_VERSION}`;

/** The shell document and the assets the browser needs to present the app. */
const SHELL_URL = '/';
const INSTALLABILITY_ASSETS = [
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
      await Promise.allSettled(
        [SHELL_URL, ...INSTALLABILITY_ASSETS].map((path) => cache.add(path)),
      );
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

  // Navigations: network-first, falling back to the cached shell only when the
  // network is unavailable. A successful response refreshes the stored shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (isCacheableResponse(response)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SHELL_URL, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(SHELL_URL);
          if (cached) return cached;
          throw new Error('Offline and no cached application shell is available');
        }
      })(),
    );
    return;
  }

  // The few installability assets: cache-first, since they change only with a
  // release and the activate handler drops the old cache when that happens.
  if (INSTALLABILITY_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
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
