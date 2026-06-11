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
  tasks,
  taskCompletions,
} from '../src/db/schema.js';
import { addDays, localDateFor } from '../src/game/dates.js';
import { createApp } from '../src/app.js';

// v1.2 Task 1: GET /api/history — read-only merged timeline of check-ins and
// task completions (spec §1). Seeding inserts rows directly with explicit,
// staggered createdAt values so the cross-table newest-first merge order is
// deterministic and the two kinds provably interleave.

const USER_PREFIX = 'historytest-';
const PASSWORD = 'history test password';

const app = createApp();
const TODAY = localDateFor('Europe/Berlin');
const YESTERDAY = addDays(TODAY, -1);

// Fixed base instant in the past; offsets in minutes define the timeline.
const BASE = new Date('2026-06-01T10:00:00.000Z');
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000);

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
    .values({ userId: user!.id, name: `HistoryCat-${n}`, emoji: '🌱', color: '#2e7d32' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
}

/**
 * Seed one habit (+2 check-ins on different localDates) and one recurring
 * task (+2 completions on the same localDate), createdAt interleaved across
 * the two tables: checkin(+1) < completion(+2) < checkin(+3) < completion(+4).
 */
async function seedTimeline(u: TestUser) {
  const [habit] = await db
    .insert(habits)
    .values({
      userId: u.id,
      categoryId: u.categoryId,
      name: 'Stretch',
      frequencyType: 'daily',
    })
    .returning();
  const [task] = await db
    .insert(tasks)
    .values({
      userId: u.id,
      name: 'Water plants',
      intervalHours: 12, // recurring: sub-daily, so two same-day completions are legit
      nextDue: at(0),
    })
    .returning();

  await db.insert(checkins).values([
    { userId: u.id, habitId: habit!.id, localDate: YESTERDAY, createdAt: at(1) },
    { userId: u.id, habitId: habit!.id, localDate: TODAY, createdAt: at(3) },
  ]);
  await db.insert(taskCompletions).values([
    { userId: u.id, taskId: task!.id, localDate: TODAY, createdAt: at(2) },
    { userId: u.id, taskId: task!.id, localDate: TODAY, createdAt: at(4) },
  ]);
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(taskCompletions).where(inArray(taskCompletions.userId, ids));
    await db.delete(tasks).where(inArray(tasks.userId, ids));
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

describe('GET /api/history', () => {
  it('without cookie → 401 envelope', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('merges check-ins and completions newest-createdAt-first with the contract shape', async () => {
    const u = await makeUser();
    await seedTimeline(u);

    const res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(4);

    // Newest first across BOTH tables: +4 completion, +3 checkin, +2 completion, +1 checkin.
    expect(res.body.entries.map((e: { kind: string }) => e.kind)).toEqual([
      'completion',
      'checkin',
      'completion',
      'checkin',
    ]);
    expect(res.body.entries.map((e: { createdAt: string }) => e.createdAt)).toEqual([
      at(4).toISOString(),
      at(3).toISOString(),
      at(2).toISOString(),
      at(1).toISOString(),
    ]);

    // Habit entries carry kind 'checkin' and the habit's name; task entries
    // 'completion' and the task's name; localDate is the stored user-TZ date.
    expect(res.body.entries[0]).toEqual({
      id: expect.any(String),
      kind: 'completion',
      name: 'Water plants',
      localDate: TODAY,
      createdAt: at(4).toISOString(),
    });
    expect(res.body.entries[3]).toEqual({
      id: expect.any(String),
      kind: 'checkin',
      name: 'Stretch',
      localDate: YESTERDAY,
      createdAt: at(1).toISOString(),
    });
  });

  it('is isolated per user — a second user sees none of it', async () => {
    const u1 = await makeUser();
    await seedTimeline(u1);
    const u2 = await makeUser();

    const res = await request(app).get('/api/history').set('Cookie', u2.cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('?limit=2 returns only the 2 newest entries', async () => {
    const u = await makeUser();
    await seedTimeline(u);

    const res = await request(app).get('/api/history?limit=2').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e: { createdAt: string }) => e.createdAt)).toEqual([
      at(4).toISOString(),
      at(3).toISOString(),
    ]);
  });

  // QA gap #1 fix (a): one-offs record doneness as tasks.completedAt (no
  // task_completions row), so history scans them as a third read-only source.
  // Full API round-trip on purpose: complete and undo are the real write paths
  // the view must stay consistent with.
  it('shows a completed one-off task and drops it again on undo', async () => {
    const u = await makeUser();
    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'File taxes' });
    expect(created.status).toBe(201);
    const id: string = created.body.id;

    // Not completed yet → invisible.
    let res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries).toEqual([]);

    expect(
      (await request(app).post(`/api/tasks/${id}/complete`).set('Cookie', u.cookie)).status,
    ).toBe(200);
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({
      id,
      kind: 'completion',
      name: 'File taxes',
      localDate: TODAY,
    });
    expect(typeof res.body.entries[0].createdAt).toBe('string');

    // Undo clears completedAt → entry disappears (read view stays consistent).
    expect(
      (await request(app).delete(`/api/tasks/${id}/complete`).set('Cookie', u.cookie)).status,
    ).toBe(200);
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries).toEqual([]);
  });
});
