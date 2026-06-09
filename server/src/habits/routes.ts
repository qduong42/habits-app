import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  archiveHabit,
  checkinHabit,
  createHabit,
  deleteHabit,
  listHabits,
  undoCheckin,
  updateHabit,
} from './service.js';

const weeklyTargetSchema = z.number().int().min(1).max(7);

const createSchema = z
  .object({
    name: z.string().trim().min(1),
    categoryId: z.uuid(),
    frequencyType: z.enum(['daily', 'weekly']),
    weeklyTarget: weeklyTargetSchema.optional(),
    notes: z.string().optional(),
    sourceUrl: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Strict cross-field rule (documented choice: reject, don't strip):
    // weekly requires a target, daily must not carry one.
    if (v.frequencyType === 'weekly' && v.weeklyTarget === undefined) {
      ctx.addIssue({ code: 'custom', path: ['weeklyTarget'], message: 'required for weekly habits' });
    }
    if (v.frequencyType === 'daily' && v.weeklyTarget !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['weeklyTarget'], message: 'not allowed for daily habits' });
    }
  });

// Cross-field rules for PATCH depend on the habit's current state — enforced
// in the service against the merged result.
const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  categoryId: z.uuid().optional(),
  frequencyType: z.enum(['daily', 'weekly']).optional(),
  weeklyTarget: weeklyTargetSchema.optional(),
  notes: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
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
function habitId(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Habit not found');
  return parsed.data;
}

// requireAuth (mounted router-wide above) guarantees userId; the cast goes via
// unknown because parameterized Request<{id}> doesn't overlap AuthedRequest.
function userIdOf(req: unknown): string {
  return (req as AuthedRequest).userId;
}

export const habitsRouter = Router();

habitsRouter.use(requireAuth);

habitsRouter.get('/', async (req, res) => {
  res.json(await listHabits(userIdOf(req)));
});

habitsRouter.post('/', async (req, res) => {
  const input = parseBody(createSchema, req.body);
  res.status(201).json(await createHabit(userIdOf(req), input));
});

habitsRouter.patch('/:id', async (req, res) => {
  const patch = parseBody(patchSchema, req.body);
  res.json(await updateHabit(userIdOf(req), habitId(req.params.id), patch));
});

habitsRouter.post('/:id/archive', async (req, res) => {
  await archiveHabit(userIdOf(req), habitId(req.params.id));
  res.json({ ok: true });
});

habitsRouter.delete('/:id', async (req, res) => {
  await deleteHabit(userIdOf(req), habitId(req.params.id));
  res.json({ ok: true });
});

habitsRouter.post('/:id/checkin', async (req, res) => {
  res.json(await checkinHabit(userIdOf(req), habitId(req.params.id)));
});

habitsRouter.delete('/:id/checkin', async (req, res) => {
  // {ok, xpLost, xpTotal, level} — additive over the original {ok: true}
  res.json(await undoCheckin(userIdOf(req), habitId(req.params.id)));
});
