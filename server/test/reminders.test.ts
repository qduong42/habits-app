import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../src/db/client.js';
import { tasks, users } from '../src/db/schema.js';
import { sendDueReminders } from '../src/push/reminders.js';
import type { WebPushLike } from '../src/push/nudge.js';
import { scheduleReminderScan, cancelReminderScan, reminderJob } from '../src/push/scheduler.js';

// Task 4 (v1.2 spec §2): per-minute reminder scan — fires the 🔔 push for due
// one-off task reminders, stamps reminded_at ALWAYS (refire guard, even with
// no subscription), never re-fires, skips completed tasks.

const USER_PREFIX = 'reminderscantest-';
const PASSWORD = 'reminder scan password';
const MINUTE_MS = 60_000;

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/reminders',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

let passwordHash: string;
let userCounter = 0;

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash, timezone: 'UTC', ...overrides })
    .returning();
  return user!;
}

async function addTask(userId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const [task] = await db
    .insert(tasks)
    .values({ userId, name: 'water the plants', ...overrides })
    .returning();
  return task!;
}

function fakeWebpush(impl?: () => Promise<unknown>): WebPushLike & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    sendNotification: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return impl ? impl() : { statusCode: 201 };
    }) as WebPushLike['sendNotification'] & ((...args: unknown[]) => Promise<unknown>),
  };
}

async function taskRow(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  return row!;
}

async function deleteTestUsers() {
  const ids = db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  await db.delete(tasks).where(inArray(tasks.userId, ids));
  await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
  await deleteTestUsers();
});

afterAll(async () => {
  cancelReminderScan();
  await deleteTestUsers();
});

describe('sendDueReminders', () => {
  it('pushes 🔔 + task name for a due reminder and stamps remindedAt', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(1);
    const [subscription, payload] = push.calls[0]!;
    expect(subscription).toEqual(SUBSCRIPTION);
    const body = JSON.parse(payload as string);
    expect(body.title).toContain('🔔');
    expect(body.title).toContain('water the plants');
    expect(body.url).toBe('/');

    expect((await taskRow(task.id)).remindedAt).not.toBeNull();
  });

  it('ignores reminders that are not due yet', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() + MINUTE_MS) });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(0);
    expect((await taskRow(task.id)).remindedAt).toBeNull();
  });

  it('stamps remindedAt even when the user has no push subscription', async () => {
    const user = await makeUser();
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(0);
    expect((await taskRow(task.id)).remindedAt).not.toBeNull();
  });

  it('stamps remindedAt even when push is disabled (no VAPID keys)', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await sendDueReminders(now, { webpush: push, enabled: false });
    } finally {
      warn.mockRestore();
    }

    expect(push.calls).toHaveLength(0);
    expect((await taskRow(task.id)).remindedAt).not.toBeNull();
  });

  it('never re-fires once stamped', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    await addTask(user.id, {
      remindAt: new Date(now.getTime() - 2 * MINUTE_MS),
      remindedAt: new Date(now.getTime() - MINUTE_MS),
    });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(0);
  });

  it('skips completed tasks and leaves them unstamped', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, {
      remindAt: new Date(now.getTime() - MINUTE_MS),
      completedAt: now,
    });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(0);
    expect((await taskRow(task.id)).remindedAt).toBeNull();
  });

  it('clears the subscription on 410 Gone and still stamps', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush(() =>
      Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 })),
    );
    await sendDueReminders(now, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(1);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pushSubscription).toBeNull();
    expect((await taskRow(task.id)).remindedAt).not.toBeNull();
  });

  it('a transient push failure still stamps (a lost reminder must not refire forever)', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    const task = await addTask(user.id, { remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush(() =>
      Promise.reject(Object.assign(new Error('boom'), { statusCode: 500 })),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sendDueReminders(now, { webpush: push, enabled: true });
    } finally {
      error.mockRestore();
    }

    expect((await taskRow(task.id)).remindedAt).not.toBeNull();
  });

  it('handles several users in one scan', async () => {
    const a = await makeUser({ pushSubscription: SUBSCRIPTION });
    const b = await makeUser({ pushSubscription: SUBSCRIPTION });
    const now = new Date();
    await addTask(a.id, { name: 'task a', remindAt: new Date(now.getTime() - MINUTE_MS) });
    await addTask(b.id, { name: 'task b', remindAt: new Date(now.getTime() - MINUTE_MS) });

    const push = fakeWebpush();
    await sendDueReminders(now, { webpush: push, enabled: true });

    const titles = push.calls.map((call) => JSON.parse(call[1] as string).title as string);
    expect(titles.some((t) => t.includes('task a'))).toBe(true);
    expect(titles.some((t) => t.includes('task b'))).toBe(true);
  });
});

describe('reminder scan job', () => {
  it('scheduleReminderScan registers a per-minute job; cancelReminderScan removes it', () => {
    scheduleReminderScan();
    expect(reminderJob()).not.toBeNull();

    cancelReminderScan();
    expect(reminderJob()).toBeNull();
  });
});
