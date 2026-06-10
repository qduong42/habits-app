import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, isNull, like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { categories, checkins, habits, tasks, users } from '../src/db/schema.js';
import { addDays, localDateFor } from '../src/game/dates.js';
import { createApp } from '../src/app.js';
import {
  openHabitsCount,
  dueTasksCount,
  nudgeTitle,
  sendNudge,
  type WebPushLike,
} from '../src/push/nudge.js';
import {
  parseNudgeRule,
  rescheduleNudge,
  scheduleAllNudges,
  nudgeJobs,
  cancelAllNudges,
} from '../src/push/scheduler.js';

// Task 21: daily nudge — open-work counting, sendNudge with an injected
// web-push fake, per-user scheduling, and the push routes (VAPID key +
// subscribe/unsubscribe) incl. the disabled mode when VAPID env is unset.

const USER_PREFIX = 'nudgetest-';
const PASSWORD = 'nudge test password';
const HOUR_MS = 3_600_000;

const app = createApp();

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/abc',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

let passwordHash: string;
let userCounter = 0;
let builtinCategoryId: string;

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash, timezone: 'UTC', ...overrides })
    .returning();
  return user!;
}

async function login(name: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return cookies[0]!;
}

async function addHabit(
  userId: string,
  frequencyType: 'daily' | 'weekly',
  weeklyTarget: number | null = null,
  archived = false,
) {
  const [habit] = await db
    .insert(habits)
    .values({
      userId,
      categoryId: builtinCategoryId,
      name: `${frequencyType} habit`,
      frequencyType,
      weeklyTarget,
      archivedAt: archived ? new Date() : null,
    })
    .returning();
  return habit!;
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

// users has no FK cascades from checkins/habits/tasks — children go first.
async function deleteTestUsers() {
  const ids = db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  await db.delete(checkins).where(inArray(checkins.userId, ids));
  await db.delete(habits).where(inArray(habits.userId, ids));
  await db.delete(tasks).where(inArray(tasks.userId, ids));
  await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
  await deleteTestUsers();
  const [builtin] = await db.select().from(categories).where(isNull(categories.userId)).limit(1);
  builtinCategoryId = builtin!.id;
});

afterAll(async () => {
  cancelAllNudges();
  await deleteTestUsers();
});

describe('openHabitsCount', () => {
  it('counts scheduled-but-not-done habits with day-bonus semantics', async () => {
    const user = await makeUser();
    const today = localDateFor('UTC');

    const daily = await addHabit(user.id, 'daily'); // open
    await addHabit(user.id, 'daily'); // open
    const doneDaily = await addHabit(user.id, 'daily'); // done today
    await db
      .insert(checkins)
      .values({ habitId: doneDaily.id, userId: user.id, localDate: today });

    expect(await openHabitsCount(user.id, today)).toBe(2);

    await db.insert(checkins).values({ habitId: daily.id, userId: user.id, localDate: today });
    expect(await openHabitsCount(user.id, today)).toBe(1);
  });

  it('weekly habits: under target counts, met target (not today) does not', async () => {
    const user = await makeUser();
    const today = localDateFor('UTC');

    const underTarget = await addHabit(user.id, 'weekly', 3); // 1/3 this week → open
    await db
      .insert(checkins)
      .values({ habitId: underTarget.id, userId: user.id, localDate: addDays(today, -1) });

    const metTarget = await addHabit(user.id, 'weekly', 1); // met yesterday → unscheduled
    await db
      .insert(checkins)
      .values({ habitId: metTarget.id, userId: user.id, localDate: addDays(today, -1) });

    expect(await openHabitsCount(user.id, today)).toBe(1);
  });

  it('ignores archived habits', async () => {
    const user = await makeUser();
    const today = localDateFor('UTC');
    await addHabit(user.id, 'daily', null, true);
    expect(await openHabitsCount(user.id, today)).toBe(0);
  });
});

describe('dueTasksCount', () => {
  it('counts overdue + today, excluding undated/scheduled/terminal tasks', async () => {
    const user = await makeUser();
    const now = new Date();
    const today = localDateFor('UTC', now);

    await db.insert(tasks).values([
      // counted:
      { userId: user.id, name: 'overdue one-off', dueDate: addDays(today, -2) },
      { userId: user.id, name: 'today one-off', dueDate: today },
      { userId: user.id, name: 'due recurring', intervalHours: 24, nextDue: new Date(now.getTime() - HOUR_MS) },
      // not counted:
      { userId: user.id, name: 'undated', dueDate: null },
      { userId: user.id, name: 'future one-off', dueDate: addDays(today, 3) },
      { userId: user.id, name: 'not-due recurring', intervalHours: 24, nextDue: new Date(now.getTime() + 5 * HOUR_MS) },
      { userId: user.id, name: 'done one-off', dueDate: today, completedAt: now },
      { userId: user.id, name: 'old terminal one-off', dueDate: addDays(today, -3), completedAt: new Date(now.getTime() - 48 * HOUR_MS) },
    ]);

    expect(await dueTasksCount(user.id, now, today, 'UTC')).toBe(3);
  });
});

describe('nudgeTitle', () => {
  it('joins both parts with correct plurals', () => {
    expect(nudgeTitle(2, 1)).toBe('🔥 2 habits · 1 task left today');
    expect(nudgeTitle(1, 2)).toBe('🔥 1 habit · 2 tasks left today');
  });

  it('omits a zero part entirely', () => {
    expect(nudgeTitle(1, 0)).toBe('🔥 1 habit left today');
    expect(nudgeTitle(0, 3)).toBe('🔥 3 tasks left today');
  });

  it('is null when nothing is open', () => {
    expect(nudgeTitle(0, 0)).toBeNull();
  });
});

describe('sendNudge', () => {
  it('sends the composed payload when work is open and a subscription exists', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    await addHabit(user.id, 'daily');
    const today = localDateFor('UTC');
    await db.insert(tasks).values({ userId: user.id, name: 'due', dueDate: today });

    const push = fakeWebpush();
    await sendNudge(user, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(1);
    const [subscription, payload] = push.calls[0]!;
    expect(subscription).toEqual(SUBSCRIPTION);
    expect(JSON.parse(payload as string)).toEqual({
      title: '🔥 1 habit · 1 task left today',
      url: '/',
    });
  });

  it('does not send when nothing is open', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const push = fakeWebpush();
    await sendNudge(user, { webpush: push, enabled: true });
    expect(push.calls).toHaveLength(0);
  });

  it('does not send without a subscription', async () => {
    const user = await makeUser();
    await addHabit(user.id, 'daily');
    const push = fakeWebpush();
    await sendNudge(user, { webpush: push, enabled: true });
    expect(push.calls).toHaveLength(0);
  });

  it('no-ops with a warning when push is disabled (no VAPID keys)', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    await addHabit(user.id, 'daily');
    const push = fakeWebpush();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await sendNudge(user, { webpush: push, enabled: false });
      expect(push.calls).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('clears the stored subscription on a 410 Gone push error', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    await addHabit(user.id, 'daily');

    const push = fakeWebpush(() => Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 })));
    await sendNudge(user, { webpush: push, enabled: true });

    expect(push.calls).toHaveLength(1);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pushSubscription).toBeNull();
  });

  it('clears the stored subscription on a 404 push error too', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    await addHabit(user.id, 'daily');

    const push = fakeWebpush(() => Promise.reject(Object.assign(new Error('nope'), { statusCode: 404 })));
    await sendNudge(user, { webpush: push, enabled: true });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pushSubscription).toBeNull();
  });
});

describe('scheduler', () => {
  it('parseNudgeRule builds a tz-aware recurrence rule', () => {
    const rule = parseNudgeRule('21:30', 'Europe/Berlin');
    expect(rule.hour).toBe(21);
    expect(rule.minute).toBe(30);
    expect(rule.tz).toBe('Europe/Berlin');
  });

  it('parseNudgeRule accepts the pg time form HH:MM:SS', () => {
    const rule = parseNudgeRule('07:05:00', 'UTC');
    expect(rule.hour).toBe(7);
    expect(rule.minute).toBe(5);
  });

  it('rescheduleNudge schedules, replaces and clears per-user jobs', async () => {
    const user = await makeUser({ nudgeTime: '08:00' });

    await rescheduleNudge(user.id);
    expect(nudgeJobs.has(user.id)).toBe(true);
    const first = nudgeJobs.get(user.id);

    await db.update(users).set({ nudgeTime: '21:15' }).where(eq(users.id, user.id));
    await rescheduleNudge(user.id);
    expect(nudgeJobs.has(user.id)).toBe(true);
    expect(nudgeJobs.get(user.id)).not.toBe(first);

    await db.update(users).set({ nudgeTime: null }).where(eq(users.id, user.id));
    await rescheduleNudge(user.id);
    expect(nudgeJobs.has(user.id)).toBe(false);
  });

  it('scheduleAllNudges schedules every user with a nudge time and skips the rest', async () => {
    const withNudge = await makeUser({ nudgeTime: '09:30' });
    const without = await makeUser();

    cancelAllNudges();
    expect(nudgeJobs.size).toBe(0);
    await scheduleAllNudges();

    expect(nudgeJobs.has(withNudge.id)).toBe(true);
    expect(nudgeJobs.has(without.id)).toBe(false);
  });

  it('settings PUT reschedules the nudge job', async () => {
    const user = await makeUser();
    const cookie = await login(user.name);

    await request(app)
      .put('/api/me/settings')
      .set('Cookie', cookie)
      .send({ nudgeTime: '18:45' })
      .expect(200);
    expect(nudgeJobs.has(user.id)).toBe(true);

    await request(app)
      .put('/api/me/settings')
      .set('Cookie', cookie)
      .send({ nudgeTime: null })
      .expect(200);
    expect(nudgeJobs.has(user.id)).toBe(false);
  });
});

describe('push routes', () => {
  it('GET /api/push/vapid-public-key → 503 push_disabled without VAPID env', async () => {
    const user = await makeUser();
    const cookie = await login(user.name);

    const res = await request(app).get('/api/push/vapid-public-key').set('Cookie', cookie);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('push_disabled');
  });

  it('GET /api/push/vapid-public-key → {key} when VAPID env is set', async () => {
    const user = await makeUser();
    const cookie = await login(user.name);

    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    try {
      const res = await request(app).get('/api/push/vapid-public-key').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ key: 'test-public-key' });
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
  });

  it('POST /api/push/subscribe stores the subscription', async () => {
    const user = await makeUser();
    const cookie = await login(user.name);

    const res = await request(app)
      .post('/api/push/subscribe')
      .set('Cookie', cookie)
      .send(SUBSCRIPTION);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pushSubscription).toEqual(SUBSCRIPTION);
  });

  it('POST /api/push/subscribe rejects malformed bodies with 400', async () => {
    const user = await makeUser();
    const cookie = await login(user.name);

    for (const bad of [
      {},
      { endpoint: 'not-a-url', keys: SUBSCRIPTION.keys },
      { endpoint: SUBSCRIPTION.endpoint, keys: { p256dh: 'x' } },
    ]) {
      const res = await request(app).post('/api/push/subscribe').set('Cookie', cookie).send(bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    }
  });

  it('DELETE /api/push/subscribe clears the subscription', async () => {
    const user = await makeUser({ pushSubscription: SUBSCRIPTION });
    const cookie = await login(user.name);

    const res = await request(app).delete('/api/push/subscribe').set('Cookie', cookie);

    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.pushSubscription).toBeNull();
  });

  it('push routes require auth', async () => {
    for (const req of [
      request(app).get('/api/push/vapid-public-key'),
      request(app).post('/api/push/subscribe').send(SUBSCRIPTION),
      request(app).delete('/api/push/subscribe'),
    ]) {
      const res = await req;
      expect(res.status).toBe(401);
    }
  });
});
