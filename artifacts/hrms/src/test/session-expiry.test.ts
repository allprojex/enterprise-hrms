/**
 * Session end: any 401 while signed in clears the token and every cached
 * response, then replaces the page with sign-in (lib/query-client.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectToSignIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  redirectToSignIn,
}));

import { createAppQueryClient, isSessionEndedError } from '@/lib/query-client';
import { getStoredToken, storeToken } from '@/lib/auth';

function apiError(status: number, url = 'https://wwm.hrms.example/api/organizations/3/employees/463') {
  return Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status, url });
}

beforeEach(() => {
  localStorage.clear();
  redirectToSignIn.mockReset();
});

describe('isSessionEndedError', () => {
  it('treats a 401 from any API route as the session ending', () => {
    expect(isSessionEndedError(apiError(401))).toBe(true);
    expect(isSessionEndedError(apiError(401, '/api/auth/me'))).toBe(true);
  });

  it('does not treat a failed sign-in, a 403 or a network error as the session ending', () => {
    expect(isSessionEndedError(apiError(401, 'https://wwm.hrms.example/api/auth/login'))).toBe(false);
    expect(isSessionEndedError(apiError(403))).toBe(false);
    expect(isSessionEndedError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isSessionEndedError(null)).toBe(false);
  });
});

describe('createAppQueryClient — session ended', () => {
  it('clears the token and all cached HR data, then goes to sign-in, on a 401 from a query', async () => {
    storeToken('expired-token');
    const client = createAppQueryClient();
    client.setQueryData(['employee', 463], { firstName: 'Confidential', salary: 1 });

    await client
      .fetchQuery({ queryKey: ['employees'], queryFn: () => Promise.reject(apiError(401)) })
      .catch(() => {});

    expect(getStoredToken()).toBeNull();
    expect(client.getQueryData(['employee', 463])).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
  });

  it('does the same on a 401 from a mutation (e.g. saving after expiry)', async () => {
    storeToken('expired-token');
    const client = createAppQueryClient();
    client.setQueryData(['employee', 463], { firstName: 'Confidential' });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(apiError(401)) })
      .execute(undefined)
      .catch(() => {});

    expect(getStoredToken()).toBeNull();
    expect(client.getQueryData(['employee', 463])).toBeUndefined();
    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 401 before ending the session', async () => {
    storeToken('expired-token');
    const client = createAppQueryClient();
    const queryFn = vi.fn(() => Promise.reject(apiError(401)));
    await client.fetchQuery({ queryKey: ['x'], queryFn, retryDelay: 0 }).catch(() => {});
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('leaves the sign-in page alone on a wrong password (no stored token, login URL)', async () => {
    const client = createAppQueryClient();
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(apiError(401, '/api/auth/login')) })
      .execute(undefined)
      .catch(() => {});
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });

  it('keeps the session and cache on a 403 (permission denied is not a sign-out)', async () => {
    storeToken('valid-token');
    const client = createAppQueryClient();
    client.setQueryData(['employee', 463], { firstName: 'Visible' });
    await client
      .fetchQuery({ queryKey: ['forbidden'], queryFn: () => Promise.reject(apiError(403)), retry: false })
      .catch(() => {});
    expect(getStoredToken()).toBe('valid-token');
    expect(client.getQueryData(['employee', 463])).toEqual({ firstName: 'Visible' });
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});
