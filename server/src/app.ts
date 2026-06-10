import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { achievementsRouter } from './achievements/routes.js';
import { authRouter } from './auth/routes.js';
import { categoriesRouter } from './categories/routes.js';
import { habitsRouter } from './habits/routes.js';
import { inboxRouter } from './inbox/routes.js';
import { statsRouter } from './stats/routes.js';
import { tasksRouter } from './tasks/routes.js';
import { HttpError } from './errors.js';

// Resolves to <repo>/web/dist both from src/ (tsx) and from dist/ (compiled).
const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/habits', habitsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/achievements', achievementsRouter);
  app.use('/api/inbox', inboxRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/stats', statsRouter);

  // Mount all /api routers above this JSON 404 catch-all.
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found')));

  // Frontend is built as static files and served by Express in production
  // (per spec). Gated behind NODE_ENV=production or SERVE_STATIC=1 so test
  // runs (supertest) stay deterministic even when a local web/dist build
  // exists. Mounted AFTER the /api routers and the JSON /api 404 catch-all
  // so /api/* always gets JSON, never index.html.
  const serveStatic =
    process.env.NODE_ENV === 'production' || process.env.SERVE_STATIC === '1';
  if (serveStatic && existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // SPA fallback. Express 5 dropped the bare '*' wildcard route syntax, so
    // a plain middleware that filters method/path is the simplest correct
    // fallback: any GET outside /api gets index.html (hash router takes over).
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  // Central error handler (Express 5 forwards async route errors here automatically).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
