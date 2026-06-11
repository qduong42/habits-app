// Done History (v1.2 spec §1): read-only merged timeline over the existing
// tables — approach A, NO event table. Three sources: checkins,
// task_completions (recurring tasks), and tasks.completedAt (one-offs record
// doneness there, never as a completion row — QA gap #1, fixed read-side so
// undo, which clears completedAt, keeps the view consistent for free).
// Names come from a live join, so renames rewrite old entries and cascade
// deletes erase them (accepted limitations / promotion triggers).

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { checkins, habits, taskCompletions, tasks, users } from '../db/schema.js';
import { localDateFor } from '../game/dates.js';

export interface HistoryEntry {
  id: string;
  kind: 'checkin' | 'completion';
  name: string;
  localDate: string;
  createdAt: string; // ISO
}

/**
 * Newest-createdAt-first merge of the caller's check-ins and task
 * completions. Three indexed per-user queries (each already capped at `limit`
 * — the merged list can't need more than `limit` rows from any side) merged
 * and sliced in TS; with the 2000 hard cap a UNION ALL buys nothing.
 *
 * One-off doneness lives on tasks.completedAt (only one-offs ever set it),
 * which has no stored localDate — it's derived from the user's timezone here,
 * the same `localDateFor` the write paths use.
 */
export async function listHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
  const [checkinRows, completionRows, oneOffRows, [user]] = await Promise.all([
    db
      .select({
        id: checkins.id,
        name: habits.name,
        localDate: checkins.localDate,
        createdAt: checkins.createdAt,
      })
      .from(checkins)
      .innerJoin(habits, eq(checkins.habitId, habits.id))
      .where(eq(checkins.userId, userId))
      .orderBy(desc(checkins.createdAt))
      .limit(limit),
    db
      .select({
        id: taskCompletions.id,
        name: tasks.name,
        localDate: taskCompletions.localDate,
        createdAt: taskCompletions.createdAt,
      })
      .from(taskCompletions)
      .innerJoin(tasks, eq(taskCompletions.taskId, tasks.id))
      .where(eq(taskCompletions.userId, userId))
      .orderBy(desc(taskCompletions.createdAt))
      .limit(limit),
    db
      .select({
        id: tasks.id,
        name: tasks.name,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNotNull(tasks.completedAt)))
      .orderBy(desc(tasks.completedAt))
      .limit(limit),
    db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)),
  ]);

  const tz = user!.timezone;

  return [
    ...checkinRows.map((r) => ({ ...r, kind: 'checkin' as const })),
    ...completionRows.map((r) => ({ ...r, kind: 'completion' as const })),
    ...oneOffRows.map((r) => ({
      id: r.id,
      name: r.name,
      localDate: localDateFor(tz, r.completedAt!),
      createdAt: r.completedAt!,
      kind: 'completion' as const,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(({ id, kind, name, localDate, createdAt }) => ({
      id,
      kind,
      name,
      localDate,
      createdAt: createdAt.toISOString(),
    }));
}
