/**
 * Install-availability for the HRIS Plus PWA, per browser.
 *
 * Browsers differ, and the rule is never to offer an install the browser
 * cannot perform:
 *
 *   - Chromium browsers (Chrome, Edge, Brave, Opera, Samsung Internet, other
 *     Chromium builds) fire `beforeinstallprompt` when — and only when — the
 *     app is installable there. That event is the only signal trusted for
 *     them: the button appears once it has fired, and installing calls the
 *     browser's own prompt. Chromium never offers a manual fallback here
 *     because "Install" may genuinely be unavailable (already installed,
 *     policy-disabled, Opera GX, kiosk mode…).
 *   - Safari on iPhone / iPad (and every other iOS browser, which are all
 *     WebKit) has no prompt API at all; "Add to Home Screen" in the Share
 *     sheet is the install. Manual instructions are shown.
 *   - Safari 17+ on macOS installs through File → Add to Dock. Earlier
 *     versions cannot install, so nothing is shown.
 *   - Firefox for Android installs from its menu; Samsung Internet has a menu
 *     path for when its prompt has not fired.
 *   - Firefox on desktop cannot install web apps: nothing is shown, and the
 *     site remains a normal responsive website.
 *
 * Detection reads the user-agent string only to choose instructions. It never
 * gates any application feature — every user gets the same application in
 * every browser, installed or not.
 */

/** The Chromium-only event; not in lib.dom.d.ts. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** A platform where installation is a manual, menu-driven step. */
export type ManualInstallPlatform =
  | 'ios-safari'
  | 'ios-other'
  | 'macos-safari'
  | 'firefox-android'
  | 'samsung-internet';

export interface PlatformSignals {
  userAgent: string;
  /** navigator.maxTouchPoints — distinguishes an iPad in desktop mode from a Mac. */
  maxTouchPoints: number;
}

/**
 * The manual install path for this browser, or null when the browser either
 * uses `beforeinstallprompt` (Chromium) or cannot install at all.
 */
export function detectManualInstallPlatform({ userAgent: ua, maxTouchPoints }: PlatformSignals): ManualInstallPlatform | null {
  const isIPhoneOrIPod = /iPhone|iPod/.test(ua);
  // iPadOS 13+ reports a Macintosh desktop UA; touch support gives it away.
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (isIPhoneOrIPod || isIPad) {
    // Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), Opera (OPiOS/OPT), Brave… on iOS.
    const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo/.test(ua);
    return isOtherIosBrowser ? 'ios-other' : 'ios-safari';
  }

  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return 'samsung-internet';
    if (/Firefox\//.test(ua)) return 'firefox-android';
    return null; // Chromium on Android: beforeinstallprompt only.
  }

  if (/Macintosh/.test(ua)) {
    const isChromiumOrOther = /Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
    const safariVersion = /Version\/(\d+)(?:\.\d+)*.*Safari\//.exec(ua);
    if (!isChromiumOrOther && safariVersion && Number(safariVersion[1]) >= 17) return 'macos-safari';
  }

  return null;
}

/** True when this window is the installed app rather than a browser tab. */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true; // iOS / iPadOS home-screen app
  if (typeof window.matchMedia !== 'function') return false;
  return ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

// ---------------------------------------------------------------------------
// Shared state: the deferred Chromium prompt and the "installed" flag.
// `beforeinstallprompt` can fire before React mounts, so capture starts in
// main.tsx and components subscribe through useSyncExternalStore.
// ---------------------------------------------------------------------------

export interface InstallPromptState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  installed: boolean;
}

let state: InstallPromptState = { deferredPrompt: null, installed: false };
const listeners = new Set<() => void>();

function setState(next: Partial<InstallPromptState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function getInstallPromptState(): InstallPromptState {
  return state;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let captureStarted = false;

/**
 * Start listening for the browser's install signals. Idempotent. The default
 * mini-infobar is suppressed so the browser never nags; installing is always
 * the person's own choice from the "Install app" control.
 */
export function initInstallPromptCapture(): void {
  if (captureStarted || typeof window === 'undefined') return;
  captureStarted = true;
  setState({ installed: isRunningStandalone() });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setState({ deferredPrompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    setState({ deferredPrompt: null, installed: true });
  });
}

/**
 * Show the browser's own install prompt. A prompt can be used once, so it is
 * cleared whatever the outcome; Chromium fires a fresh event if installing
 * becomes possible again.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = state.deferredPrompt;
  if (!prompt) return 'unavailable';
  setState({ deferredPrompt: null });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') setState({ installed: true });
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** Test-only: reset module state between tests. */
export function __resetInstallPromptForTests(): void {
  state = { deferredPrompt: null, installed: false };
  captureStarted = false;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// "Don't show again" — a per-device convenience, never security state.
// ---------------------------------------------------------------------------

const HIDE_KEY = 'hrisplus.install.hidden';

export function isInstallOptionHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function hideInstallOption(): void {
  try {
    localStorage.setItem(HIDE_KEY, '1');
  } catch {
    // Storage unavailable (private mode): the option simply reappears next visit.
  }
}
