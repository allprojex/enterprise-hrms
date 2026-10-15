/**
 * Detects that a newer HRIS Plus release has been deployed while this window
 * is open, so the person can refresh into it when it suits them.
 *
 * How: every release changes the content-hashed entry script that index.html
 * references (`/assets/index-<hash>.js`). The running window knows its own; a
 * no-store fetch of "/" reveals the deployed one. They differ → update.
 * No build step, version file or server endpoint is needed, and only the
 * public application document is fetched (never anything under /api).
 *
 * What it never does: reload by itself. An update during a form submission or
 * an approval would lose work, so the decision stays with the person (see
 * components/pwa/app-notices.tsx, which also waits for in-flight saves).
 *
 * Checks run when the window becomes visible again, when the connection comes
 * back, and every CHECK_INTERVAL_MS while visible. In development (no hashed
 * entry script) the checker does nothing.
 */

export const CHECK_INTERVAL_MS = 15 * 60 * 1000;

const ENTRY_SCRIPT_RE = /<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/i;

/** The hashed entry script referenced by an HTML document, or null. */
export function extractEntryScript(html: string): string | null {
  const match = ENTRY_SCRIPT_RE.exec(html);
  return match ? match[1] : null;
}

/** The entry script this window is running, or null outside a production build. */
export function getRunningEntryScript(doc: Document = document): string | null {
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  const src = script?.getAttribute('src');
  if (!src) return null;
  try {
    return new URL(src, doc.baseURI).pathname;
  } catch {
    return null;
  }
}

/** The entry script currently deployed, or null when it cannot be determined (offline, error). */
export async function fetchDeployedEntryScript(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl('/', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return null;
    return extractEntryScript(await response.text());
  } catch {
    return null;
  }
}

export interface UpdateWatcherOptions {
  onUpdateAvailable: () => void;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
}

/**
 * Start watching for a newer deployment. Returns a stop function. Calls
 * onUpdateAvailable at most once per newly deployed entry script.
 */
export function startUpdateWatcher({ onUpdateAvailable, fetchImpl, intervalMs = CHECK_INTERVAL_MS }: UpdateWatcherOptions): () => void {
  const running = getRunningEntryScript();
  if (!running) return () => {};

  let lastAnnounced: string | null = null;
  let checking = false;

  const check = async () => {
    if (checking || document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    checking = true;
    try {
      const deployed = await fetchDeployedEntryScript(fetchImpl);
      if (deployed && deployed !== running && deployed !== lastAnnounced) {
        lastAnnounced = deployed;
        onUpdateAvailable();
      }
    } finally {
      checking = false;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void check();
  };
  const onOnline = () => void check();
  // A lazily-loaded chunk that no longer exists on the server means this
  // window is running an old release. (No route is lazy today; this keeps a
  // future code-split from failing silently.)
  const onPreloadError = () => onUpdateAvailable();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('vite:preloadError', onPreloadError);
  const timer = window.setInterval(() => void check(), intervalMs);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('vite:preloadError', onPreloadError);
    window.clearInterval(timer);
  };
}

/** Load the latest release. Only ever called from an explicit user action. */
export function reloadToLatest(): void {
  window.location.reload();
}
