/**
 * Shared reward-transaction building blocks, used by every transaction that
 * touches XP or achievements: habit check-in/undo (habits/service.ts), dump
 * conversion (inbox/service.ts) and task complete/undo (tasks/service.ts).
 *
 * Unlike the rest of game/, these helpers DO run queries — they are the one
 * sanctioned shared-infra seam between the pure gamification functions and
 * the services (plan Task 25; Task 23 only consolidates further).
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  achievements,
  checkins,
  habits,
  inboxItems,
  userAchievements,
  users,
} from '../db/schema.js';
import { dayStreak } from './streaks.js';
import { checkAchievements } from './achievements.js';
import { HttpError } from '../errors.js';

/** A drizzle transaction handle (same query API as `db`). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Achievement contract shape: unlockedAt is non-null for fresh unlocks. */
export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  unlockedAt: string;
}

/**
 * Acquire the user's row lock (SELECT ... FOR UPDATE) for the rest of the
 * transaction. MUST be the FIRST statement of every reward transaction.
 *
 * This lock is load-bearing: it serializes same-user reward transactions so
 * each one sees the prior transaction's inserts/deletes. It guarantees:
 * - day-bonus correctness (two parallel check-ins can't both observe an
 *   "incomplete day minus me" snapshot and both award — or both skip — the
 *   25-point bonus);
 * - achievement thresholds (totalCheckins, conversions, ...) are evaluated
 *   against a serialized count, so threshold crossings fire exactly once;
 * - undo can't double-charge the 25-point day bonus when two undos race;
 * - the userAchievements PK can't be hit by two transactions inserting the
 *   same badge (the conflict-safe insert below is belt-and-braces only).
 *
 * Returns the locked row's xpTotal + timezone so callers don't re-query.
 */
export async function lockUserRow(
  tx: Tx,
  userId: string,
): Promise<{ xpTotal: number; timezone: string }> {
  const [user] = await tx
    .select({ xpTotal: users.xpTotal, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  return user;
}

/** Atomic xp_total adjustment; `delta` may be negative (floored at 0). */
export async function adjustXp(tx: Tx, userId: string, delta: number): Promise<number> {
  const [updated] = await tx
    .update(users)
    .set({ xpTotal: sql`GREATEST(${users.xpTotal} + ${delta}, 0)` })
    .where(eq(users.id, userId))
    .returning({ xpTotal: users.xpTotal });
  return updated!.xpTotal;
}

/**
 * Dump items already converted (into a habit or — from Task 27 — a task).
 * Part of the achievement ctx on every reward event.
 */
export async function conversionsCount(ex: Tx | typeof db, userId: string): Promise<number> {
  const [row] = await ex
    .select({ count: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), eq(inboxItems.status, 'converted')));
  return row!.count;
}

export interface AwardOptions {
  /** Today's local date in the user's timezone. */
  today: string;
  /** Level AFTER the event's XP adjustment (or current level for no-XP events). */
  level: number;
  /** Per-habit streak after the event — only habit check-ins move it. */
  habitStreak?: number;
  /**
   * Pre-loaded habit check-in rows (post-event), to avoid a duplicate query
   * when the caller already has them. Achievements are habit-centric per the
   * catalog: totalCheckins/dayStreak always count habit check-ins, never task
   * completions.
   */
  checkinRows?: { localDate: string }[];
}

/**
 * The shared achievement-unlock block: build the ctx, run the pure checker,
 * insert the new unlocks conflict-safely, and hydrate full Achievement
 * objects from the RETURNED rows only — so a (theoretical) racing unlock
 * never reports a duplicate.
 */
export async function awardAchievements(
  tx: Tx,
  userId: string,
  opts: AwardOptions,
): Promise<UnlockedAchievement[]> {
  const { today, level, habitStreak = 0 } = opts;
  const checkinRows =
    opts.checkinRows ??
    (await tx
      .select({ localDate: checkins.localDate })
      .from(checkins)
      .where(eq(checkins.userId, userId)));
  const todayCategoryRows = await tx
    .selectDistinct({ categoryId: habits.categoryId })
    .from(checkins)
    .innerJoin(habits, eq(checkins.habitId, habits.id))
    .where(and(eq(checkins.userId, userId), eq(checkins.localDate, today)));
  const unlockedRows = await tx
    .select({ achievementId: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));

  const newIds = checkAchievements({
    totalCheckins: checkinRows.length,
    habitStreak,
    dayStreak: dayStreak(new Set(checkinRows.map((r) => r.localDate)), today),
    level,
    conversions: await conversionsCount(tx, userId),
    categoriesToday: todayCategoryRows.length,
    unlocked: new Set(unlockedRows.map((r) => r.achievementId)),
  });
  if (newIds.length === 0) return [];

  const inserted = await tx
    .insert(userAchievements)
    .values(newIds.map((achievementId) => ({ userId, achievementId })))
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return [];
  const defs = await tx
    .select()
    .from(achievements)
    .where(
      inArray(
        achievements.id,
        inserted.map((r) => r.achievementId),
      ),
    );
  const defById = new Map(defs.map((d) => [d.id, d]));
  return inserted.map((r) => {
    const def = defById.get(r.achievementId)!; // FK guarantees the catalog row exists
    return {
      id: r.achievementId,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      unlockedAt: r.unlockedAt.toISOString(),
    };
  });
}
