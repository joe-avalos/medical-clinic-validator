import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getToken, setToken, clearToken } from '../auth.js';

describe('auth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_DEV_JWT', '');
  });

  describe('setToken / getToken', () => {
    it('stores and retrieves a token', () => {
      setToken('abc123');
      expect(getToken()).toBe('abc123');
    });

    it('returns null when no token is set and no env fallback', () => {
      expect(getToken()).toBeFalsy();
    });

    it('falls back to VITE_DEV_JWT env var', () => {
      vi.stubEnv('VITE_DEV_JWT', 'dev-token');
      expect(getToken()).toBe('dev-token');
    });

    it('prefers localStorage over env var', () => {
      vi.stubEnv('VITE_DEV_JWT', 'dev-token');
      setToken('stored-token');
      expect(getToken()).toBe('stored-token');
    });
  });

  describe('clearToken', () => {
    it('removes the token from localStorage', () => {
      setToken('abc123');
      clearToken();
      expect(localStorage.getItem('mv_token')).toBeNull();
    });
  });
});