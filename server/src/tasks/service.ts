import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskCompletions, tasks, users } from '../db/schema.js';
import type { Task } from '../db/schema.js';
import { localDateFor } from '../game/dates.js';
import { levelFromXp, TASK_COMPLETION_XP } from '../game/xp.js';
import { dueLabel, taskGroup } from '../game/dueness.js';
import type { TaskContractGroup } from '../game/dueness.js';
import { adjustXp, awardAchievements, lockUserRow } from '../game/rewards.js';
import type { Tx, UnlockedAchievement } from '../game/rewards.js';
import { HttpError } from '../errors.js';

const HOUR_MS = 3_600_000;

const notFound = () => new HttpError(404, 'not_found', 'Task not found');

/**
 * Shared API contract shape (plan: "Shared API contracts", extended in Task
 * 26): the API never emits the internal `'hidden'` group. Not-yet-due tasks
 * (freshly created recurring, future-dated one-offs) surface as
 * `group: 'scheduled'` — excluded from the default GET /tasks, included by
 * `?all=1`, and always visible on POST/PATCH responses. One-offs completed on
 * a past day are terminal history and never listed.
 */
export interface TaskItemContract {
  id: string;
  name: string;
  notes: string | null;
  sourceUrl: string | null;
  kind: 'oneoff' | 'recurring';
  group: TaskContractGroup;
  dueLabel: string | null;
  dueDate: string | null;
  intervalHours: number | null;
  nextDue: string | null;
}

export interface CreateTaskInput {
  name: string;
  notes?: string;
  dueDate?: string; // YYYY-MM-DD, one-off only
  intervalHours?: number; // >= 1, recurring only
}

export interface UpdateTaskInput {
  name?: string;
  notes?: string | null;
  dueDate?: string | null;
  intervalHours?: number | null; // null switches recurring → one-off
}

/** POST /tasks/:id/complete contract (plan: "Shared API contracts"). */
export interface CompleteResult {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  nextDue: string | null; // recurring only; null for one-offs
  unlockedAchievements: UnlockedAchievement[];
}

/** DELETE /tasks/:id/complete — same shape as the habit check-in undo. */
export interface UndoCompleteResult {
  ok: true;
  xpLost: number;
  xpTotal: number;
  level: number;
}

type DbOrTx = typeof db | Tx;

const kindOf = (task: Task): 'oneoff' | 'recurring' =>
  task.intervalHours !== null ? 'recurring' : 'oneoff';

function toContract(
  task: Task,
  latestCompletionLocalDate: string | null,
  now: Date,
  today: string,
  tz: string,
): TaskItemContract {
  const kind = kindOf(task);
  const rawGroup = taskGroup(
    {
      kind,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
      intervalHours: task.intervalHours,
      nextDue: task.nextDue,
      latestCompletionLocalDate,
    },
    now,
    today,
    tz,
  );
  // Internal 'hidden' → contract 'scheduled' (not yet due). The other hidden
  // case — one-offs completed on a past day — is filtered out by listTasks
  // before this mapping matters and is unreachable from create/update (both
  // reject terminally-completed tasks).
  const group: TaskContractGroup = rawGroup === 'hidden' ? 'scheduled' : rawGroup;
  return {
    id: task.id,
    name: task.name,
    notes: task.notes,
    sourceUrl: task.sourceUrl,
    kind,
    group,
    // dueLabel dispatches on nextDue presence — pass it for recurring only.
    dueLabel: dueLabel(
      group,
      kind === 'recurring' ? { nextDue: task.nextDue } : { dueDate: task.dueDate },
      now,
      tz,
    ),
    dueDate: task.dueDate,
    intervalHours: task.intervalHours,
    nextDue: task.nextDue ? task.nextDue.toISOString() : null,
  };
}

async function userTz(userId: string, ex: DbOrTx = db): Promise<string> {
  const [user] = await ex
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  return user.timezone;
}

async function ownedTask(ex: DbOrTx, userId: string, taskId: string): Promise<Task> {
  const [task] = await ex
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  if (!task) throw notFound();
  return task;
}

/** The most recent completion (by creation time) of one recurring task. */
async function latestCompletion(ex: DbOrTx, taskId: string) {
  const [row] = await ex
    .select()
    .from(taskCompletions)
    .where(eq(taskCompletions.taskId, taskId))
    .orderBy(desc(taskCompletions.createdAt), desc(taskCompletions.id))
    .limit(1);
  return row ?? null;
}

const GROUP_ORDER: Record<TaskContractGroup, number> = {
  overdue: 0,
  today: 1,
  undated: 2,
  done: 3,
  scheduled: 4, // ?all=1 only — appended after everything actionable/done
};

/** Due instant for within-group ordering: soonest-due first, then creation. */
function dueInstantMs(task: Task): number {
  if (task.nextDue) return task.nextDue.getTime();
  if (task.dueDate) return Date.parse(`${task.dueDate}T00:00:00Z`);
  return Number.POSITIVE_INFINITY;
}

export interface ListTasksOptions {
  /** Include not-yet-due tasks as group 'scheduled' (GET /tasks?all=1). */
  all?: boolean;
}

export async function listTasks(
  userId: string,
  { all = false }: ListTasksOptions = {},
): Promise<TaskItemContract[]> {
  const tz = await userTz(userId);
  const now = new Date();
  const today = localDateFor(tz, now);

  const rows = await db.select().from(tasks).where(eq(tasks.userId, userId));
  // Latest completion localDate per task (newest row first wins).
  const completionRows = await db
    .select({
      taskId: taskCompletions.taskId,
      localDate: taskCompletions.localDate,
    })
    .from(taskCompletions)
    .where(eq(taskCompletions.userId, userId))
    .orderBy(desc(taskCompletions.createdAt), desc(taskCompletions.id));
  const latestLocalDateByTask = new Map<string, string>();
  for (const c of completionRows) {
    if (!latestLocalDateByTask.has(c.taskId)) latestLocalDateByTask.set(c.taskId, c.localDate);
  }

  return rows
    .map((task) => ({
      task,
      item: toContract(task, latestLocalDateByTask.get(task.id) ?? null, now, today, tz),
    }))
    .filter(({ task, item }) => {
      // One-offs completed on a past day are terminal history — never listed
      // (toContract would have mislabeled them 'scheduled'; see its comment).
      if (task.completedAt !== null && item.group !== 'done') return false;
      return all || item.group !== 'scheduled';
    })
    .sort((a, b) => {
      const byGroup = GROUP_ORDER[a.item.group] - GROUP_ORDER[b.item.group];
      if (byGroup !== 0) return byGroup;
      const byDue = dueInstantMs(a.task) - dueInstantMs(b.task);
      if (byDue !== 0) return byDue;
      return a.task.createdAt.getTime() - b.task.createdAt.getTime();
    })
    .map(({ item }) => item);
}

export async function createTask(
  userId: string,
  input: CreateTaskInput,
): Promise<TaskItemContract> {
  const tz = await userTz(userId);
  const now = new Date();
  const recurring = input.intervalHours !== undefined;
  const [created] = await db
    .insert(tasks)
    .values({
      userId,
      name: input.name,
      notes: input.notes ?? null,
      dueDate: recurring ? null : (input.dueDate ?? null),
      intervalHours: recurring ? input.intervalHours! : null,
      // recurring: due one interval from creation (spec data model)
      nextDue: recurring ? new Date(now.getTime() + input.intervalHours! * HOUR_MS) : null,
    })
    .returning();
  return toContract(created!, null, now, localDateFor(tz, now), tz);
}

export async function updateTask(
  userId: string,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<TaskItemContract> {
  const tz = await userTz(userId);
  const now = new Date();
  const task = await ownedTask(db, userId, taskId);
  // Completed one-offs are terminal — gone from every list, so 404 for edits.
  if (task.completedAt !== null) throw notFound();

  // Cross-field rule against the effective (merged) state, like habit PATCH:
  // a task is either dated one-off or recurring, never both.
  const intervalHours =
    patch.intervalHours !== undefined ? patch.intervalHours : task.intervalHours;
  const dueDate = patch.dueDate !== undefined ? patch.dueDate : task.dueDate;
  if (intervalHours !== null && dueDate !== null) {
    throw new HttpError(
      400,
      'validation',
      'dueDate and intervalHours are mutually exclusive — clear one of them',
    );
  }

  let nextDue: Date | null;
  if (intervalHours === null) {
    nextDue = null; // recurring → one-off clears the schedule
  } else if (task.intervalHours === null) {
    // one-off → recurring: the clock starts now, not at task creation.
    nextDue = new Date(now.getTime() + intervalHours * HOUR_MS);
  } else if (intervalHours !== task.intervalHours) {
    // interval changed: re-anchor on the last completion (or creation),
    // consistent with the undo recomputation and ADR-0001's reset model.
    const latest = await latestCompletion(db, taskId);
    nextDue = new Date((latest?.createdAt ?? task.createdAt).getTime() + intervalHours * HOUR_MS);
  } else {
    nextDue = task.nextDue;
  }

  const [updated] = await db
    .update(tasks)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      dueDate,
      intervalHours,
      nextDue,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  const latest = updated!.intervalHours !== null ? await latestCompletion(db, taskId) : null;
  return toContract(updated!, latest?.localDate ?? null, now, localDateFor(tz, now), tz);
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  // task_completions cascade via FK onDelete: 'cascade'
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning({ id: tasks.id });
  if (deleted.length === 0) throw notFound();
}

/**
 * Task Completion Flow (spec) — one transaction, mirroring the check-in:
 * one-off: set completedAt (409 when already done); recurring: insert a
 * completion row and reset nextDue = now + interval. Both: +5 XP and the
 * shared achievement check. Recurring tasks are completable regardless of
 * dueness — the server doesn't gate on visibility (a sub-daily task can be
 * knocked out early; ADR-0001's reset model just starts the clock from now).
 */
export async function completeTask(userId: string, taskId: string): Promise<CompleteResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST (rewards.ts lockUserRow comment explains why).
    const user = await lockUserRow(tx, userId);
    const task = await ownedTask(tx, userId, taskId);
    const now = new Date();
    const today = localDateFor(user.timezone, now);

    let nextDue: Date | null = null;
    if (task.intervalHours !== null) {
      await tx.insert(taskCompletions).values({ taskId, userId, localDate: today });
      nextDue = new Date(now.getTime() + task.intervalHours * HOUR_MS);
      await tx.update(tasks).set({ nextDue }).where(eq(tasks.id, taskId));
    } else {
      if (task.completedAt !== null) {
        throw new HttpError(409, 'already_done', 'Task is already completed');
      }
      await tx.update(tasks).set({ completedAt: now }).where(eq(tasks.id, taskId));
    }

    const xpGained = TASK_COMPLETION_XP;
    const xpTotal = await adjustXp(tx, userId, xpGained);
    const level = levelFromXp(xpTotal);
    const leveledUp = level > levelFromXp(xpTotal - xpGained);

    // Achievements stay habit-centric (totalCheckins/dayStreak count habit
    // check-ins, not task completions) — but task XP can cross level
    // thresholds, so the check runs with the post-increment level.
    const unlockedAchievements = await awardAchievements(tx, userId, { today, level });

    return {
      xpGained,
      xpTotal,
      level,
      leveledUp,
      nextDue: nextDue ? nextDue.toISOString() : null,
      unlockedAchievements,
    };
  });
}

/**
 * Same-local-day undo (spec: past days are immutable). One-off: clear
 * completedAt. Recurring: delete the latest completion and re-anchor nextDue
 * on the completion that is now latest (createdAt + interval), or on task
 * creation + interval when none remain. XP −5 (floored at 0 by adjustXp);
 * achievements are one-way and never revoked.
 */
export async function undoCompleteTask(
  userId: string,
  taskId: string,
): Promise<UndoCompleteResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST (rewards.ts lockUserRow comment explains why).
    const user = await lockUserRow(tx, userId);
    const task = await ownedTask(tx, userId, taskId);
    const today = localDateFor(user.timezone);
    const nothingToUndo = () => new HttpError(404, 'not_found', 'No completion today to undo');

    if (task.intervalHours !== null) {
      const latest = await latestCompletion(tx, taskId);
      if (!latest || latest.localDate !== today) throw nothingToUndo();
      await tx.delete(taskCompletions).where(eq(taskCompletions.id, latest.id));
      const previous = await latestCompletion(tx, taskId);
      const anchor = previous?.createdAt ?? task.createdAt;
      await tx
        .update(tasks)
        .set({ nextDue: new Date(anchor.getTime() + task.intervalHours * HOUR_MS) })
        .where(eq(tasks.id, taskId));
    } else {
      if (task.completedAt === null || localDateFor(user.timezone, task.completedAt) !== today) {
        throw nothingToUndo(); // never completed, or completed on a past day (terminal)
      }
      await tx.update(tasks).set({ completedAt: null }).where(eq(tasks.id, taskId));
    }

    const xpLost = TASK_COMPLETION_XP;
    const xpTotal = await adjustXp(tx, userId, -xpLost);
    return { ok: true, xpLost, xpTotal, level: levelFromXp(xpTotal) };
  });
}
