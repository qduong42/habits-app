import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../errors.js';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET required in production');
}

export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export interface AuthedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    next(new HttpError(401, 'unauthenticated', 'Login required'));
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null || typeof payload.sub !== 'string') {
      throw new Error('invalid payload');
    }
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, 'unauthenticated', 'Invalid session'));
  }
}
