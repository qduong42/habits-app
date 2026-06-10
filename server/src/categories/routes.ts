import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, userIdOf } from '../validation.js';
import { createCategory, listCategories } from './service.js';

const createSchema = z.object({
  name: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb hex color'),
});

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

categoriesRouter.get('/', async (req, res) => {
  res.json(await listCategories(userIdOf(req)));
});

categoriesRouter.post('/', async (req, res) => {
  const input = parseBody(createSchema, req.body);
  res.status(201).json(await createCategory(userIdOf(req), input));
});
