/**
 * Daily nudge (spec "Daily Nudge Flow"): count today's open work and send one
 * web-push notification — "🔥 N habits · M tasks left today" — when there is
 * any and the user has a push subscription.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks, users } from '../db/schema.js';
import type { User } from '../db/schema.js';
import { localDateFor } from '../game/dates.js';
import { taskGroup } from '../game/dueness.js';
import { loadRewardState, openScheduledCount } from '../habits/service.js';
import { configuredWebpush, pushEnabled } from './vapid.js';

/**
 * Scheduled-but-not-done active habits today — the EXACT day-bonus semantics
 * (habits/service.ts openScheduledCount): daily habits always count unless
 * done today; weekly habits count while under target and not done today.
 */
export async function openHabitsCount(userId: string, today: string): Promise<number> {
  const { activeHabits, datesByHabit } = await loadRewardState(db, userId);
  return openScheduledCount(activeHabits, datesByHabit, today);
}

/**
 * Tasks currently demanding attention: groups `overdue` | `today` per
 * game/dueness.ts. Terminal one-offs (done/hidden), undated and not-yet-due
 * (scheduled/hidden) tasks are excluded — undated tasks have no deadline to
 * nag about. latestCompletionLocalDate only disambiguates done-vs-hidden,
 * never overdue/today, so the completions table is not consulted.
 */
export async function dueTasksCount(
  userId: string,
  now: Date,
  today: string,
  tz: string,
): Promise<number> {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, userId));
  let count = 0;
  for (const task of rows) {
    const group = taskGroup(
      {
        kind: task.intervalHours !== null ? 'recurring' : 'oneoff',
        dueDate: task.dueDate,
        completedAt: task.completedAt,
        intervalHours: task.intervalHours,
        nextDue: task.nextDue,
        latestCompletionLocalDate: null,
      },
      now,
      today,
      tz,
    );
    if (group === 'overdue' || group === 'today') count += 1;
  }
  return count;
}

/** "🔥 2 habits · 1 task left today" — zero parts omitted; null when all zero. */
export function nudgeTitle(openHabits: number, dueTasks: number): string | null {
  const parts: string[] = [];
  if (openHabits > 0) parts.push(`${openHabits} habit${openHabits === 1 ? '' : 's'}`);
  if (dueTasks > 0) parts.push(`${dueTasks} task${dueTasks === 1 ? '' : 's'}`);
  if (parts.length === 0) return null;
  return `🔥 ${parts.join(' · ')} left today`;
}

/** The slice of web-push that sendNudge uses — injectable for tests. */
export interface WebPushLike {
  sendNotification(
    subscription: NonNullable<User['pushSubscription']>,
    payload: string,
  ): Promise<unknown>;
}

export interface NudgeDeps {
  webpush: WebPushLike;
  enabled: boolean;
}

export type NudgeUser = Pick<User, 'id' | 'timezone' | 'pushSubscription'>;

/**
 * Send today's nudge to one user. No-ops when push is disabled (missing
 * VAPID keys — warns via vapid.ts), when the user has no subscription, or
 * when nothing is open. A 410/404 from the push service means the
 * subscription is dead: clear it so we stop trying.
 */
export async function sendNudge(user: NudgeUser, deps?: NudgeDeps): Promise<void> {
  const enabled = deps?.enabled ?? pushEnabled();
  if (!enabled) {
    console.warn(`[push] nudge for user ${user.id} skipped — push disabled (no VAPID keys)`);
    return;
  }
  if (!user.pushSubscription) return;

  const now = new Date();
  const today = localDateFor(user.timezone, now);
  const title = nudgeTitle(
    await openHabitsCount(user.id, today),
    await dueTasksCount(user.id, now, today, user.timezone),
  );
  if (title === null) return;

  const webpush = deps?.webpush ?? configuredWebpush();
  try {
    // Tapping the notification opens the PWA on the Today tab (url '/').
    await webpush.sendNotification(user.pushSubscription, JSON.stringify({ title, url: '/' }));
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 410 || statusCode === 404) {
      // Subscription expired or unsubscribed at the push service — forget it.
      await db.update(users).set({ pushSubscription: null }).where(eq(users.id, user.id));
      return;
    }
    throw err; // scheduler's job wrapper logs transient failures
  }
}
