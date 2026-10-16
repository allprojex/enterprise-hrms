/**
 * The application's single React Query client.
 *
 * Session end is handled here, once, for every request: when ANY query or
 * mutation is answered with 401 while this window holds a session token, the
 * session has ended (expired, revoked, or signed out elsewhere — requireAuth is
 * the only source of 401 besides a failed sign-in). The window then:
 *   1. removes the token (other windows hear it and sign out too — see
 *      onSignedOutElsewhere in lib/auth.ts);
 *   2. drops every cached response from memory, so no employee, payroll or
 *      other HR data stays on screen or reachable through Back;
 *   3. replaces the page with the sign-in page (a full navigation, so nothing
 *      in memory survives).
 * Before this, only a 401 from /auth/me redirected, and the cached data of the
 * page in view stayed in memory until the next reload.
 *
 * A wrong password at sign-in is also a 401 but is not a session ending: it is
 * excluded by URL, and by there being no stored token on the sign-in page.
 */
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearToken, getStoredToken, redirectToSignIn } from '@/lib/auth';

/** True for the API's "no valid session" answer — any 401 except a failed sign-in attempt. */
export function isSessionEndedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, url } = error as { status?: unknown; url?: unknown };
  if (status !== 401) return false;
  if (typeof url === 'string' && /\/api\/auth\/login(?:[?#]|$)/.test(url)) return false;
  return true;
}

export function createAppQueryClient(): QueryClient {
  // `client` is only read when a request fails, long after construction.
  const endSessionIfExpired = (error: unknown) => {
    if (!isSessionEndedError(error) || getStoredToken() === null) return;
    clearToken();
    client.clear();
    redirectToSignIn();
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError: endSessionIfExpired }),
    mutationCache: new MutationCache({ onError: endSessionIfExpired }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // Retry once as before, but never retry a 401 — an ended session
        // should clear the screen immediately, not after a second failure.
        retry: (failureCount, error) => !isSessionEndedError(error) && failureCount < 1,
      },
    },
  });
  return client;
}
