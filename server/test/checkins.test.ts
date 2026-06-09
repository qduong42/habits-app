import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, and } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, categories, habits, checkins } from '../src/db/schema.js';
import { localDateFor, addDays, isoWeekOf } from '../src/game/dates.js';
import { createApp } from '../src/app.js';

const USER_A = 'checkinstest-a';
const USER_B = 'checkinstest-b';
const PASSWORD = 'checkins test password';
const BUILTIN_CAT = 'CheckinsTestBuiltin';

const app = createApp();

let userAId: string;
let userBId: string;
let builtinCatId: string;
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
  const [builtin] = await db
    .insert(categories)
    .values({ userId: null, name: BUILTIN_CAT, emoji: '💪', color: '#2e7d32' })
    .returning();
  builtinCatId = builtin!.id;
  cookieA = await login(USER_A);
  cookieB = await login(USER_B);
});

afterAll(cleanup);

async function createHabit(cookie: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/habits').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function getHabit(cookie: string, habitId: string) {
  const res = await request(app).get('/api/habits').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.habits.find((h: { id: string }) => h.id === habitId);
}

describe('check-in and undo routes', () => {
  describe('authentication', () => {
    it.each([
      ['post', '/api/habits/00000000-0000-0000-0000-000000000000/checkin'],
      ['delete', '/api/habits/00000000-0000-0000-0000-000000000000/checkin'],
    ] as const)('%s %s without cookie → 401 envelope', async (method, path) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });
  });

  describe('POST /api/habits/:id/checkin', () => {
    it('checks in a daily habit → 200 with the exact contract (zeroed XP placeholders)', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Meditate',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });

      const res = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        xpGained: 0,
        xpTotal: 0,
        level: 1,
        leveledUp: false,
        habitStreak: 1,
        unlockedAchievements: [],
      });

      // and GET /habits reflects it
      const habit = await getHabit(cookieA, id);
      expect(habit).toMatchObject({ doneToday: true, streak: 1 });
    });

    it('persists localDate = today in the user timezone', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Journal',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);

      const rows = await db.select().from(checkins).where(eq(checkins.habitId, id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.localDate).toBe(localDateFor('Europe/Berlin')); // default user TZ
      expect(rows[0]!.userId).toBe(userAId);
    });

    it('duplicate same-day check-in → 409 already_done (and no second row)', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Hydrate',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);

      const dup = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('already_done');

      const rows = await db.select().from(checkins).where(eq(checkins.habitId, id));
      expect(rows).toHaveLength(1);
    });

    it('archived habit → 400 archived', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Retired',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      await request(app).post(`/api/habits/${id}/archive`).set('Cookie', cookieA);

      const res = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('archived');
    });

    it("foreign habit → 404, other user's data untouched", async () => {
      const { id } = await createHabit(cookieB, {
        name: "B's habit",
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });

      const res = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');

      const rows = await db.select().from(checkins).where(eq(checkins.habitId, id));
      expect(rows).toEqual([]);
    });

    it('bogus (non-uuid) :id → 404 envelope; well-formed missing uuid → 404', async () => {
      for (const path of [
        '/api/habits/not-a-uuid/checkin',
        '/api/habits/00000000-0000-0000-0000-000000000000/checkin',
      ]) {
        const res = await request(app).post(path).set('Cookie', cookieA);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });

    it('weekly habit check-in works and bumps weekCount', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Run 5k',
        categoryId: builtinCatId,
        frequencyType: 'weekly',
        weeklyTarget: 3,
      });

      const res = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ xpGained: 0, unlockedAchievements: [] });

      const habit = await getHabit(cookieA, id);
      expect(habit).toMatchObject({
        doneToday: true,
        weekCount: 1,
        scheduledToday: true, // done today keeps it visible even toward target
      });
    });

    it("streak continuation: yesterday's checkin + today's checkin → habitStreak 2", async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Streaky',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const today = localDateFor('Europe/Berlin');
      await db
        .insert(checkins)
        .values({ habitId: id, userId: userAId, localDate: addDays(today, -1) });

      const res = await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body.habitStreak).toBe(2);

      const habit = await getHabit(cookieA, id);
      const expectedWeekCount = [today, addDays(today, -1)].filter(
        (d) => isoWeekOf(d) === isoWeekOf(today),
      ).length;
      expect(habit).toMatchObject({ doneToday: true, streak: 2, weekCount: expectedWeekCount });
    });
  });

  describe('DELETE /api/habits/:id/checkin (undo)', () => {
    it('undoes today only; second undo → 404', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Undoable',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const today = localDateFor('Europe/Berlin');
      // yesterday's checkin must survive the undo
      await db
        .insert(checkins)
        .values({ habitId: id, userId: userAId, localDate: addDays(today, -1) });
      await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieA);

      const res = await request(app).delete(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const habit = await getHabit(cookieA, id);
      expect(habit).toMatchObject({ doneToday: false, streak: 1 }); // yesterday's run remains

      const yesterdayRows = await db
        .select()
        .from(checkins)
        .where(and(eq(checkins.habitId, id), eq(checkins.localDate, addDays(today, -1))));
      expect(yesterdayRows).toHaveLength(1);

      const again = await request(app).delete(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe('not_found');
    });

    it('nothing checked today → 404', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Never done',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const res = await request(app).delete(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it("foreign habit → 404 and B's checkin untouched", async () => {
      const { id } = await createHabit(cookieB, {
        name: "B's done habit",
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      await request(app).post(`/api/habits/${id}/checkin`).set('Cookie', cookieB);

      const res = await request(app).delete(`/api/habits/${id}/checkin`).set('Cookie', cookieA);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');

      const rows = await db.select().from(checkins).where(eq(checkins.habitId, id));
      expect(rows).toHaveLength(1);
    });

    it('bogus (non-uuid) :id → 404 envelope', async () => {
      const res = await request(app).delete('/api/habits/not-a-uuid/checkin').set('Cookie', cookieA);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });

  describe('archive idempotency (Task 6 review carry-over)', () => {
    it('re-archiving an already-archived habit → 404', async () => {
      const { id } = await createHabit(cookieA, {
        name: 'Archive twice',
        categoryId: builtinCatId,
        frequencyType: 'daily',
      });
      const first = await request(app).post(`/api/habits/${id}/archive`).set('Cookie', cookieA);
      expect(first.status).toBe(200);

      const second = await request(app).post(`/api/habits/${id}/archive`).set('Cookie', cookieA);
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe('not_found');
    });
  });
});
