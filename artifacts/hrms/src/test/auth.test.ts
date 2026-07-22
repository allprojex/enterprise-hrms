/**
 * Unit tests for the client-side auth token utility.
 * No network calls — exercises localStorage read/write/clear.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredToken, storeToken, clearToken } from '@/lib/auth';

describe('auth token utility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no token is stored', () => {
    expect(getStoredToken()).toBeNull();
  });

  it('stores and retrieves a token', () => {
    storeToken('my-test-token');
    expect(getStoredToken()).toBe('my-test-token');
  });

  it('overwrites an existing token', () => {
    storeToken('token-v1');
    storeToken('token-v2');
    expect(getStoredToken()).toBe('token-v2');
  });

  it('clears the stored token', () => {
    storeToken('token-to-clear');
    clearToken();
    expect(getStoredToken()).toBeNull();
  });

  it('clearToken is a no-op when nothing is stored', () => {
    expect(() => clearToken()).not.toThrow();
    expect(getStoredToken()).toBeNull();
  });
});
