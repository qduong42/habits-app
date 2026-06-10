// Done History (v1.2 spec §1): read-only merged timeline over the existing
// checkins + task_completions tables — approach A, NO event table. Names come
// from a live join, so renames rewrite old entries and cascade deletes erase
// them (accepted limitations / promotion triggers, per new_features.md).

import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { checkins, habits, taskCompletions, tasks } from '../db/schema.js';

export interface HistoryEntry {
  id: string;
  kind: 'checkin' | 'completion';
  name: string;
  localDate: string;
  createdAt: string; // ISO
}

/**
 * Newest-createdAt-first merge of the caller's check-ins and task
 * completions. Two indexed per-user queries (each already capped at `limit` —
 * the merged list can't need more than `limit` rows from either side) merged
 * and sliced in TS; with the 2000 hard cap a UNION ALL buys nothing.
 */
export async function listHistory(userId: string, limit: number): Promise<HistoryEntry[]> {
  const [checkinRows, completionRows] = await Promise.all([
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
  ]);

  return [
    ...checkinRows.map((r) => ({ ...r, kind: 'checkin' as const })),
    ...completionRows.map((r) => ({ ...r, kind: 'completion' as const })),
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
