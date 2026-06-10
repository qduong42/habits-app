import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, categories, habits, checkins } from '../src/db/schema.js';
import { localDateFor, addDays, isoWeekOf } from '../src/game/dates.js';
import { createApp } from '../src/app.js';

const USER_A = 'habitstest-a';
const USER_B = 'habitstest-b';
const PASSWORD = 'habits test password';
const BUILTIN_CAT = 'HabitsTestBuiltin';
const CUSTOM_CAT_B = 'HabitsTestCustomOfB';

const app = createApp();

let userAId: string;
let userBId: string;
let builtinCatId: string;
let customCatBId: string;
let cookieA: string;
let cookieB: string;

async function login(name: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return cookies[0]!;
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.name, [USER_A, USER_B]));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(checkins).where(inArray(checkins.userId, ids));
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(categories).where(inArray(categories.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
  await db.delete(categories).where(eq(categories.name, BUILTIN_CAT));
}

beforeAll(async () => {
  await cleanup(); // in case a previous run died mid-test
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [a] = await db.insert(users).values({ name: USER_A, passwordHash }).returning();
  const [b] = await db.insert(users).values({ name: USER_B, passwordHash }).returning();
  userAId = a!.id;
  userBId = b!.id;
  // builtin category = userId null
  const [builtin] = await db
    .insert(categories)
    .values({ userId: null, name: BUILTIN_CAT, emoji: '💪', color: '#2e7d32' })
    .returning();
  builtinCatId = builtin!.id;
  // custom category owned by user B (must be invisible/unusable for A)
  const [customB] = await db
    .insert(categories)
    .values({ userId: userBId, name: CUSTOM_CAT_B, emoji: '🎨', color: '#ff0000' })
    .returning();
  customCatBId = customB!.id;
  cookieA = await login(USER_A);
  cookieB = await login(USER_B);
});

afterAll(cleanup);

async function createHabit(cookie: string, body: Record<string, unknown>) {
  return request(app).post('/api/habits').set('Cookie', cookie).send(body);
}

describe('habits routes', () => {
  describe('authentication', () => {
    it.each([
      ['get', '/api/habits'],
      ['post', '/api/habits'],
      ['patch', '/api/habits/00000000-0000-0000-0000-000000000000'],
      ['post', '/api/habits/00000000-0000-0000-0000-000000000000/archive'],
      ['delete', '/api/habits/00000000-0000-0000-0000-000000000000'],
    ] as const)('%s %s without cookie → 401 envelope', async (method, path) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });
  });

  describe('POST /api/habits validation', () => {
    it('rejects weekly habit without weeklyTarget → 400 validation', async () => {
      const res = await createHabit(cookieA, {
        name: 'Run',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('rejects daily habit WITH weeklyTarget → 400 validation (strict, not stripped)', async () => {
      const res = await createHabit(cookieA, {
        name: 'Stretch',
        categoryId: builtinCatId,
        frequencyType: 'daily',
        weeklyTarget: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('rejects weeklyTarget out of 1-7 range', async () => {
      const res = await createHabit(cookieA, {
        name: 'Run',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 8,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('rejects empty name', async () => {
      const res = await createHabit(cookieA, {
        name: '',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('rejects nonexistent categoryId → 404 not_found', async () => {
      const res = await createHabit(cookieA, {
        name: 'Ghost',
        categoryId: '00000000-0000-0000-0000-000000000000',
        frequencyType: 'daily',
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it("rejects another user's custom categoryId → 404 not_found", async () => {
      const res = await createHabit(cookieA, {
        name: 'Trespass',
        categoryId: customCatBId,
        frequencyType: 'daily',
      });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('create + GET /api/habits contract', () => {
    let dailyId: string;
    let weeklyId: string;

    it('creates a daily habit and returns the full contract shape', async () => {
      const res = await createHabit(cookieA, {
        name: 'Meditate',
        categoryId: builtinCatId,
        frequencyType: 'daily',
        notes: '10 minutes',
        sourceUrl: 'https://example.com/meditation',
      });
      expect(res.status).toBe(201);
      dailyId = res.body.id;
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Meditate',
        notes: '10 minutes',
        sourceUrl: 'https://example.com/meditation',
        category: {
          id: builtinCatId,
          name: BUILTIN_CAT,
          emoji: '💪',
          color: '#2e7d32',
          builtin: true,
        },
        frequencyType: 'daily',
        weeklyTarget: null,
        scheduledToday: true,
        doneToday: false,
        weekCount: 0,
        streak: 0,
      });
    });

    it('creates a weekly habit with target 3', async () => {
      const res = await createHabit(cookieA, {
        name: 'Run 5k',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 3,
      });
      expect(res.status).toBe(201);
      weeklyId = res.body.id;
      expect(res.body).toMatchObject({
        name: 'Run 5k',
        notes: null,
        sourceUrl: null,
        frequencyType: 'weekly',
        weeklyTarget: 3,
        scheduledToday: true, // 0 of 3 done this week
        doneToday: false,
        weekCount: 0,
        streak: 0,
      });
    });

    it('GET /api/habits matches the shared contract field-for-field', async () => {
      const [me] = await db.select().from(users).where(eq(users.id, userAId));
      const today = localDateFor(me!.timezone);

      const res = await request(app).get('/api/habits').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.today).toBe(today);
      expect(res.body.habits).toHaveLength(2);

      const daily = res.body.habits.find((h: { id: string }) => h.id === dailyId);
      expect(daily).toEqual({
        id: dailyId,
        name: 'Meditate',
        notes: '10 minutes',
        sourceUrl: 'https://example.com/meditation',
        category: {
          id: builtinCatId,
          name: BUILTIN_CAT,
          emoji: '💪',
          color: '#2e7d32',
          builtin: true,
        },
        frequencyType: 'daily',
        weeklyTarget: null,
        scheduledToday: true,
        doneToday: false,
        weekCount: 0,
        streak: 0,
      });

      const weekly = res.body.habits.find((h: { id: string }) => h.id === weeklyId);
      expect(weekly).toMatchObject({
        frequencyType: 'weekly',
        weeklyTarget: 3,
        scheduledToday: true,
        doneToday: false,
        weekCount: 0,
        streak: 0,
      });
    });

    it("does not leak user A's habits to user B", async () => {
      const res = await request(app).get('/api/habits').set('Cookie', cookieB);
      expect(res.status).toBe(200);
      expect(res.body.habits).toEqual([]);
    });
  });

  describe('today status from checkins (inserted directly — checkin endpoint is Task 7)', () => {
    it('daily habit: doneToday, weekCount and streak from consecutive checkins', async () => {
      const created = await createHabit(cookieA, {
        name: 'Streaky',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const habitId = created.body.id;
      const today = localDateFor('Europe/Berlin');
      const dates = [today, addDays(today, -1), addDays(today, -2)];
      await db
        .insert(checkins)
        .values(dates.map((localDate) => ({ habitId, userId: userAId, localDate })));
      // checkins near a Monday fall into the previous ISO week — compute, don't assume
      const expectedWeekCount = dates.filter((d) => isoWeekOf(d) === isoWeekOf(today)).length;

      const res = await request(app).get('/api/habits').set('Cookie', cookieA);
      const habit = res.body.habits.find((h: { id: string }) => h.id === habitId);
      expect(habit).toMatchObject({
        doneToday: true,
        weekCount: expectedWeekCount,
        streak: 3,
        scheduledToday: true,
      });
    });

    it('daily streak survives an unchecked today (counts run ending yesterday)', async () => {
      const created = await createHabit(cookieA, {
        name: 'Grace',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const habitId = created.body.id;
      const today = localDateFor('Europe/Berlin');
      await db.insert(checkins).values([
        { habitId, userId: userAId, localDate: addDays(today, -1) },
        { habitId, userId: userAId, localDate: addDays(today, -2) },
      ]);

      const res = await request(app).get('/api/habits').set('Cookie', cookieA);
      const habit = res.body.habits.find((h: { id: string }) => h.id === habitId);
      expect(habit).toMatchObject({ doneToday: false, streak: 2, scheduledToday: true });
    });

    it('weekly habit at target: scheduledToday follows weekCount < target || doneToday', async () => {
      const created = await createHabit(cookieA, {
        name: 'Weekly once',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 1,
      });
      const habitId = created.body.id;
      const today = localDateFor('Europe/Berlin');
      const yesterday = addDays(today, -1);
      await db.insert(checkins).values({ habitId, userId: userAId, localDate: yesterday });
      // if today is Monday, yesterday belongs to last ISO week → weekCount 0
      const expectedWeekCount = isoWeekOf(yesterday) === isoWeekOf(today) ? 1 : 0;

      const res = await request(app).get('/api/habits').set('Cookie', cookieA);
      const habit = res.body.habits.find((h: { id: string }) => h.id === habitId);
      // Weekly streaks are real since Task 13 (weeklyStreak): whether
      // yesterday fell in this ISO week (met) or last week (met, current
      // pending), the streak is 1 either way.
      expect(habit).toMatchObject({
        doneToday: false,
        weekCount: expectedWeekCount,
        scheduledToday: expectedWeekCount < 1, // target met and not done today → unscheduled
        streak: 1,
      });
    });

    it('weekly habit checked today stays scheduledToday even at target', async () => {
      const created = await createHabit(cookieA, {
        name: 'Weekly done today',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 1,
      });
      const habitId = created.body.id;
      const today = localDateFor('Europe/Berlin');
      await db.insert(checkins).values({ habitId, userId: userAId, localDate: today });

      const res = await request(app).get('/api/habits').set('Cookie', cookieA);
      const habit = res.body.habits.find((h: { id: string }) => h.id === habitId);
      expect(habit).toMatchObject({
        doneToday: true,
        weekCount: 1,
        scheduledToday: true,
        streak: 1, // target 1 met this week → real weekly streak since Task 13
      });
    });
  });

  describe('PATCH /api/habits/:id', () => {
    it('renames a habit', async () => {
      const created = await createHabit(cookieA, {
        name: 'Old name',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ name: 'New name' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New name');
      expect(res.body.frequencyType).toBe('daily');
    });

    it('changes daily → weekly with target', async () => {
      const created = await createHabit(cookieA, {
        name: 'Going weekly',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ frequencyType: 'weekly', weeklyTarget: 4 });
      expect(res.status).toBe(200);
      expect(res.body.frequencyType).toBe('weekly');
      expect(res.body.weeklyTarget).toBe(4);
    });

    it('rejects daily → weekly without a target → 400', async () => {
      const created = await createHabit(cookieA, {
        name: 'Half weekly',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ frequencyType: 'weekly' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it('changing weekly → daily clears weeklyTarget', async () => {
      const created = await createHabit(cookieA, {
        name: 'Going daily',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 2,
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ frequencyType: 'daily' });
      expect(res.status).toBe(200);
      expect(res.body.frequencyType).toBe('daily');
      expect(res.body.weeklyTarget).toBeNull();
    });

    it('rejects weeklyTarget on a daily habit → 400', async () => {
      const created = await createHabit(cookieA, {
        name: 'Still daily',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ weeklyTarget: 3 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });

    it("rejects another user's category on PATCH → 404", async () => {
      const created = await createHabit(cookieA, {
        name: 'Cat swap',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app)
        .patch(`/api/habits/${created.body.id}`)
        .set('Cookie', cookieA)
        .send({ categoryId: customCatBId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('archive and delete', () => {
    it('archive removes the habit from GET but keeps the row', async () => {
      const created = await createHabit(cookieA, {
        name: 'To archive',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const habitId = created.body.id;

      const res = await request(app)
        .post(`/api/habits/${habitId}/archive`)
        .set('Cookie', cookieA);
      expect(res.status).toBe(200);

      const list = await request(app).get('/api/habits').set('Cookie', cookieA);
      expect(list.body.habits.find((h: { id: string }) => h.id === habitId)).toBeUndefined();

      const [row] = await db.select().from(habits).where(eq(habits.id, habitId));
      expect(row).toBeDefined();
      expect(row!.archivedAt).not.toBeNull();
    });

    it('DELETE hard-deletes the row and cascades checkins', async () => {
      const created = await createHabit(cookieA, {
        name: 'To delete',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const habitId = created.body.id;
      await db.insert(checkins).values({
        habitId,
        userId: userAId,
        localDate: localDateFor('Europe/Berlin'),
      });

      const res = await request(app).delete(`/api/habits/${habitId}`).set('Cookie', cookieA);
      expect(res.status).toBe(200);

      const rows = await db.select().from(habits).where(eq(habits.id, habitId));
      expect(rows).toEqual([]);
      const checkinRows = await db.select().from(checkins).where(eq(checkins.habitId, habitId));
      expect(checkinRows).toEqual([]);
    });
  });

  describe('not-found semantics', () => {
    let foreignHabitId: string;

    beforeAll(async () => {
      const created = await createHabit(cookieB, {
        name: "B's habit",
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      foreignHabitId = created.body.id;
    });

    it("another user's habit → 404 on PATCH/archive/DELETE", async () => {
      const patch = await request(app)
        .patch(`/api/habits/${foreignHabitId}`)
        .set('Cookie', cookieA)
        .send({ name: 'stolen' });
      expect(patch.status).toBe(404);
      expect(patch.body.error.code).toBe('not_found');

      const archive = await request(app)
        .post(`/api/habits/${foreignHabitId}/archive`)
        .set('Cookie', cookieA);
      expect(archive.status).toBe(404);

      const del = await request(app)
        .delete(`/api/habits/${foreignHabitId}`)
        .set('Cookie', cookieA);
      expect(del.status).toBe(404);

      // and B's habit is untouched
      const [row] = await db.select().from(habits).where(eq(habits.id, foreignHabitId));
      expect(row).toBeDefined();
      expect(row!.name).toBe("B's habit");
      expect(row!.archivedAt).toBeNull();
    });

    it('bogus (non-uuid) :id → 404 envelope, not 500', async () => {
      for (const res of [
        await request(app).patch('/api/habits/not-a-uuid').set('Cookie', cookieA).send({ name: 'x' }),
        await request(app).post('/api/habits/not-a-uuid/archive').set('Cookie', cookieA),
        await request(app).delete('/api/habits/not-a-uuid').set('Cookie', cookieA),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });

    it('well-formed but missing uuid → 404', async () => {
      const res = await request(app)
        .patch('/api/habits/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookieA)
        .send({ name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });
});
