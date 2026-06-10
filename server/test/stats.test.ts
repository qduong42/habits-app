import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, categories, habits, checkins } from '../src/db/schema.js';
import { addDays, localDateFor } from '../src/game/dates.js';
import { createApp } from '../src/app.js';

// Task 17: GET /api/stats — overall + per-habit aggregates per the shared
// contract. Seeding is deterministic: all dates are computed with addDays
// relative to "today" in the user's timezone (Europe/Berlin default), and
// week-spaced check-ins (today-7, today-21) always land exactly 1 / 3 ISO
// weeks back because 7-day steps preserve the weekday.

const USER_PREFIX = 'statstest-';
const PASSWORD = 'stats test password';

const app = createApp();
const TODAY = localDateFor('Europe/Berlin');

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

async function makeUser(): Promise<TestUser> {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash })
    .returning();
  const [cat] = await db
    .insert(categories)
    .values({ userId: user!.id, name: `StatsCat-${n}`, emoji: '🧘', color: '#5e35b1' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
}

async function createHabit(cookie: string, body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/habits').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** Insert check-ins directly for `offsets` days back from today (0 = today). */
async function seedCheckins(userId: string, habitId: string, offsets: number[]): Promise<void> {
  await db
    .insert(checkins)
    .values(offsets.map((n) => ({ userId, habitId, localDate: addDays(TODAY, -n) })));
}

async function getStats(cookie: string) {
  return request(app).get('/api/stats').set('Cookie', cookie);
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(checkins).where(inArray(checkins.userId, ids));
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(categories).where(inArray(categories.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup(); // in case a previous run died mid-test
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

afterAll(cleanup);

describe('GET /api/stats', () => {
  it('without cookie → 401 envelope', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('brand-new user → zeros and empty habits', async () => {
    const u = await makeUser();
    const res = await getStats(u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      dayStreak: 0,
      totalCheckins: 0,
      xpTotal: 0,
      level: 1,
      habits: [],
    });
  });

  it('full contract: daily + weekly habits with seeded history', async () => {
    const u = await makeUser();
    await db.update(users).set({ xpTotal: 2345 }).where(eq(users.id, u.id));

    const dailyId = await createHabit(u.cookie, {
      name: 'Meditate',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    const weeklyId = await createHabit(u.cookie, {
      name: 'Long run',
      categoryId: u.categoryId,
      frequencyType: 'weekly',
      weeklyTarget: 1,
    });

    // Daily: current run t-1..t-3 (3 days, grace: today unchecked doesn't
    // break it) + an older 5-day run t-6..t-10 → best 5; 8 of the last 28
    // days have a check-in → last28 = round(800/28) = 29.
    await seedCheckins(u.id, dailyId, [1, 2, 3, 6, 7, 8, 9, 10]);
    // Weekly (target 1): met in current week (t-0), previous week (t-7) and
    // 3 weeks back (t-21); 2 weeks back missed → current streak 2, best 2,
    // 3 of the last 4 weeks met → last28 = 75.
    await seedCheckins(u.id, weeklyId, [0, 7, 21]);

    const res = await getStats(u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      // union of all dates: today (weekly) + t-1..t-3 (daily) → 4 consecutive
      dayStreak: 4,
      totalCheckins: 11,
      xpTotal: 2345,
      level: 3,
      habits: [
        {
          id: dailyId,
          name: 'Meditate',
          emoji: '🧘',
          streak: 3,
          bestStreak: 5,
          last28: 29,
        },
        {
          id: weeklyId,
          name: 'Long run',
          emoji: '🧘',
          streak: 2,
          bestStreak: 2,
          last28: 75,
        },
      ],
    });
  });

  it('archived habits are excluded from the list but their history still counts', async () => {
    const u = await makeUser();
    const keptId = await createHabit(u.cookie, {
      name: 'Kept',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    const archivedId = await createHabit(u.cookie, {
      name: 'Paused',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    await seedCheckins(u.id, keptId, [1]);
    await seedCheckins(u.id, archivedId, [0, 1, 2]);
    const archived = await request(app)
      .post(`/api/habits/${archivedId}/archive`)
      .set('Cookie', u.cookie);
    expect(archived.status).toBe(200);

    const res = await getStats(u.cookie);
    expect(res.status).toBe(200);
    // archived habit's check-ins keep counting: day streak runs t-2..today
    expect(res.body).toMatchObject({ dayStreak: 3, totalCheckins: 4 });
    expect(res.body.habits.map((h: { id: string }) => h.id)).toEqual([keptId]);
  });

  it('daily habit checked today only: streak 1, best 1, last28 = 4', async () => {
    const u = await makeUser();
    const habitId = await createHabit(u.cookie, {
      name: 'Fresh',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    await seedCheckins(u.id, habitId, [0]);

    const res = await getStats(u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.habits).toEqual([
      // 1 of 28 days → round(100/28) = 4
      { id: habitId, name: 'Fresh', emoji: '🧘', streak: 1, bestStreak: 1, last28: 4 },
    ]);
    expect(res.body).toMatchObject({ dayStreak: 1, totalCheckins: 1 });
  });
});
