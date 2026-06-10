import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { inArray, like } from 'drizzle-orm';
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

// Task 14: GET /api/achievements — catalog LEFT JOIN the user's unlocks,
// contract shape {id, name, description, emoji, unlockedAt}, catalog order.

const USER_PREFIX = 'achroutetest-';
const PASSWORD = 'achievements route password';

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

async function makeUser(): Promise<TestUser> {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash })
    .returning();
  const [cat] = await db
    .insert(categories)
    .values({ userId: user!.id, name: `AchRouteCat-${n}`, emoji: '🏷️', color: '#123456' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
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
  await cleanup();
  passwordHash = await bcrypt.hash(PASSWORD, 10);
  // Test DB is unseeded — insert the catalog idempotently (slug text PK).
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

describe('GET /api/achievements', () => {
  it('requires auth → 401', async () => {
    const res = await request(app).get('/api/achievements');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('fresh user sees the full catalog, all locked, in catalog order', async () => {
    const u = await makeUser();
    const res = await request(app).get('/api/achievements').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(ACHIEVEMENT_CATALOG.length);
    expect(res.body.map((a: { id: string }) => a.id)).toEqual(
      ACHIEVEMENT_CATALOG.map((a) => a.id),
    );
    for (const entry of res.body as Array<Record<string, unknown>>) {
      const def = ACHIEVEMENT_CATALOG.find((a) => a.id === entry.id)!;
      expect(entry).toEqual({
        id: def.id,
        name: def.name,
        description: def.description,
        emoji: def.emoji,
        unlockedAt: null,
      });
    }
  });

  it('after a check-in, first-checkin is unlocked with a timestamp; the rest stay locked', async () => {
    const u = await makeUser();
    const created = await request(app)
      .post('/api/habits')
      .set('Cookie', u.cookie)
      .send({ name: 'Read', categoryId: u.categoryId, frequencyType: 'daily' });
    expect(created.status).toBe(201);
    const checkin = await request(app)
      .post(`/api/habits/${created.body.id}/checkin`)
      .set('Cookie', u.cookie);
    expect(checkin.status).toBe(200);

    const res = await request(app).get('/api/achievements').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    const byId = new Map(
      (res.body as Array<{ id: string; unlockedAt: string | null }>).map((a) => [a.id, a]),
    );
    const first = byId.get('first-checkin')!;
    expect(typeof first.unlockedAt).toBe('string');
    expect(Number.isNaN(Date.parse(first.unlockedAt!))).toBe(false);
    expect(byId.get('checkins-100')!.unlockedAt).toBeNull();
  });
});
