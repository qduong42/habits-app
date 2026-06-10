import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  undoCompleteTask,
  updateTask,
} from './service.js';

const nameSchema = z.string().trim().min(1).max(200);
const notesSchema = z.string().max(5000);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
// 8760h = one year — anything slower than that isn't a recurring chore.
const intervalSchema = z.number().min(1).max(8760);

const MUTUALLY_EXCLUSIVE = 'dueDate and intervalHours are mutually exclusive';

// Exported: POST /inbox/:id/convert-task (inbox/routes.ts) takes the exact
// same body — single source of truth so the two paths can't drift.
export const createTaskSchema = z
  .object({
    name: nameSchema,
    notes: notesSchema.optional(),
    dueDate: dueDateSchema.optional(), // one-off only
    intervalHours: intervalSchema.optional(), // recurring only
  })
  .superRefine((v, ctx) => {
    if (v.dueDate !== undefined && v.intervalHours !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['dueDate'], message: MUTUALLY_EXCLUSIVE });
    }
  });

// Nullable fields clear: dueDate null removes the date, intervalHours null
// switches recurring → one-off. The merged-state exclusivity rule lives in
// the service (it depends on the task's current row).
const patchSchema = z.object({
  name: nameSchema.optional(),
  notes: notesSchema.nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  intervalHours: intervalSchema.nullable().optional(),
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
function taskId(raw: string): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Task not found');
  return parsed.data;
}

// requireAuth (mounted router-wide above) guarantees userId; the cast goes via
// unknown because parameterized Request<{id}> doesn't overlap AuthedRequest.
function userIdOf(req: unknown): string {
  return (req as AuthedRequest).userId;
}

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', async (req, res) => {
  // ?all=1 (Task 26): also return not-yet-due tasks as group 'scheduled'.
  const all = req.query.all === '1';
  res.json({ tasks: await listTasks(userIdOf(req), { all }) });
});

tasksRouter.post('/', async (req, res) => {
  const input = parseBody(createTaskSchema, req.body);
  res.status(201).json(await createTask(userIdOf(req), input));
});

tasksRouter.patch('/:id', async (req, res) => {
  const patch = parseBody(patchSchema, req.body);
  res.json(await updateTask(userIdOf(req), taskId(req.params.id), patch));
});

tasksRouter.delete('/:id', async (req, res) => {
  await deleteTask(userIdOf(req), taskId(req.params.id));
  res.json({ ok: true });
});

tasksRouter.post('/:id/complete', async (req, res) => {
  res.json(await completeTask(userIdOf(req), taskId(req.params.id)));
});

tasksRouter.delete('/:id/complete', async (req, res) => {
  res.json(await undoCompleteTask(userIdOf(req), taskId(req.params.id)));
});
