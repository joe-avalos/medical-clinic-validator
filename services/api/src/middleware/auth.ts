import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtClaims } from '@medical-validator/shared';

const VALID_SCOPES = ['internal', 'external'];

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[AUTH] JWT_SECRET environment variable not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, unknown>;

    if (!decoded.sub || !decoded.scope || !decoded.org) {
      res.status(401).json({ error: 'Token missing required claims' });
      return;
    }

    if (!VALID_SCOPES.includes(decoded.scope as string)) {
      res.status(401).json({ error: 'Invalid scope claim' });
      return;
    }

    req.user = decoded as JwtClaims;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}