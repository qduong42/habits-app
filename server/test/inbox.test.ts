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
  tasks,
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

function convertTask(cookie: string, itemId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/inbox/${itemId}/convert-task`).set('Cookie', cookie).send(body);
}

function discard(cookie: string, itemId: string, body?: Record<string, unknown>) {
  const req = request(app).post(`/api/inbox/${itemId}/discard`).set('Cookie', cookie);
  return body === undefined ? req : req.send(body);
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(userAchievements).where(inArray(userAchievements.userId, ids));
    await db.delete(inboxItems).where(inArray(inboxItems.userId, ids)); // FK habits/tasks → first
    await db.delete(checkins).where(inArray(checkins.userId, ids));
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(tasks).where(inArray(tasks.userId, ids)); // task_completions cascade
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
      discardNote: null,
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
    const fourth = await capture(u.cookie, { text: 'fourth thought' });
    await capture(other.cookie, { text: 'not yours' });
    await discard(u.cookie, second);
    expect(
      (
        await convert(u.cookie, fourth, {
          name: 'Fourth habit',
          categoryId: u.categoryId,
          frequencyType: 'daily',
        })
      ).status,
    ).toBe(200);

    const res = await request(app).get('/api/inbox').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    // newest first; discarded AND converted hidden by default; foreign items absent
    expect(res.body.map((i: { id: string }) => i.id)).toEqual([third, first]);

    const all = await request(app).get('/api/inbox?all=1').set('Cookie', u.cookie);
    expect(all.status).toBe(200);
    expect(all.body.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [fourth, 'converted'],
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
      discardNote: null,
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

  it("foreign user's categoryId → 404 and the item stays open (rollback)", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const itemId = await capture(u.cookie, { text: 'wrong category' });

    const res = await convert(u.cookie, itemId, {
      name: 'Wrong cat',
      categoryId: other.categoryId, // not usable by u → createHabit 404s inside the tx
      frequencyType: 'daily',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');

    // The transaction rolled back: the item is still open and convertible.
    const list = await request(app).get('/api/inbox').set('Cookie', u.cookie);
    expect(list.body.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [itemId, 'open'],
    ]);
    const retry = await convert(u.cookie, itemId, {
      name: 'Right cat',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(retry.status).toBe(200);
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

describe('POST /api/inbox/:id/convert-task (Task 27)', () => {
  it('creates an undated one-off (notes default to item text, sourceUrl carried), links the item, awards first-conversion', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, {
      text: 'Buy fertilizer for the balcony plants',
      sourceUrl: 'https://example.com/plants',
    });

    const res = await convertTask(u.cookie, itemId, { name: 'Buy fertilizer' });
    expect(res.status).toBe(200);
    expect(res.body.task).toEqual({
      id: expect.any(String),
      name: 'Buy fertilizer',
      notes: 'Buy fertilizer for the balcony plants', // defaults to the item text
      sourceUrl: 'https://example.com/plants', // carried from the item
      kind: 'oneoff',
      group: 'undated',
      dueLabel: null,
      dueDate: null,
      intervalHours: null,
      nextDue: null,
      remindAt: null,
      remindedAt: null,
      todayNote: null,
    });
    expect(res.body.item).toEqual({
      id: itemId,
      text: 'Buy fertilizer for the balcony plants',
      sourceUrl: 'https://example.com/plants',
      status: 'converted',
      habitId: null, // exactly one of habitId/taskId when converted
      taskId: res.body.task.id,
      discardNote: null,
      createdAt: expect.any(String),
    });
    // first-conversion unlocks through the convert-task path too
    expect(res.body.unlockedAchievements).toEqual([
      {
        id: 'first-conversion',
        name: 'Bright Idea',
        description: 'Turn your first dump item into a habit or task.',
        emoji: '💡',
        unlockedAt: expect.any(String),
      },
    ]);

    // the task shows up in GET /tasks (undated → in the default list)
    const list = await request(app).get('/api/tasks').set('Cookie', u.cookie);
    expect(list.body.tasks.map((t: { id: string }) => t.id)).toContain(res.body.task.id);
  });

  it('dueDate makes a dated one-off; intervalHours makes a recurring task', async () => {
    const u = await makeUser();
    const datedId = await capture(u.cookie, { text: 'file the taxes' });
    const before = Date.now();
    const dated = await convertTask(u.cookie, datedId, {
      name: 'File taxes',
      dueDate: '2099-01-01',
    });
    expect(dated.status).toBe(200);
    expect(dated.body.task).toMatchObject({
      kind: 'oneoff',
      dueDate: '2099-01-01',
      intervalHours: null,
      nextDue: null,
      group: 'scheduled', // far-future one-off is not yet actionable
    });

    const recurringId = await capture(u.cookie, { text: 'water the plants' });
    const recurring = await convertTask(u.cookie, recurringId, {
      name: 'Water plants',
      intervalHours: 12,
    });
    expect(recurring.status).toBe(200);
    expect(recurring.body.task).toMatchObject({
      kind: 'recurring',
      intervalHours: 12,
      dueDate: null,
      group: 'scheduled', // due one interval from creation
    });
    // nextDue ≈ creation + 12h
    const nextDue = Date.parse(recurring.body.task.nextDue);
    expect(nextDue).toBeGreaterThanOrEqual(before + 12 * 3_600_000);
    expect(nextDue).toBeLessThanOrEqual(Date.now() + 12 * 3_600_000);
    expect(recurring.body.item).toMatchObject({
      status: 'converted',
      taskId: recurring.body.task.id,
      habitId: null,
    });
  });

  it('explicit notes win over the item text', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'raw dump text' });
    const res = await convertTask(u.cookie, itemId, { name: 'With notes', notes: 'my own why' });
    expect(res.status).toBe(200);
    expect(res.body.task.notes).toBe('my own why');
  });

  it('validation 400: dueDate AND intervalHours together; name > 200 chars; intervalHours < 1', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'invalid combos' });

    const both = await convertTask(u.cookie, itemId, {
      name: 'Both',
      dueDate: '2026-07-01',
      intervalHours: 24,
    });
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('validation');

    const longName = await convertTask(u.cookie, itemId, { name: 'x'.repeat(201) });
    expect(longName.status).toBe(400);

    const tinyInterval = await convertTask(u.cookie, itemId, { name: 'Tiny', intervalHours: 0 });
    expect(tinyInterval.status).toBe(400);

    // none of the failures triaged the item
    const list = await request(app).get('/api/inbox').set('Cookie', u.cookie);
    expect(list.body.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [itemId, 'open'],
    ]);
  });

  it('already-triaged item → 409 already_triaged (convert-task twice, and after a habit convert)', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'only once' });
    expect((await convertTask(u.cookie, itemId, { name: 'Once' })).status).toBe(200);

    const dup = await convertTask(u.cookie, itemId, { name: 'Twice' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_triaged');

    const habitFirst = await capture(u.cookie, { text: 'habit first' });
    expect(
      (
        await convert(u.cookie, habitFirst, {
          name: 'Habit first',
          categoryId: u.categoryId,
          frequencyType: 'daily',
        })
      ).status,
    ).toBe(200);
    const afterHabit = await convertTask(u.cookie, habitFirst, { name: 'Too late' });
    expect(afterHabit.status).toBe(409);
    expect(afterHabit.body.error.code).toBe('already_triaged');
  });

  it("foreign user's item → 404; bogus uuid → 404; missing uuid → 404", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const foreignId = await capture(other.cookie, { text: 'mine, not yours' });

    expect((await convertTask(u.cookie, foreignId, { name: 'Steal' })).status).toBe(404);
    expect((await convertTask(u.cookie, 'not-a-uuid', { name: 'Bogus' })).status).toBe(404);
    expect(
      (
        await convertTask(u.cookie, '00000000-0000-4000-8000-000000000000', { name: 'Ghost' })
      ).status,
    ).toBe(404);
  });

  it('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/inbox/00000000-0000-4000-8000-000000000000/convert-task')
      .send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('habit and task conversions bump the SAME conversions count (conversions-5 mixing both paths)', async () => {
    const u = await makeUser();
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push(await capture(u.cookie, { text: `idea ${i}` }));

    const unlockedIds = (r: { body: { unlockedAchievements: { id: string }[] } }) =>
      r.body.unlockedAchievements.map((a) => a.id);

    // 1st + 2nd via habit convert, 3rd + 4th + 5th via convert-task
    const first = await convert(u.cookie, ids[0]!, {
      name: 'Idea habit 1',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(first.status).toBe(200);
    expect(unlockedIds(first)).toEqual(['first-conversion']);

    const second = await convert(u.cookie, ids[1]!, {
      name: 'Idea habit 2',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(unlockedIds(second)).toEqual([]);

    const third = await convertTask(u.cookie, ids[2]!, { name: 'Idea task 3' });
    expect(third.status).toBe(200);
    expect(unlockedIds(third)).toEqual([]);
    const fourth = await convertTask(u.cookie, ids[3]!, { name: 'Idea task 4' });
    expect(unlockedIds(fourth)).toEqual([]);

    // the 5th conversion — a TASK convert — crosses the shared threshold
    const fifth = await convertTask(u.cookie, ids[4]!, { name: 'Idea task 5', intervalHours: 24 });
    expect(fifth.status).toBe(200);
    expect(unlockedIds(fifth)).toEqual(['conversions-5']);
  });
});

describe('deleting a converted habit/task keeps the inbox item (FK ON DELETE SET NULL)', () => {
  it('DELETE /api/tasks/:id on a converted task → 200; item stays converted with taskId null', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'short-lived task' });
    const converted = await convertTask(u.cookie, itemId, { name: 'Short-lived' });
    expect(converted.status).toBe(200);
    const taskId = converted.body.task.id as string;

    const del = await request(app).delete(`/api/tasks/${taskId}`).set('Cookie', u.cookie);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    // the dump history survives — the link just clears
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId));
    expect(item).toMatchObject({ status: 'converted', taskId: null, habitId: null });
  });

  it('DELETE /api/habits/:id on a converted habit → 200; item stays converted with habitId null', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'short-lived habit' });
    const converted = await convert(u.cookie, itemId, {
      name: 'Short-lived habit',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(converted.status).toBe(200);
    const habitId = converted.body.habit.id as string;

    const del = await request(app).delete(`/api/habits/${habitId}`).set('Cookie', u.cookie);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId));
    expect(item).toMatchObject({ status: 'converted', habitId: null, taskId: null });
  });
});

// v1.1 follow-up: clear braindump History — hard delete of NON-open items,
// per item (DELETE /inbox/:id) and per day group (POST /inbox/history/clear).
describe('DELETE /api/inbox/:id (clear one history item)', () => {
  it('hard-deletes a discarded item → {ok:true}; gone from ?all=1', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'old thought' });
    await discard(u.cookie, itemId);

    const res = await request(app).delete(`/api/inbox/${itemId}`).set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const all = await request(app).get('/api/inbox?all=1').set('Cookie', u.cookie);
    expect(all.body.map((i: { id: string }) => i.id)).not.toContain(itemId);

    // deleting twice → 404 (the row is gone)
    const again = await request(app).delete(`/api/inbox/${itemId}`).set('Cookie', u.cookie);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('not_found');
  });

  it('deleting a converted item never touches the created habit or task', async () => {
    const u = await makeUser();

    const habitItem = await capture(u.cookie, { text: 'becomes a habit' });
    const habitRes = await convert(u.cookie, habitItem, {
      name: 'Survivor habit',
      categoryId: u.categoryId,
      frequencyType: 'daily',
    });
    expect(habitRes.status).toBe(200);

    const taskItem = await capture(u.cookie, { text: 'becomes a task' });
    const taskRes = await convertTask(u.cookie, taskItem, { name: 'Survivor task' });
    expect(taskRes.status).toBe(200);

    for (const id of [habitItem, taskItem]) {
      const del = await request(app).delete(`/api/inbox/${id}`).set('Cookie', u.cookie);
      expect(del.status).toBe(200);
    }

    const habitsList = await request(app).get('/api/habits').set('Cookie', u.cookie);
    expect(habitsList.body.habits.map((h: { id: string }) => h.id)).toContain(
      habitRes.body.habit.id,
    );
    const tasksList = await request(app).get('/api/tasks').set('Cookie', u.cookie);
    expect(tasksList.body.tasks.map((t: { id: string }) => t.id)).toContain(taskRes.body.task.id);
  });

  it("open item → 409 still_open (open items must use Discard, not delete)", async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'still on my mind' });

    const res = await request(app).delete(`/api/inbox/${itemId}`).set('Cookie', u.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('still_open');

    // the item is untouched and still discardable
    expect((await discard(u.cookie, itemId)).status).toBe(200);
  });

  it("foreign user's item → 404; bogus uuid → 404; missing uuid → 404", async () => {
    const u = await makeUser();
    const other = await makeUser();
    const foreignId = await capture(other.cookie, { text: 'not yours to clear' });
    await discard(other.cookie, foreignId);

    const foreign = await request(app).delete(`/api/inbox/${foreignId}`).set('Cookie', u.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('not_found');
    // the other user's history row survives the attempt
    const all = await request(app).get('/api/inbox?all=1').set('Cookie', other.cookie);
    expect(all.body.map((i: { id: string }) => i.id)).toContain(foreignId);

    expect((await request(app).delete('/api/inbox/not-a-uuid').set('Cookie', u.cookie)).status).toBe(404);
    expect(
      (
        await request(app)
          .delete('/api/inbox/00000000-0000-4000-8000-000000000000')
          .set('Cookie', u.cookie)
      ).status,
    ).toBe(404);
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).delete('/api/inbox/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/inbox/history/clear (clear a day group)', () => {
  function clear(cookie: string, body: Record<string, unknown>) {
    return request(app).post('/api/inbox/history/clear').set('Cookie', cookie).send(body);
  }

  it("deletes the caller's NON-open items among ids; open/foreign/missing ids ignored → {deleted: n}", async () => {
    const u = await makeUser();
    const other = await makeUser();

    const discarded = await capture(u.cookie, { text: 'discarded one' });
    await discard(u.cookie, discarded);
    const converted = await capture(u.cookie, { text: 'converted one' });
    expect((await convertTask(u.cookie, converted, { name: 'Converted' })).status).toBe(200);
    const stillOpen = await capture(u.cookie, { text: 'still open' });
    const foreign = await capture(other.cookie, { text: 'foreign history' });
    await discard(other.cookie, foreign);

    const res = await clear(u.cookie, {
      ids: [discarded, converted, stillOpen, foreign, '00000000-0000-4000-8000-000000000000'],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 }); // only the caller's history rows

    const all = await request(app).get('/api/inbox?all=1').set('Cookie', u.cookie);
    // open item survived; both history items are gone
    expect(all.body.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [stillOpen, 'open'],
    ]);
    // the foreign user's history is untouched
    const otherAll = await request(app).get('/api/inbox?all=1').set('Cookie', other.cookie);
    expect(otherAll.body.map((i: { id: string }) => i.id)).toContain(foreign);
  });

  it('validation 400: missing ids, empty ids, non-uuid entry, more than 500 ids', async () => {
    const u = await makeUser();
    for (const body of [
      {},
      { ids: [] },
      { ids: ['not-a-uuid'] },
      { ids: Array.from({ length: 501 }, () => '00000000-0000-4000-8000-000000000000') },
    ]) {
      const res = await clear(u.cookie, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    }
  });

  it('401 unauthenticated', async () => {
    const res = await request(app)
      .post('/api/inbox/history/clear')
      .send({ ids: ['00000000-0000-4000-8000-000000000000'] });
    expect(res.status).toBe(401);
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

  it('stores an optional answer note (trimmed) and serializes it everywhere', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'sasi teeth is ok?' });

    const res = await discard(u.cookie, itemId, { note: '  answered: yes  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: itemId,
      status: 'discarded',
      discardNote: 'answered: yes', // trimmed
    });

    // the note survives into the ?all=1 listing (History data source)
    const all = await request(app).get('/api/inbox?all=1').set('Cookie', u.cookie);
    expect(all.status).toBe(200);
    expect(all.body).toEqual([
      expect.objectContaining({ id: itemId, status: 'discarded', discardNote: 'answered: yes' }),
    ]);
  });

  it('empty/whitespace note or no body → discardNote null', async () => {
    const u = await makeUser();

    const noBody = await discard(u.cookie, await capture(u.cookie, { text: 'no body' }));
    expect(noBody.status).toBe(200);
    expect(noBody.body).toMatchObject({ status: 'discarded', discardNote: null });

    const emptyBody = await discard(u.cookie, await capture(u.cookie, { text: 'empty body' }), {});
    expect(emptyBody.status).toBe(200);
    expect(emptyBody.body).toMatchObject({ status: 'discarded', discardNote: null });

    const emptyNote = await discard(u.cookie, await capture(u.cookie, { text: 'empty note' }), {
      note: '',
    });
    expect(emptyNote.status).toBe(200);
    expect(emptyNote.body).toMatchObject({ status: 'discarded', discardNote: null });

    const whitespace = await discard(u.cookie, await capture(u.cookie, { text: 'whitespace' }), {
      note: '   \n ',
    });
    expect(whitespace.status).toBe(200);
    expect(whitespace.body).toMatchObject({ status: 'discarded', discardNote: null });
  });

  it('note longer than 2000 chars → 400 validation; the item stays open', async () => {
    const u = await makeUser();
    const itemId = await capture(u.cookie, { text: 'long note' });

    const res = await discard(u.cookie, itemId, { note: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');

    // the failed discard did not triage the item — a retry still works
    const retry = await discard(u.cookie, itemId, { note: 'x'.repeat(2000) });
    expect(retry.status).toBe(200);
    expect(retry.body.discardNote).toBe('x'.repeat(2000));
  });

  it('a note in the convert bodies is ignored — discardNote stays null on conversions', async () => {
    const u = await makeUser();

    const habitItem = await capture(u.cookie, { text: 'habit with stray note' });
    const habitRes = await convert(u.cookie, habitItem, {
      name: 'Stray note habit',
      categoryId: u.categoryId,
      frequencyType: 'daily',
      note: 'should be ignored',
    });
    expect(habitRes.status).toBe(200);
    expect(habitRes.body.item).toMatchObject({ status: 'converted', discardNote: null });

    const taskItem = await capture(u.cookie, { text: 'task with stray note' });
    const taskRes = await convertTask(u.cookie, taskItem, {
      name: 'Stray note task',
      note: 'should be ignored',
    });
    expect(taskRes.status).toBe(200);
    expect(taskRes.body.item).toMatchObject({ status: 'converted', discardNote: null });
  });
});
