import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createToken, createExpiredToken, JWT_SECRET } from '../../test-utils/fixtures.js';

// Mock logger
vi.mock('../../shared/logger.js', () => {
  const noop = vi.fn();
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => childLogger };
  return { createLogger: () => childLogger };
});

// Set JWT_SECRET env before importing auth middleware
process.env.JWT_SECRET = JWT_SECRET;

describe('auth middleware', () => {
  let app: express.Express;
  let authMiddleware: (req: Request, res: Response, next: NextFunction) => void;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../auth.js');
    authMiddleware = mod.authMiddleware;

    app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.get('/test', (req: Request, res: Response) => {
      res.json({ user: (req as any).user });
    });
  });

  // ── Missing / malformed token ────────────────────────────────────

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is empty string', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid JWT', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  // ── Expired token ────────────────────────────────────────────────

  it('returns 401 when token is expired', async () => {
    const token = createExpiredToken();
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Algorithm confusion ─────────────────────────────────────────

  it('returns 401 when token uses alg: none', async () => {
    // Manually craft a token with alg: none (no signature)
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user_1', scope: 'internal', org: 'org', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const token = `${header}.${payload}.`;
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Missing required claims ────────────────────────────────────

  it('returns 401 when token is missing sub claim', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { scope: 'internal', org: 'org' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is missing scope claim', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { sub: 'user_1', org: 'org' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when scope claim has invalid value', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { sub: 'user_1', scope: 'admin', org: 'org' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Wrong signing key ────────────────────────────────────────────

  it('returns 401 when token is signed with wrong secret', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { sub: 'user_1', scope: 'internal', org: 'org' },
      'wrong-secret',
    );
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Valid token ──────────────────────────────────────────────────

  it('calls next() and attaches user claims on valid token', async () => {
    const token = createToken({ sub: 'user_abc', scope: 'internal', org: 'acme-health' });
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      sub: 'user_abc',
      scope: 'internal',
      org: 'acme-health',
    });
  });

  it('attaches external scope from token claims', async () => {
    const token = createToken({ scope: 'external' });
    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.scope).toBe('external');
  });

  // ── Error response shape ─────────────────────────────────────────

  it('returns JSON error body on 401', async () => {
    const res = await request(app).get('/test');
    expect(res.body).toHaveProperty('error');
  });
});