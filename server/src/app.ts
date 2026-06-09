import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './auth/routes.js';
import { HttpError } from './errors.js';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);

  // Central error handler (Express 5 forwards async route errors here automatically).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
