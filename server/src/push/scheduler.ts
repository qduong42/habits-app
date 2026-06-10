/**
 * Per-user daily nudge jobs (spec "Daily Nudge Flow" step 1): one
 * node-schedule job per user with a nudgeTime, recurring daily at that
 * HH:MM **in the user's timezone**. Scheduled on boot (scheduleAllNudges)
 * and rescheduled whenever PUT /api/me/settings changes nudgeTime/timezone.
 *
 * The scheduler runs regardless of VAPID configuration — with the keys
 * missing, sendNudge no-ops with a warning (Rule 10).
 */

import schedule from 'node-schedule';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { sendNudge } from './nudge.js';
import { sendDueReminders } from './reminders.js';

/** Live jobs keyed by userId — exported so tests can observe side effects. */
export const nudgeJobs = new Map<string, schedule.Job>();

/**
 * 'HH:MM' (or the pg `time` form 'HH:MM:SS') + IANA zone → a daily
 * node-schedule recurrence at that local wall-clock time.
 */
export function parseNudgeRule(nudgeTime: string, timezone: string): schedule.RecurrenceRule {
  const [hour, minute] = nudgeTime.split(':');
  const rule = new schedule.RecurrenceRule();
  rule.hour = Number(hour);
  rule.minute = Number(minute);
  rule.tz = timezone;
  return rule;
}

function cancelNudge(userId: string): void {
  const existing = nudgeJobs.get(userId);
  if (existing) {
    existing.cancel();
    nudgeJobs.delete(userId);
  }
}

async function runNudge(userId: string): Promise<void> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return; // user deleted since scheduling
    await sendNudge(user);
  } catch (err) {
    // Transient push/DB failures must not kill the process; the job fires
    // again tomorrow.
    console.error(`[push] nudge for user ${userId} failed`, err);
  }
}

function scheduleNudge(userId: string, nudgeTime: string | null, timezone: string): void {
  cancelNudge(userId);
  if (nudgeTime === null) return;
  const job = schedule.scheduleJob(
    `nudge:${userId}`,
    parseNudgeRule(nudgeTime, timezone),
    () => void runNudge(userId),
  );
  // scheduleJob returns null for rules that can never fire — nudgeTime is
  // validated HH:MM, so this is purely defensive.
  if (job) nudgeJobs.set(userId, job);
}

/** Re-read one user's settings and replace (or clear) their job. */
export async function rescheduleNudge(userId: string): Promise<void> {
  const [user] = await db
    .select({ nudgeTime: users.nudgeTime, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    cancelNudge(userId);
    return;
  }
  scheduleNudge(userId, user.nudgeTime, user.timezone);
}

/** Boot-time scheduling for every user with a nudge time (index.ts). */
export async function scheduleAllNudges(): Promise<void> {
  const rows = await db
    .select({ id: users.id, nudgeTime: users.nudgeTime, timezone: users.timezone })
    .from(users)
    .where(isNotNull(users.nudgeTime));
  for (const user of rows) {
    scheduleNudge(user.id, user.nudgeTime, user.timezone);
  }
}

/** Cancel every job — test teardown (open timers keep the worker alive). */
export function cancelAllNudges(): void {
  for (const job of nudgeJobs.values()) job.cancel();
  nudgeJobs.clear();
}

let reminderScanJob: schedule.Job | null = null;

/** The live per-minute reminder scan job, or null — exported for tests. */
export function reminderJob(): schedule.Job | null {
  return reminderScanJob;
}

/**
 * Per-minute task-reminder scan (v1.2 spec §2), one global job — unlike
 * nudges it is not per-user; sendDueReminders scans every due task at once.
 * Registered once at boot (index.ts).
 */
export function scheduleReminderScan(): void {
  cancelReminderScan();
  reminderScanJob = schedule.scheduleJob('reminders', '* * * * *', () => {
    // Transient push/DB failures must not kill the process; the scan fires
    // again next minute (due reminders stay unstamped until processed).
    sendDueReminders(new Date()).catch((err) => {
      console.error('[push] reminder scan failed', err);
    });
  });
}

/** Cancel the scan job — test teardown (open timers keep the worker alive). */
export function cancelReminderScan(): void {
  if (reminderScanJob) {
    reminderScanJob.cancel();
    reminderScanJob = null;
  }
}
