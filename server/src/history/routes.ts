// GET /api/history — Done History read view (v1.2 spec §1).
// PUT /api/history/:id/note — note any entry (the expanded-row editor).

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, tickNoteSchema, userIdOf, uuidParam } from '../validation.js';
import { listHistory, setHistoryNote } from './service.js';

// limit: default and hard cap 2000 (contract). Out-of-range → standard 400
// validation envelope, same as body validation elsewhere.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).default(2000),
});

export const historyRouter = Router();

historyRouter.use(requireAuth);

historyRouter.get('/', async (req, res) => {
  const { limit } = parseBody(querySchema, req.query);
  res.json({ entries: await listHistory(userIdOf(req), limit) });
});

historyRouter.put('/:id/note', async (req, res) => {
  const { note } = parseBody(tickNoteSchema, req.body);
  const entryId = uuidParam(req.params.id, 'History entry not found');
  res.json(await setHistoryNote(userIdOf(req), entryId, note));
});
