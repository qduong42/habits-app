import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { captureItem, convertItem, discardItem, listItems } from './service.js';

const captureSchema = z.object({
  text: z.string().trim().min(1),
  sourceUrl: z.string().optional(),
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

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

// Express 5: an invalid uuid reaching a pg uuid column throws — validate the
// param up front and map straight to the 404 envelope (not a 500).
function itemId(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Inbox item not found');
  return parsed.data;
}

// requireAuth (mounted router-wide above) guarantees userId; the cast goes via
// unknown because parameterized Request<{id}> doesn't overlap AuthedRequest.
function userIdOf(req: unknown): string {
  return (req as AuthedRequest).userId;
}

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

inboxRouter.post('/:id/discard', async (req, res) => {
  res.json(await discardItem(userIdOf(req), itemId(req.params.id)));
});
