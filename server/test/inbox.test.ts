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
  inboxItems,
  userAchievements,
} from '../src/db/schema.js';
import { ACHIEVEMENT_CATALOG } from '../src/game/achievements.js';
import { createApp } from '../src/app.js';

// Task 15: Dump (inbox) capture, list, convert-to-habit and discard.

const USER_PREFIX = 'inboxtest-';
const PASSWORD = 'inbox test password';

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
    .values({ userId: user!.id, name: `InboxCat-${n}`, emoji: '🏷️', color: '#123456' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
}

async function capture(cookie: string, body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/inbox').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

function convert(cookie: string, itemId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/inbox/${itemId}/convert`).set('Cookie', cookie).send(body);
}

function discard(cookie: string, itemId: string) {
  return request(app).post(`/api/inbox/${itemId}/discard`).set('Cookie', cookie);
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(userAchievements).where(inArray(userAchievements.userId, ids));
    await db.delete(inboxItems).where(inArray(inboxItems.userId, ids)); // FK habits → first
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

describe('POST /api/inbox (capture)', () => {
  it('201 with the InboxItem contract shape (taskId null until Task 25)', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/inbox')
      .set('Cookie', u.cookie)
      .send({ text: '  Cold showers boost mood  ', sourceUrl: 'https://example.com/post' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      text: 'Cold showers boost mood', // trimmed
      sourceUrl: 'https://example.com/post',
      status: 'open',
      habitId: null,
      taskId: null,
      createdAt: expect.any(String),
    });
  });

  it('400 validation on empty text', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/inbox')
      .set('Cookie', u.cookie)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).post('/api/inbox').send({ text: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
});

describe('GET /api/inbox (list)', () => {
  it('newest-first, own items only, only open by default; ?all=1 shows everything', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const first = await capture(u.cookie, { text: 'first thought' });
    const second = await capture(u.cookie, { text: 'second thought' });
    const third = await capture(u.cookie, { text: 'third thought' });
    await capture(other.cookie, { text: 'not yours' });
    await discard(u.cookie, second);

    const res = await request(app).get('/api/inbox').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    // newest first, discarded hidden, foreign items absent
    expect(res.body.map((i: { id: string }) => i.id)).toEqual([third, first]);

    const all = await request(app).get('/api/inbox?all=1').set('Cookie', u.cookie);
    expect(all.status).toBe(200);
    expect(all.body.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [third, 'open'],
      [second, 'discarded'],
      [first, 'open'],
    ]);
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/inbox');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/inbox/:id/convert', () => {
  it('creates the habit (notes default to item text, sourceUrl carried), links the item, awards first-conversion', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, {
      text: 'Stretch hips daily after sitting',
      sourceUrl: 'https://example.com/hips',
    });

    const res = await convert(u.cookie, itemId, {
      name: 'Hip stretches',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(res.status).toBe(200);
    expect(res.body.habit).toMatchObject({
      name: 'Hip stretches',
      notes: 'Stretch hips daily after sitting', // defaults to the item text
      sourceUrl: 'https://example.com/hips', // carried from the item
      frequencyType: 'daily',
      weeklyTarget: null,
      doneToday: false,
      streak: 0,
      category: { id: u.categoryId, builtin: false },
    });
    expect(res.body.item).toEqual({
      id: itemId,
      text: 'Stretch hips daily after sitting',
      sourceUrl: 'https://example.com/hips',
      status: 'converted',
      habitId: res.body.habit.id,
      taskId: null,
      createdAt: expect.any(String),
    });
    expect(res.body.unlockedAchievements).toEqual([
      {
        id: 'first-conversion',
        name: 'Bright Idea',
        description: 'Turn your first dump item into a habit or task.',
        emoji: '💡',
        unlockedAt: expect.any(String),
      },
    ]);

    // habit shows up in GET /habits
    const list = await request(app).get('/api/habits').set('Cookie', u.cookie);
    expect(list.body.habits.map((h: { id: string }) => h.id)).toContain(res.body.habit.id);
  });

  it('explicit notes win over the item text', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'raw dump text' });
    const res = await convert(u.cookie, itemId, {
      name: 'With notes',
      categoryId: u.categoryId,
      frequencyType: 'daily',
      notes: 'my own why',
    });
    expect(res.status).toBe(200);
    expect(res.body.habit.notes).toBe('my own why');
  });

  it('converting twice → 409 already_triaged', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'only once' });
    const body = { name: 'Once', categoryId: u.categoryId, frequencyType: 'daily' };
    expect((await convert(u.cookie, itemId, body)).status).toBe(200);

    const dup = await convert(u.cookie, itemId, body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_triaged');
  });

  it('weekly convert without weeklyTarget → 400', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'weekly thing' });
    const res = await convert(u.cookie, itemId, {
      name: 'Weekly',
      categoryId: u.categoryId,
      frequencyType: 'weekly',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it("foreign user's item → 404; bogus uuid → 404", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const itemId = await capture(other.cookie, { text: 'mine, not yours' });

    const body = { name: 'Steal', categoryId: u.categoryId, frequencyType: 'daily' };
    const foreign = await convert(u.cookie, itemId, body);
    expect(foreign.status).toBe(404);
    const bogus = await convert(u.cookie, 'not-a-uuid', body);
    expect(bogus.status).toBe(404);
  });

  it('conversions-5 unlocks on the 5th convert', async () => {
    const u = await makeUser();
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push(await capture(u.cookie, { text: `idea ${i}` }));
    const responses = [];
    for (const [i, id] of ids.entries()) {
      const res = await convert(u.cookie, id, {
        name: `Idea habit ${i}`,
        categoryId: u.categoryId,
        frequencyType: 'daily',
      });
      expect(res.status).toBe(200);
      responses.push(res);
    }
    const unlockedIds = (r: { body: { unlockedAchievements: { id: string }[] } }) =>
      r.body.unlockedAchievements.map((a) => a.id);
    expect(unlockedIds(responses[0]!)).toEqual(['first-conversion']);
    expect(unlockedIds(responses[1]!)).toEqual([]);
    expect(unlockedIds(responses[4]!)).toEqual(['conversions-5']);
  });

  it('a check-in sees the real conversions count in its achievement ctx', async () => {
    const u = await makeUser();
    // Seed 5 already-converted items directly so no convert EVENT ever ran —
    // only the check-in path can unlock the conversion achievements.
    await db.insert(inboxItems).values(
      Array.from({ length: 5 }, (_, i) => ({
        userId: u.id,
        text: `pre-converted ${i}`,
        status: 'converted' as const,
      })),
    );
    const habitRes = await request(app)
      .post('/api/habits')
      .set('Cookie', u.cookie)
      .send({ name: 'Checker', categoryId: u.categoryId, frequencyType: 'daily' });
    expect(habitRes.status).toBe(201);

    const res = await request(app)
      .post(`/api/habits/${habitRes.body.id}/checkin`)
      .set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.unlockedAchievements.map((a: { id: string }) => a.id);
    expect(ids).toContain('first-conversion');
    expect(ids).toContain('conversions-5'); // conversions ≥ 5 visible to the check-in ctx
  });
});

describe('POST /api/inbox/:id/discard', () => {
  it('marks the item discarded; convert afterwards → 409', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'let it go' });

    const res = await discard(u.cookie, itemId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: itemId, status: 'discarded', habitId: null });

    const after = await convert(u.cookie, itemId, {
      name: 'Too late',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('already_triaged');
  });

  it('discarding twice → 409; foreign/bogus item → 404', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const itemId = await capture(u.cookie, { text: 'gone' });
    await discard(u.cookie, itemId);

    const dup = await discard(u.cookie, itemId);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_triaged');

    const foreignId = await capture(other.cookie, { text: 'not yours' });
    expect((await discard(u.cookie, foreignId)).status).toBe(404);
    expect((await discard(u.cookie, 'nope')).status).toBe(404);
  });
});
