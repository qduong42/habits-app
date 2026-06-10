// GET /api/stats — overall + per-habit aggregates per the shared contract.

import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { getStats } from './service.js';

export const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get('/', async (req, res) => {
  res.json(await getStats((req as AuthedRequest).userId));
});
