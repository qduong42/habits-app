import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, userIdOf, uuidParam } from '../validation.js';
import { createTaskSchema } from '../tasks/routes.js';
import {
  captureItem,
  clearHistory,
  convertItem,
  convertItemToTask,
  deleteHistoryItem,
  discardItem,
  listItems,
} from './service.js';

const captureSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  sourceUrl: z.string().max(2000).optional(),
});

// Same field rules as POST /habits (habits/routes.ts createSchema) minus
// sourceUrl — the URL carries over from the dump item, never from the client.
const convertSchema = z
  .object({
    name: z.string().trim().min(1),
    categoryId: z.uuid(),
    frequencyType: z.enum(['daily', 'weekly']),
    weeklyTarget: z.number().int().min(1).max(7).optional(),
    notes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.frequencyType === 'weekly' && v.weeklyTarget === undefined) {
      ctx.addIssue({ code: 'custom', path: ['weeklyTarget'], message: 'required for weekly habits' });
    }
    if (v.frequencyType === 'daily' && v.weeklyTarget !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['weeklyTarget'], message: 'not allowed for daily habits' });
    }
  });

// Optional body — supertest/fetch may send no body at all (req.body
// undefined), `{}`, or `{note}`. Empty/whitespace notes normalize to null
// ("Enter with empty input = discard without note").
const discardSchema = z
  .object({ note: z.string().trim().max(2000).optional() })
  .optional();

// History day-group clear (v1.1 follow-up) — the client sends the exact ids
// of one date group. 500 caps the IN-list; a day can't realistically exceed it.
const clearSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500) });

const itemId = (raw: string) => uuidParam(raw, 'Inbox item not found');

export const inboxRouter = Router();

inboxRouter.use(requireAuth);

inboxRouter.post('/', async (req, res) => {
  const input = parseBody(captureSchema, req.body);
  res.status(201).json(await captureItem(userIdOf(req), input));
});

inboxRouter.get('/', async (req, res) => {
  res.json(await listItems(userIdOf(req), req.query.all === '1'));
});

inboxRouter.post('/:id/convert', async (req, res) => {
  const input = parseBody(convertSchema, req.body);
  res.json(await convertItem(userIdOf(req), itemId(req.params.id), input));
});

// Same body rules as POST /tasks (shared schema): name ≤200, notes ≤5000,
// dueDate XOR intervalHours. sourceUrl carries over from the item, never
// from the client (createTaskSchema has no sourceUrl field).
inboxRouter.post('/:id/convert-task', async (req, res) => {
  const input = parseBody(createTaskSchema, req.body);
  res.json(await convertItemToTask(userIdOf(req), itemId(req.params.id), input));
});

// Clear a History day group — deletes the caller's non-open items among ids,
// ignoring open/foreign/missing ones. Registered before the /:id routes so
// the literal path can never be shadowed by a param route.
inboxRouter.post('/history/clear', async (req, res) => {
  const { ids } = parseBody(clearSchema, req.body);
  res.json({ deleted: await clearHistory(userIdOf(req), ids) });
});

// Clear one History item — non-open only (open items go through Discard);
// open → 409 still_open, foreign/missing → 404.
inboxRouter.delete('/:id', async (req, res) => {
  await deleteHistoryItem(userIdOf(req), itemId(req.params.id));
  res.json({ ok: true });
});

inboxRouter.post('/:id/discard', async (req, res) => {
  const body = parseBody(discardSchema, req.body);
  const note = body?.note || null; // zod trimmed; '' (empty/whitespace) → null
  res.json(await discardItem(userIdOf(req), itemId(req.params.id), note));
});
