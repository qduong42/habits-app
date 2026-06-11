/**
 * Task reminders (v1.2 spec §2): per-minute scan over one-off tasks whose
 * remindAt has arrived. Sends one "🔔 <task name>" web-push to the owner and
 * stamps remindedAt ALWAYS — also when the owner has no subscription, push is
 * disabled, or the send fails — because an unstamped due reminder would
 * refire every minute. A missed reminder is accepted, same as nudges.
 */

import { and, eq, isNull, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tasks, users } from '../db/schema.js';
import type { WebPushLike } from './nudge.js';
import { configuredWebpush, pushEnabled } from './vapid.js';

export interface ReminderDeps {
  webpush: WebPushLike;
  enabled: boolean;
}

/** Fire every due reminder (remind_at <= now, unstamped, not completed). */
export async function sendDueReminders(now: Date, deps?: ReminderDeps): Promise<void> {
  const due = await db
    .select({
      taskId: tasks.id,
      name: tasks.name,
      userId: users.id,
      pushSubscription: users.pushSubscription,
    })
    .from(tasks)
    .innerJoin(users, eq(tasks.userId, users.id))
    .where(and(lte(tasks.remindAt, now), isNull(tasks.remindedAt), isNull(tasks.completedAt)));
  if (due.length === 0) return;

  const enabled = deps?.enabled ?? pushEnabled();
  for (const task of due) {
    if (!enabled) {
      console.warn(`[push] reminder for task ${task.taskId} skipped — push disabled (no VAPID keys)`);
    } else if (task.pushSubscription) {
      const webpush = deps?.webpush ?? configuredWebpush();
      try {
        // Tapping the notification opens the PWA on the Today tab (url '/').
        await webpush.sendNotification(
          task.pushSubscription,
          JSON.stringify({ title: `🔔 ${task.name}`, url: '/' }),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or unsubscribed at the push service — forget it.
          await db.update(users).set({ pushSubscription: null }).where(eq(users.id, task.userId));
        } else {
          console.error(`[push] reminder for task ${task.taskId} failed`, err);
        }
      }
    }
    // Stamp regardless of outcome — remindedAt is the refire guard, not a
    // delivery receipt.
    await db.update(tasks).set({ remindedAt: now }).where(eq(tasks.id, task.taskId));
  }
}
