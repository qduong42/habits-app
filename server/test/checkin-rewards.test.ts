import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import {
  users,
  categories,
  habits,
  checkins,
  achievements,
  userAchievements,
} from '../src/db/schema.js';
import { ACHIEVEMENT_CATALOG } from '../src/game/achievements.js';
import { createApp } from '../src/app.js';

// Task 13: the check-in transaction awards XP, streaks and achievements.
// Each test uses a fresh user (rewardstest-N) so XP totals are deterministic.

const USER_PREFIX = 'rewardstest-';
const PASSWORD = 'rewards test password';

const app = createApp();

let passwordHash: string;
let userCounter = 0;

async function login(name: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return cookies[0]!;
}

interface TestUser {
  id: string;
  cookie: string;
  categoryId: string;
}

/** Fresh user with one user-owned category (builtins stay untouched for categories.test.ts). */
async function makeUser(): Promise<TestUser> {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash })
    .returning();
  const [cat] = await db
    .insert(categories)
    .values({ userId: user!.id, name: `RewardsCat-${n}-a`, emoji: '🏷️', color: '#123456' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
}

async function makeCategory(userId: string, suffix: string): Promise<string> {
  const [cat] = await db
    .insert(categories)
    .values({ userId, name: `RewardsCat-${suffix}`, emoji: '🏷️', color: '#654321' })
    .returning();
  return cat!.id;
}

async function createHabit(cookie: string, body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/habits').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function checkin(cookie: string, habitId: string) {
  return request(app).post(`/api/habits/${habitId}/checkin`).set('Cookie', cookie);
}

function undo(cookie: string, habitId: string) {
  return request(app).delete(`/api/habits/${habitId}/checkin`).set('Cookie', cookie);
}

async function xpOf(userId: string): Promise<number> {
  const [row] = await db.select({ xpTotal: users.xpTotal }).from(users).where(eq(users.id, userId));
  return row!.xpTotal;
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(userAchievements).where(inArray(userAchievements.userId, ids));
    await db.delete(checkins).where(inArray(checkins.userId, ids));
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(categories).where(inArray(categories.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup(); // in case a previous run died mid-test
  passwordHash = await bcrypt.hash(PASSWORD, 10);
  // The test DB is unseeded — insert the achievements catalog idempotently
  // (text slug PK, so onConflictDoNothing is safe across suites).
  await db
    .insert(achievements)
    .values(
      ACHIEVEMENT_CATALOG.map(({ id, name, description, emoji }) => ({
        id,
        name,
        description,
        emoji,
      })),
    )
    .onConflictDoNothing();
});

afterAll(cleanup);

describe('check-in rewards transaction', () => {
  it('single daily habit: first check-in completes the day → 35 XP + first-checkin', async () => {
    const u = await makeUser();
    const habitId = await createHabit(u.cookie, {
      name: 'Solo daily',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });

    const res = await checkin(u.cookie, habitId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      xpGained: 35, // 10 base + 25: it completes the only scheduled habit of the day
      xpTotal: 35,
      level: 1,
      leveledUp: false,
      habitStreak: 1,
      unlockedAchievements: [
        {
          id: 'first-checkin',
          name: 'First Step',
          description: 'Complete your very first check-in.',
          emoji: '🎉',
          unlockedAt: expect.any(String),
        },
      ],
    });

    expect(await xpOf(u.id)).toBe(35); // persisted, not just echoed
  });

  it('two daily habits: first check-in gains 10, the completing second gains 35', async () => {
    const u = await makeUser();
    const h1 = await createHabit(u.cookie, {
      name: 'First',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    const h2 = await createHabit(u.cookie, {
      name: 'Second',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });

    const r1 = await checkin(u.cookie, h1);
    expect(r1.body).toMatchObject({ xpGained: 10, xpTotal: 10 });
    expect(r1.body.unlockedAchievements.map((a: { id: string }) => a.id)).toEqual([
      'first-checkin',
    ]);

    const r2 = await checkin(u.cookie, h2);
    // achievements are never re-awarded: second check-in returns []
    expect(r2.body).toMatchObject({ xpGained: 35, xpTotal: 45, unlockedAchievements: [] });
  });

  it('crossing 1000 XP levels up', async () => {
    const u = await makeUser();
    await db.update(users).set({ xpTotal: 995 }).where(eq(users.id, u.id));
    const habitId = await createHabit(u.cookie, {
      name: 'Leveler',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });

    const res = await checkin(u.cookie, habitId);
    expect(res.body).toMatchObject({
      xpGained: 35,
      xpTotal: 1030,
      level: 2,
      leveledUp: true,
    });
  });

  it('balanced-day unlocks on the 3rd category of the day and is never re-awarded', async () => {
    const u = await makeUser();
    const cat2 = await makeCategory(u.id, 'balanced-2');
    const cat3 = await makeCategory(u.id, 'balanced-3');
    const cat4 = await makeCategory(u.id, 'balanced-4');
    const mk = (name: string, categoryId: string) =>
      createHabit(u.cookie, { name, categoryId, frequencyType: 'daily' });
    const h1 = await mk('Cat1 habit', u.categoryId);
    const h2 = await mk('Cat2 habit', cat2);
    const h3 = await mk('Cat3 habit', cat3);
    const h4 = await mk('Cat4 habit', cat4);

    const ids = (res: { body: { unlockedAchievements: { id: string }[] } }) =>
      res.body.unlockedAchievements.map((a) => a.id);

    expect(ids(await checkin(u.cookie, h1))).toEqual(['first-checkin']);
    expect(ids(await checkin(u.cookie, h2))).toEqual([]);
    const third = await checkin(u.cookie, h3);
    expect(ids(third)).toEqual(['balanced-day']);
    expect(third.body.unlockedAchievements[0]).toMatchObject({
      name: 'Balanced Day',
      emoji: '⚖️',
      unlockedAt: expect.any(String),
    });
    // 4th category still satisfies the threshold but the badge is already unlocked
    expect(ids(await checkin(u.cookie, h4))).toEqual([]);
  });

  it('weekly habit: habitStreak comes from weeklyStreak and GET /habits agrees', async () => {
    const u = await makeUser();
    const habitId = await createHabit(u.cookie, {
      name: 'Weekly once',
      categoryId: u.categoryId,
      frequencyType: 'weekly',
      weeklyTarget: 1,
    });

    const res = await checkin(u.cookie, habitId);
    // only habit, weekly and done today → scheduled-and-done → completes the day;
    // week target (1) met this fresh week → weekly streak 1
    expect(res.body).toMatchObject({ xpGained: 35, habitStreak: 1 });

    const list = await request(app).get('/api/habits').set('Cookie', u.cookie);
    const habit = list.body.habits.find((h: { id: string }) => h.id === habitId);
    expect(habit).toMatchObject({ doneToday: true, weekCount: 1, streak: 1 });
  });

  it('duplicate check-in → 409 and the aborted transaction awards nothing', async () => {
    const u = await makeUser();
    const habitId = await createHabit(u.cookie, {
      name: 'Once only',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    await checkin(u.cookie, habitId);

    const dup = await checkin(u.cookie, habitId);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_done');

    expect(await xpOf(u.id)).toBe(35); // unchanged by the failed attempt
    const rows = await db.select().from(checkins).where(eq(checkins.habitId, habitId));
    expect(rows).toHaveLength(1);
  });

  describe('undo reverses exactly what the check-in gained', () => {
    it('complete day: undoing the completing check-in loses 35', async () => {
      const u = await makeUser();
      const habitId = await createHabit(u.cookie, {
        name: 'Complete then undo',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      await checkin(u.cookie, habitId);
      expect(await xpOf(u.id)).toBe(35);

      const res = await undo(u.cookie, habitId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, xpLost: 35, xpTotal: 0, level: 1 });
      expect(await xpOf(u.id)).toBe(0);

      // achievements are one-way: first-checkin survives the undo
      const ua = await db
        .select()
        .from(userAchievements)
        .where(eq(userAchievements.userId, u.id));
      expect(ua.map((a) => a.achievementId)).toEqual(['first-checkin']);
    });

    it('partial day: undoing a non-completing check-in loses 10', async () => {
      const u = await makeUser();
      const h1 = await createHabit(u.cookie, {
        name: 'Done one',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      await createHabit(u.cookie, {
        name: 'Still open',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      await checkin(u.cookie, h1); // +10, day not complete

      const res = await undo(u.cookie, h1);
      expect(res.body).toEqual({ ok: true, xpLost: 10, xpTotal: 0, level: 1 });
    });

    it('bonus-breaking undo of a NON-final check-in loses the 25 bonus too', async () => {
      const u = await makeUser();
      const h1 = await createHabit(u.cookie, {
        name: 'Checked first',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      const h2 = await createHabit(u.cookie, {
        name: 'Checked second',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      await checkin(u.cookie, h1); // +10
      await checkin(u.cookie, h2); // +35 (completes the day)
      expect(await xpOf(u.id)).toBe(45);

      // undoing the FIRST check-in: day was complete, now is not → 10 + 25
      const res = await undo(u.cookie, h1);
      expect(res.body).toEqual({ ok: true, xpLost: 35, xpTotal: 10, level: 1 });
      expect(await xpOf(u.id)).toBe(10);
    });

    it('xpTotal is floored at 0 defensively', async () => {
      const u = await makeUser();
      const habitId = await createHabit(u.cookie, {
        name: 'Floored',
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      await checkin(u.cookie, habitId); // +35
      await db.update(users).set({ xpTotal: 5 }).where(eq(users.id, u.id)); // simulate drift

      const res = await undo(u.cookie, habitId);
      expect(res.body).toEqual({ ok: true, xpLost: 35, xpTotal: 0, level: 1 });
    });
  });
});
