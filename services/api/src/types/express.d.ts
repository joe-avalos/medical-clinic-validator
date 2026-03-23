import type { JwtClaims } from '@medical-validator/shared';

declare global {
  namespace Express {
    interface Request {
      user?: JwtClaims;
    }
  }
}