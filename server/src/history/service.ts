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
import { HttpError } from '../errors.js';

export interface HistoryEntry {
  id: string;
  kind: 'checkin' | 'completion';
  name: string;
  localDate: string;
  createdAt: string; // ISO
  /** Optional tick note ("climbing 1 hr"). */
  note: string | null;
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
        note: checkins.note,
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
        note: taskCompletions.note,
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
        note: tasks.completionNote,
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
      note: r.note,
      kind: 'completion' as const,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map(({ id, kind, name, localDate, createdAt, note }) => ({
      id,
      kind,
      name,
      localDate,
      createdAt: createdAt.toISOString(),
      note,
    }));
}

/**
 * Set/edit/clear the note on ANY of the caller's history entries by entry id
 * (the History UI's expanded editor — unlike the today-only row endpoints).
 * The id is resolved across the three sources in order; ownership rides on
 * each table's userId. One-off entry ids are task ids and require a recorded
 * completion. No match anywhere → 404.
 */
export async function setHistoryNote(
  userId: string,
  entryId: string,
  note: string | null,
): Promise<{ note: string | null }> {
  const checkinHit = await db
    .update(checkins)
    .set({ note })
    .where(and(eq(checkins.id, entryId), eq(checkins.userId, userId)))
    .returning({ note: checkins.note });
  if (checkinHit.length > 0) return { note: checkinHit[0]!.note };

  const completionHit = await db
    .update(taskCompletions)
    .set({ note })
    .where(and(eq(taskCompletions.id, entryId), eq(taskCompletions.userId, userId)))
    .returning({ note: taskCompletions.note });
  if (completionHit.length > 0) return { note: completionHit[0]!.note };

  const oneOffHit = await db
    .update(tasks)
    .set({ completionNote: note })
    .where(and(eq(tasks.id, entryId), eq(tasks.userId, userId), isNotNull(tasks.completedAt)))
    .returning({ note: tasks.completionNote });
  if (oneOffHit.length > 0) return { note: oneOffHit[0]!.note };

  throw new HttpError(404, 'nothing_to_note', 'History entry not found');
}
