import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { createCategory, listCategories } from './service.js';

const createSchema = z.object({
  name: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color'),
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

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get('/', async (req, res) => {
  res.json(await listCategories((req as AuthedRequest).userId));
});

categoriesRouter.post('/', async (req, res) => {
  const input = parseBody(createSchema, req.body);
  res.status(201).json(await createCategory((req as AuthedRequest).userId, input));
});
