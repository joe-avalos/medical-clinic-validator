import jwt from 'jsonwebtoken';
import type { JwtClaims } from '@medical-validator/shared';

export const JWT_SECRET = 'test-secret-key-for-unit-tests';

export function createToken(overrides: Partial<JwtClaims> = {}): string {
  const claims: JwtClaims = {
    sub: 'user_test123',
    scope: 'internal',
    org: 'test-health-org',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  return jwt.sign(claims, JWT_SECRET);
}

export function createExpiredToken(overrides: Partial<JwtClaims> = {}): string {
  const past = Math.floor(Date.now() / 1000) - 7200;
  return createToken({
    iat: past,
    exp: past + 3600,
    ...overrides,
  });
}