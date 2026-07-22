/**
 * Client-side auth token management.
 * Stores the Bearer token in localStorage and registers the getter
 * with the generated API client so every fetch includes it automatically.
 *
 * Portable: uses only Web Storage API — no Replit-specific dependencies.
 */

import { setAuthTokenGetter } from "@workspace/api-client-react";

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

/** Call once at app boot to wire the stored token into every API request. */
export function initAuth(): void {
  setAuthTokenGetter(() => getStoredToken());
}
