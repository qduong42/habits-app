import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, userIdOf, uuidParam } from '../validation.js';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  setCompletionNote,
  undoCompleteTask,
  updateTask,
} from './service.js';

// Tick note ("+ note" chip): required string, trimmed, ≤2000 like discard
// notes; empty clears to null.
const completionNoteSchema = z.object({ note: z.string().trim().max(2000) });

const nameSchema = z.string().trim().min(1).max(200);
const notesSchema = z.string().max(5000);
const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
// 8760h = one year — anything slower than that isn't a recurring chore.
const intervalSchema = z.number().min(1).max(8760);
// One-off only — the service enforces that against the merged state.
const remindAtSchema = z.iso.datetime();

const MUTUALLY_EXCLUSIVE = 'dueDate and intervalHours are mutually exclusive';

// Exported: POST /inbox/:id/convert-task (inbox/routes.ts) takes the exact
// same body — single source of truth so the two paths can't drift.
export const createTaskSchema = z
  .object({
    name: nameSchema,
    notes: notesSchema.optional(),
    dueDate: dueDateSchema.optional(), // one-off only
    intervalHours: intervalSchema.optional(), // recurring only
    remindAt: remindAtSchema.nullable().optional(), // one-off only
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
  remindAt: remindAtSchema.nullable().optional(),
});

const taskId = (raw: string) => uuidParam(raw, 'Task not found');

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

tasksRouter.put('/:id/completion-note', async (req, res) => {
  const { note } = parseBody(completionNoteSchema, req.body);
  res.json(
    await setCompletionNote(userIdOf(req), taskId(req.params.id), note === '' ? null : note),
  );
});
