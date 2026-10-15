/**
 * Client-side auth token management.
 * Stores the Bearer token in localStorage and registers the getter
 * with the generated API client so every fetch includes it automatically.
 *
 * Portable: uses only the Web Storage API — no platform-specific dependencies.
 */

import { setAuthTokenGetter, setTenantHostnameGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "hrms_auth_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage may be unavailable (e.g. private mode with full quota).
    // Log but do not crash — the user will be asked to re-login on next load.
    console.warn("[auth] Could not persist token to localStorage.");
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore — clearing a missing item is a no-op.
  }
}

/**
 * Notify when the session token is removed by ANOTHER window of this origin —
 * e.g. logging out in a browser tab while the installed app is also open.
 * Both share one localStorage, but only the window that logged out cleared
 * its in-memory data; the listener lets every other window do the same
 * instead of continuing to display it. The `storage` event never fires in the
 * window that made the change. Returns an unsubscribe function.
 */
export function onSignedOutElsewhere(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // key === null means localStorage.clear() in the other window.
    if ((event.key === TOKEN_KEY || event.key === null) && getStoredToken() === null) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/**
 * Call once at app boot to wire the stored token and the browser's own
 * hostname into every API request. The hostname is only ever the caller's
 * own (window.location.hostname) — see setTenantHostnameGetter's doc
 * comment for why that carries no authorization weight on its own.
 */
export function initAuth(): void {
  setAuthTokenGetter(() => getStoredToken());
  setTenantHostnameGetter(() => window.location.hostname);
}

/** Full-page navigation to the sign-in page, discarding all in-memory state. */
export function redirectToSignIn(): void {
  window.location.replace(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/login`);
}
