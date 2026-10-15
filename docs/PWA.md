# HRIS Plus — Progressive Web App

HRIS Plus can be installed as an app on phones, tablets and computers where the
browser supports it, and remains a normal responsive website everywhere else.
Installed or not, every user gets the same application, the same permissions
and the same tenant isolation — installation only changes how the window
opens.

## Architecture

Hand-written, zero added dependencies (no Workbox / vite-plugin-pwa — see
"Why no Workbox" below).

| Piece | File | Role |
|---|---|---|
| Manifest | `artifacts/hrms/public/manifest.webmanifest` | Name `HRIS Plus`, `display: standalone`, scope/start `/`, icons 192/512 any + maskable |
| Icons | `artifacts/hrms/public/icons/*` | Existing HRIS Plus "HR" mark. `apple-touch-icon.png` is opaque (iOS paints transparency black) |
| Service worker | `artifacts/hrms/public/sw.js` | Precaches static install/offline files only; serves the offline page when a navigation fails for lack of network |
| Offline page | `artifacts/hrms/public/offline.{html,css,js}` | Static "You're offline" page with Retry; auto-resumes on reconnect |
| Registration | `artifacts/hrms/src/lib/pwa.ts` | Registers `/sw.js` after `load`, secure contexts only, failure never blocks the app |
| Install detection | `artifacts/hrms/src/lib/pwa-install.ts` | Per-browser install path; captures `beforeinstallprompt` |
| Install control | `artifacts/hrms/src/components/pwa/install-app-button.tsx` | Discreet "Install app" in the sidebar footer |
| Update detection | `artifacts/hrms/src/lib/app-update.ts` | Detects a newly deployed release while a window is open |
| Notices | `artifacts/hrms/src/components/pwa/app-notices.tsx` | Offline notice, update notice, cross-window sign-out |
| iOS / safe areas | `index.html` (`viewport-fit=cover`, Apple meta), `index.css` (`*-safe` utilities) | Full-screen installed app clear of notches, Dynamic Island and home indicator |

## Security and caching policy

HRIS Plus holds sensitive employee and organisation data, so the service worker
is deliberately **not** an offline data layer.

**Cached (Cache Storage, `hrms-shell-v2`)** — exactly these static, tenant-neutral files:
`/offline.html`, `/offline.css`, `/offline.js`, `/manifest.webmanifest`, the five icons, `/favicon.svg`.

**Never cached** — enforced before any cache write and covered by tests (`src/test/pwa.test.ts`):

- anything under `/api/` — employee records, payroll, personnel documents, leave, attendance, reports, audit data, and every authentication or session response; the worker does not even call `respondWith` for these;
- any page/navigation response, including the application shell (v1 cached `/`; v2 removes it on activation);
- non-GET requests, cross-origin requests, and any non-200 / non-same-origin response.

**Consequences**

- Logout and session expiry behave exactly as in a browser tab: nothing a signed-in user saw can be re-opened from disk.
- Signing out in one window (e.g. a browser tab) now also clears and signs out other open windows of the same origin, including the installed app, which share the session token (`onSignedOutElsewhere` in `src/lib/auth.ts`).
- No offline editing, background sync or offline storage of HR data exists.
- Authentication (Bearer token), RBAC, tenant host pinning and the API are untouched.
- The worker only registers on secure origins (HTTPS, or `localhost` in development).

### Why no Workbox

Vite's content-hashed assets are already correctly cached by the browser's HTTP
cache (nginx: `/assets/` immutable for a year; everything else `no-store`).
Precaching them in a second cache is the classic way a PWA ends up serving a
stale bundle against a newer API. Navigations always go to the network, so a
new release is picked up on the next load.

## Updates after a deployment

- A window opened after a release always gets the new release (navigations are network-only).
- An already-open window checks for a new release when it becomes visible again, when the connection returns, and every 15 minutes. It compares its own `/assets/index-<hash>.js` with the one referenced by the deployed `/` (fetched with `no-store`).
- When a new release is found, a notice offers **Refresh now** / **Later**. The app **never reloads by itself**.
- **Refresh now** waits until no save is in flight; a form with unsaved changes still gets the navigation guard's own "Leave this page?" confirmation.
- The worker's cache name is versioned; activating a new worker deletes older caches. Bump `CACHE_VERSION` in `sw.js` only when the precached file list or offline page changes.

## Offline behaviour

- Opening or reloading a page without a connection shows the static offline page (no data, no cached app). **Retry** reloads the same page; the page also reloads itself when the connection returns.
- If the connection drops while the app is open, a notice explains HRIS Plus needs a connection; data already on screen stays in memory only. When the connection returns, React Query re-fetches what is on screen.

## Installation by browser

The rule: never offer an install the browser cannot perform.

| Platform / browser | Install path | "Install app" control |
|---|---|---|
| Android — Chrome, Edge, Brave, Opera, other Chromium | Browser prompt (`beforeinstallprompt`) or menu → Install app / Add to Home screen | Shown once the browser reports the app installable; uses the browser prompt |
| Android — Samsung Internet | Prompt where fired; otherwise ≡ → Add page to → Home screen | Manual steps |
| Android — Firefox | ⋮ → Install / Add to Home screen | Manual steps |
| iPhone / iPad — Safari | Share → Add to Home Screen | Manual steps |
| iPhone / iPad — Chrome, Edge, Firefox, others (iOS/iPadOS 16.4+) | Share → Add to Home Screen | Manual steps (with "use Safari" fallback note) |
| Windows / macOS / Linux — Chrome, Edge, Brave | Address-bar install icon or menu → Install HRIS Plus | Shown once `beforeinstallprompt` fires |
| Windows / macOS — Opera | Install where Opera supports it | Only if `beforeinstallprompt` fires |
| Opera GX | Generally no PWA install | Only if `beforeinstallprompt` fires (normally hidden) |
| macOS — Safari 17+ | File → Add to Dock | Manual steps |
| macOS — Safari 16 and earlier | Not supported | Hidden |
| Desktop Firefox (Windows / macOS / Linux) | Not supported | Hidden — the site works normally |

The control is hidden inside the installed app, once installed, and after "Don't show again" (stored per device). It never opens by itself, and the browser's own mini-infobar is suppressed so nothing nags users during login or workflows.

## Production configuration

1. **nginx** — `deploy/nginx/hrms.afripebbles.com.conf` now serves `/manifest.webmanifest` as `application/manifest+json` (was `application/octet-stream` with `nosniff`). Apply on the VPS as root (owner action), then `nginx -t && systemctl reload nginx` and run the edge header probes. Everything else already fits: `/sw.js`, `/offline.*` and the manifest are covered by the existing `no-store` `location /`; `/assets/` stays immutable.
2. **HTTPS** is required for the service worker (already in place on both hosts).
3. **No API, database or environment changes.**

## Automated tests

- `src/test/pwa.test.ts` — manifest, icons (including the opaque Apple icon), viewport, offline page, and the worker's cache policy exercised in a stubbed `ServiceWorkerGlobalScope` (never caches `/api`, pages or the shell; offline fallback only on network failure; old caches deleted).
- `src/test/pwa-install.test.ts` — install-path detection across 23 real user-agent strings (Chrome, Edge, Firefox, Safari, Opera, Opera GX, Samsung Internet on Android / iOS / iPadOS / Windows / macOS / Linux) and prompt capture.
- `src/test/app-update.test.ts` — release detection.
- `src/test/pwa-components.test.tsx` — install control, offline notice, update notice (never auto-reloads; waits for in-flight saves), cross-window sign-out.

Lighthouse no longer has a PWA category (removed in Lighthouse 12); installability is checked in Chrome DevTools → Application → Manifest.

## Manual test checklist

Run on the deployed HTTPS host after a release. Use an authorised test account; never real employee changes.

**Every installable browser**

- [ ] DevTools → Application → Manifest shows no installability errors (Chromium).
- [ ] Install, then launch: opens standalone (no address bar), title HRIS Plus, correct icon.
- [ ] Sign in, browse employees / leave / forms; behaviour identical to the browser tab.
- [ ] Log out in the installed app → sign-in page; Back does not show protected data.
- [ ] With the app and a browser tab both open, log out in the tab → the app returns to sign-in.
- [ ] DevTools → Application → Cache Storage: only `hrms-shell-v2` with the 10 static files; nothing under `/api`, no pages.
- [ ] Airplane mode → reload: offline page; Retry while offline says still offline; reconnect → app resumes.
- [ ] Airplane mode while on a page: offline notice appears; reconnect → notice disappears.
- [ ] After a new deployment, return to an open window: update notice; Later dismisses; Refresh loads the new release; with an unsaved employee form, Refresh asks before leaving.

**Android** — Chrome: sidebar "Install app" → browser dialog → home-screen icon opens standalone. Samsung Internet and Firefox: the instructions match the menus. Check the status-bar colour and the back gesture.

**iPhone / iPad** — Safari: sidebar "Install app" shows Share → Add to Home Screen steps; following them adds "HRIS Plus" with an opaque icon; the app opens full screen; content is clear of the notch / Dynamic Island in portrait and landscape and of the home indicator; rotate the device. Repeat from Chrome on iOS 16.4+.

**Windows** — Chrome and Edge: address-bar install icon and sidebar "Install app" both install; the app appears in Start; uninstall from the app menu. Firefox: no install control, site works.

**macOS** — Chrome / Edge: as Windows. Safari 17+: sidebar shows File → Add to Dock; the Dock app opens in its own window. Firefox: no install control.

**Linux** — Chrome / Brave: install works. Firefox: no install control.

## Known limitations

- Desktop Firefox and Safari 16 or earlier cannot install web apps; HRIS Plus works there as a website.
- iOS shares no install event with the page, so "installed" is only detected inside the installed app itself.
- The manifest and service worker assume the app is served at `/` (Production `BASE_PATH=/`).
- The current icon is the existing "HR" mark; a dedicated HRIS Plus logo can replace the PNGs in `public/icons/` without code changes (keep sizes, keep `apple-touch-icon.png` opaque, keep the maskable safe zone).
