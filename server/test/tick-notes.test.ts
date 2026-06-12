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
  userAchievements,
} from '../src/db/schema.js';
import { createApp } from '../src/app.js';

// Tick notes (new_features.md 2026-06-12): an optional note on today's
// check-in / completion ("climbing 1 hr"), set AFTER the tick via the
// "+ note" chip. PUT is idempotent set/edit; empty note clears to null.
// Notes surface as `todayNote` on the list contracts and `note` on history.

const USER_PREFIX = 'ticknotetest-';
const PASSWORD = 'tick note test password';

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
    .values({ userId: user!.id, name: `TickNoteCat-${n}`, emoji: '💪', color: '#2e7d32' })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`), categoryId: cat!.id };
}

async function makeHabit(u: TestUser): Promise<string> {
  const [habit] = await db
    .insert(habits)
    .values({ userId: u.id, categoryId: u.categoryId, name: 'Strength', frequencyType: 'daily' })
    .returning();
  return habit!.id;
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.name, `${USER_PREFIX}%`));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(userAchievements).where(inArray(userAchievements.userId, ids));
    await db.delete(taskCompletions).where(inArray(taskCompletions.userId, ids));
    await db.delete(tasks).where(inArray(tasks.userId, ids));
    await db.delete(checkins).where(inArray(checkins.userId, ids));
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(categories).where(inArray(categories.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup();
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

afterAll(cleanup);

describe('habit check-in notes', () => {
  it('sets, edits, and clears the note on today’s check-in; surfaces in list + history', async () => {
    const u = await makeUser();
    const habitId = await makeHabit(u);
    await request(app).post(`/api/habits/${habitId}/checkin`).set('Cookie', u.cookie).expect(200);

    let res = await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', u.cookie)
      .send({ note: '  climbing 1 hr  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: 'climbing 1 hr' });

    res = await request(app).get('/api/habits').set('Cookie', u.cookie);
    expect(res.body.habits[0].todayNote).toBe('climbing 1 hr');

    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries[0]).toMatchObject({ kind: 'checkin', note: 'climbing 1 hr' });

    // Edit overwrites; empty clears to null.
    await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'bouldering' })
      .expect(200);
    res = await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', u.cookie)
      .send({ note: '' });
    expect(res.body).toEqual({ note: null });
    res = await request(app).get('/api/habits').set('Cookie', u.cookie);
    expect(res.body.habits[0].todayNote).toBeNull();
  });

  it('404s without a check-in today, on foreign habits, and 400s past 2000 chars', async () => {
    const u = await makeUser();
    const habitId = await makeHabit(u);

    await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'x' })
      .expect(404);

    await request(app).post(`/api/habits/${habitId}/checkin`).set('Cookie', u.cookie).expect(200);
    await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'y'.repeat(2001) })
      .expect(400);

    const stranger = await makeUser();
    await request(app)
      .put(`/api/habits/${habitId}/checkin-note`)
      .set('Cookie', stranger.cookie)
      .send({ note: 'not mine' })
      .expect(404);
  });
});

describe('task completion notes', () => {
  it('recurring: notes today’s completion; undo deletes the note with the row', async () => {
    const u = await makeUser();
    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Water plants', intervalHours: 24 });
    const id: string = created.body.id;
    await request(app).post(`/api/tasks/${id}/complete`).set('Cookie', u.cookie).expect(200);

    let res = await request(app)
      .put(`/api/tasks/${id}/completion-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'used the big can' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: 'used the big can' });

    res = await request(app).get('/api/tasks?all=1').set('Cookie', u.cookie);
    expect(res.body.tasks.find((t: { id: string }) => t.id === id).todayNote).toBe(
      'used the big can',
    );
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries[0]).toMatchObject({ kind: 'completion', note: 'used the big can' });

    await request(app).delete(`/api/tasks/${id}/complete`).set('Cookie', u.cookie).expect(200);
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries).toEqual([]);
  });

  it('one-off: notes the completion; undo clears it so a re-complete starts clean', async () => {
    const u = await makeUser();
    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'File taxes' });
    const id: string = created.body.id;

    // No completion today yet → nothing to note.
    await request(app)
      .put(`/api/tasks/${id}/completion-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'x' })
      .expect(404);

    await request(app).post(`/api/tasks/${id}/complete`).set('Cookie', u.cookie).expect(200);
    await request(app)
      .put(`/api/tasks/${id}/completion-note`)
      .set('Cookie', u.cookie)
      .send({ note: 'done at the bank' })
      .expect(200);

    let res = await request(app).get('/api/tasks?all=1').set('Cookie', u.cookie);
    expect(res.body.tasks.find((t: { id: string }) => t.id === id).todayNote).toBe(
      'done at the bank',
    );
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries[0]).toMatchObject({ kind: 'completion', note: 'done at the bank' });

    // Undo clears completedAt AND the note; re-complete must not resurrect it.
    await request(app).delete(`/api/tasks/${id}/complete`).set('Cookie', u.cookie).expect(200);
    await request(app).post(`/api/tasks/${id}/complete`).set('Cookie', u.cookie).expect(200);
    res = await request(app).get('/api/tasks?all=1').set('Cookie', u.cookie);
    expect(res.body.tasks.find((t: { id: string }) => t.id === id).todayNote).toBeNull();
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    expect(res.body.entries[0]).toMatchObject({ kind: 'completion', note: null });
  });
});

describe('history notes (PUT /api/history/:id/note)', () => {
  it('notes any entry by id — yesterday’s check-in, a recurring completion, a one-off', async () => {
    const u = await makeUser();
    const habitId = await makeHabit(u);
    // Yesterday's check-in seeded directly (the today-only endpoints can't reach it).
    const [yesterdayCheckin] = await db
      .insert(checkins)
      .values({ habitId, userId: u.id, localDate: '2026-01-05', createdAt: new Date('2026-01-05T10:00:00Z') })
      .returning();

    let res = await request(app)
      .put(`/api/history/${yesterdayCheckin!.id}/note`)
      .set('Cookie', u.cookie)
      .send({ note: 'forgot to log it' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ note: 'forgot to log it' });

    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    const entry = res.body.entries.find((e: { id: string }) => e.id === yesterdayCheckin!.id);
    expect(entry.note).toBe('forgot to log it');

    // Recurring completion entry id = completion row id.
    const created = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Water plants', intervalHours: 24 });
    await request(app).post(`/api/tasks/${created.body.id}/complete`).set('Cookie', u.cookie);
    res = await request(app).get('/api/history').set('Cookie', u.cookie);
    const completionEntry = res.body.entries.find(
      (e: { kind: string; name: string }) => e.kind === 'completion' && e.name === 'Water plants',
    );
    await request(app)
      .put(`/api/history/${completionEntry.id}/note`)
      .set('Cookie', u.cookie)
      .send({ note: 'big can' })
      .expect(200);

    // One-off entry id = task id; empty note clears.
    const oneOff = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'File taxes' });
    await request(app).post(`/api/tasks/${oneOff.body.id}/complete`).set('Cookie', u.cookie);
    await request(app)
      .put(`/api/history/${oneOff.body.id}/note`)
      .set('Cookie', u.cookie)
      .send({ note: 'at the bank' })
      .expect(200);
    res = await request(app)
      .put(`/api/history/${oneOff.body.id}/note`)
      .set('Cookie', u.cookie)
      .send({ note: '' });
    expect(res.body).toEqual({ note: null });
  });

  it('404s for foreign entries, unknown ids, and a never-completed one-off task id', async () => {
    const u = await makeUser();
    const habitId = await makeHabit(u);
    await request(app).post(`/api/habits/${habitId}/checkin`).set('Cookie', u.cookie);
    const res = await request(app).get('/api/history').set('Cookie', u.cookie);
    const entryId = res.body.entries[0].id;

    const stranger = await makeUser();
    await request(app)
      .put(`/api/history/${entryId}/note`)
      .set('Cookie', stranger.cookie)
      .send({ note: 'not mine' })
      .expect(404);

    await request(app)
      .put('/api/history/00000000-0000-0000-0000-000000000000/note')
      .set('Cookie', u.cookie)
      .send({ note: 'x' })
      .expect(404);

    // A one-off that was never completed has no history entry to note.
    const oneOff = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Not done yet' });
    await request(app)
      .put(`/api/history/${oneOff.body.id}/note`)
      .set('Cookie', u.cookie)
      .send({ note: 'x' })
      .expect(404);
  });
});
