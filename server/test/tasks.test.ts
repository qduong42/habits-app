import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import {
  users,
  tasks,
  taskCompletions,
  achievements,
  userAchievements,
} from '../src/db/schema.js';
import { ACHIEVEMENT_CATALOG } from '../src/game/achievements.js';
import { addDays, localDateFor } from '../src/game/dates.js';
import { createApp } from '../src/app.js';

// Task 25: one-off and recurring tasks with reset-on-completion (ADR-0001).
// Fresh user per test (taskstest-N) so XP totals are deterministic.

const USER_PREFIX = 'taskstest-';
const PASSWORD = 'tasks test password';
const HOUR_MS = 3_600_000;

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
}

async function makeUser(): Promise<TestUser> {
  const n = ++userCounter;
  const [user] = await db
    .insert(users)
    .values({ name: `${USER_PREFIX}${n}`, passwordHash })
    .returning();
  return { id: user!.id, cookie: await login(`${USER_PREFIX}${n}`) };
}

async function createTask(cookie: string, body: Record<string, unknown>) {
  const res = await request(app).post('/api/tasks').set('Cookie', cookie).send(body);
  expect(res.status).toBe(201);
  return res.body as { id: string; nextDue: string | null };
}

function complete(cookie: string, taskId: string) {
  return request(app).post(`/api/tasks/${taskId}/complete`).set('Cookie', cookie);
}

function undo(cookie: string, taskId: string) {
  return request(app).delete(`/api/tasks/${taskId}/complete`).set('Cookie', cookie);
}

async function listTasks(cookie: string) {
  const res = await request(app).get('/api/tasks').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.tasks as Array<{
    id: string;
    name: string;
    kind: string;
    group: string;
    dueLabel: string | null;
  }>;
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
    await db.delete(taskCompletions).where(inArray(taskCompletions.userId, ids));
    await db.delete(tasks).where(inArray(tasks.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup();
  passwordHash = await bcrypt.hash(PASSWORD, 10);
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

// Seeded users default to Europe/Berlin — "today" in their timezone.
const todayLocal = () => localDateFor('Europe/Berlin');

describe('POST /api/tasks', () => {
  it('creates an undated one-off matching the TaskItem contract', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Buy stamps', notes: 'for the tax letter' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      name: 'Buy stamps',
      notes: 'for the tax letter',
      sourceUrl: null,
      kind: 'oneoff',
      group: 'undated',
      dueLabel: null,
      dueDate: null,
      intervalHours: null,
      nextDue: null,
    });
  });

  it('creates a dated one-off (due today)', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Call doctor', dueDate: todayLocal() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'oneoff',
      group: 'today',
      dueLabel: 'due today',
      dueDate: todayLocal(),
    });
  });

  it('creates a recurring task with nextDue ≈ now + interval', async () => {
    const u = await makeUser();
    const before = Date.now();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Water plants', intervalHours: 120 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'recurring',
      intervalHours: 120,
      dueDate: null,
      group: 'scheduled', // not due yet — default GET excludes it (asserted below)
    });
    const nextDue = Date.parse(res.body.nextDue);
    expect(nextDue).toBeGreaterThanOrEqual(before + 120 * HOUR_MS - 5000);
    expect(nextDue).toBeLessThanOrEqual(Date.now() + 120 * HOUR_MS + 5000);
  });

  it('rejects dueDate together with intervalHours', async () => {
    const u = await makeUser();
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Confused', dueDate: todayLocal(), intervalHours: 24 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('rejects intervalHours < 1 and empty names', async () => {
    const u = await makeUser();
    const sub1 = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: 'Too fast', intervalHours: 0.5 });
    expect(sub1.status).toBe(400);
    const noName = await request(app)
      .post('/api/tasks')
      .set('Cookie', u.cookie)
      .send({ name: '   ' });
    expect(noName.status).toBe(400);
  });
});

describe('GET /api/tasks', () => {
  it('orders overdue → today → undated → done and excludes hidden', async () => {
    const u = await makeUser();
    const overdue = await createTask(u.cookie, {
      name: 'Overdue',
      dueDate: addDays(todayLocal(), -2),
    });
    const dueToday = await createTask(u.cookie, { name: 'Due today', dueDate: todayLocal() });
    const undated = await createTask(u.cookie, { name: 'Undated' });
    const doneToday = await createTask(u.cookie, { name: 'Done today' });
    await complete(u.cookie, doneToday.id);
    const future = await createTask(u.cookie, {
      name: 'Future',
      dueDate: addDays(todayLocal(), 3),
    });
    const recurringNotDue = await createTask(u.cookie, {
      name: 'Recurring later',
      intervalHours: 120,
    });
    // a recurring task whose nextDue slipped to yesterday → overdue
    const recurringOverdue = await createTask(u.cookie, {
      name: 'Recurring overdue',
      intervalHours: 12,
    });
    await db
      .update(tasks)
      .set({ nextDue: new Date(Date.now() - 26 * HOUR_MS) })
      .where(eq(tasks.id, recurringOverdue.id));

    const list = await listTasks(u.cookie);
    expect(list.map((t) => t.name)).toEqual([
      'Overdue',
      'Recurring overdue',
      'Due today',
      'Undated',
      'Done today',
    ]);
    expect(list.map((t) => t.group)).toEqual(['overdue', 'overdue', 'today', 'undated', 'done']);
    const ids = list.map((t) => t.id);
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(recurringNotDue.id);
    expect(ids).toContain(overdue.id);
    expect(ids).toContain(dueToday.id);
    expect(ids).toContain(undated.id);
    expect(list.find((t) => t.id === overdue.id)!.dueLabel).toBe('overdue 2d');
    expect(list.find((t) => t.id === recurringOverdue.id)!.dueLabel).toBe('overdue 1d');
  });
});

describe('GET /api/tasks?all=1 (Task 26: scheduled tasks reachable)', () => {
  // 'due Jun 13'-style label for a plain local date.
  const monthDay = (isoDate: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
      new Date(`${isoDate}T00:00:00Z`),
    );

  it("appends not-yet-due tasks as group 'scheduled'; terminal one-offs stay excluded", async () => {
    const u = await makeUser();
    const open = await createTask(u.cookie, { name: 'Open now' });
    const futureDate = addDays(todayLocal(), 3);
    const future = await createTask(u.cookie, { name: 'Future', dueDate: futureDate });
    const recurringNotDue = await createTask(u.cookie, {
      name: 'Recurring later',
      intervalHours: 120,
    });
    // terminal: one-off completed on a past day → history, even with ?all=1
    const oldDone = await createTask(u.cookie, { name: 'Old done' });
    await complete(u.cookie, oldDone.id);
    await db
      .update(tasks)
      .set({ completedAt: new Date(Date.now() - 48 * HOUR_MS) })
      .where(eq(tasks.id, oldDone.id));

    // default GET still hides everything scheduled
    expect((await listTasks(u.cookie)).map((t) => t.id)).toEqual([open.id]);

    const res = await request(app).get('/api/tasks?all=1').set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    const all = res.body.tasks as Array<{
      id: string;
      name: string;
      group: string;
      dueLabel: string | null;
    }>;
    // scheduled sorts last, soonest-due first (+3d one-off before +120h recurring)
    expect(all.map((t) => t.name)).toEqual(['Open now', 'Future', 'Recurring later']);
    expect(all.find((t) => t.id === future.id)).toMatchObject({
      group: 'scheduled',
      dueLabel: `due ${monthDay(futureDate)}`,
    });
    const recurring = all.find((t) => t.id === recurringNotDue.id)!;
    expect(recurring.group).toBe('scheduled');
    expect(recurring.dueLabel).toMatch(/^due /);
    expect(all.map((t) => t.id)).not.toContain(oldDone.id);
  });
});

describe('POST /api/tasks/:id/complete', () => {
  it('one-off: +5 XP, moves to done, second complete → 409', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Once' });

    const res = await complete(u.cookie, t.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      xpGained: 5,
      xpTotal: 5,
      level: 1,
      leveledUp: false,
      nextDue: null,
      unlockedAchievements: [],
    });
    expect(await xpOf(u.id)).toBe(5);

    const list = await listTasks(u.cookie);
    expect(list.find((x) => x.id === t.id)).toMatchObject({ group: 'done', dueLabel: null });

    const again = await complete(u.cookie, t.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_done');
    expect(await xpOf(u.id)).toBe(5);
  });

  it('recurring: resets nextDue ≈ now + interval and records a completion', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Water plants', intervalHours: 120 });

    const before = Date.now();
    const res = await complete(u.cookie, t.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ xpGained: 5, xpTotal: 5 });
    const nextDue = Date.parse(res.body.nextDue);
    expect(nextDue).toBeGreaterThanOrEqual(before + 120 * HOUR_MS - 5000);
    expect(nextDue).toBeLessThanOrEqual(Date.now() + 120 * HOUR_MS + 5000);

    const rows = await db.select().from(taskCompletions).where(eq(taskCompletions.taskId, t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.localDate).toBe(todayLocal());
  });

  it('sub-daily: a 12h task completes twice in one day for 10 XP total', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Stretch', intervalHours: 12 });

    const r1 = await complete(u.cookie, t.id);
    expect(r1.body).toMatchObject({ xpGained: 5, xpTotal: 5 });
    const r2 = await complete(u.cookie, t.id);
    expect(r2.body).toMatchObject({ xpGained: 5, xpTotal: 10 });
    expect(await xpOf(u.id)).toBe(10);

    const rows = await db.select().from(taskCompletions).where(eq(taskCompletions.taskId, t.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.localDate)).toEqual([todayLocal(), todayLocal()]);
  });

  it('task XP crosses level thresholds (leveledUp + achievement path)', async () => {
    const u = await makeUser();
    await db.update(users).set({ xpTotal: 995 }).where(eq(users.id, u.id));
    const t = await createTask(u.cookie, { name: 'Leveler' });

    const res = await complete(u.cookie, t.id);
    expect(res.body).toMatchObject({ xpGained: 5, xpTotal: 1000, level: 2, leveledUp: true });
  });

  it('reaching level 5 via a task completion unlocks the level-5 achievement', async () => {
    const u = await makeUser();
    await db.update(users).set({ xpTotal: 3995 }).where(eq(users.id, u.id));
    const t = await createTask(u.cookie, { name: 'Big leveler' });

    const res = await complete(u.cookie, t.id);
    expect(res.body).toMatchObject({ xpTotal: 4000, level: 5, leveledUp: true });
    expect(res.body.unlockedAchievements).toEqual([
      {
        id: 'level-5',
        name: 'Bronze League',
        description: 'Reach level 5.',
        emoji: '🥉',
        unlockedAt: expect.any(String),
      },
    ]);
  });

  it("another user's task → 404; bogus uuid → 404", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const t = await createTask(owner.cookie, { name: 'Private' });

    const foreign = await complete(intruder.cookie, t.id);
    expect(foreign.status).toBe(404);
    const bogus = await complete(owner.cookie, 'not-a-uuid');
    expect(bogus.status).toBe(404);
    const missing = await complete(owner.cookie, '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(await xpOf(owner.id)).toBe(0);
  });
});

describe('DELETE /api/tasks/:id/complete (same-day undo)', () => {
  it('one-off: undo restores the open task and takes the XP back', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Oops' });
    await complete(u.cookie, t.id);
    expect(await xpOf(u.id)).toBe(5);

    const res = await undo(u.cookie, t.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, xpLost: 5, xpTotal: 0, level: 1 });
    expect(await xpOf(u.id)).toBe(0);

    const list = await listTasks(u.cookie);
    expect(list.find((x) => x.id === t.id)).toMatchObject({ group: 'undated' });
    // and it can be completed again
    const again = await complete(u.cookie, t.id);
    expect(again.status).toBe(200);
  });

  it('one-off with no completion today → 404, XP untouched', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Never done' });
    const res = await undo(u.cookie, t.id);
    expect(res.status).toBe(404);
    expect(await xpOf(u.id)).toBe(0);
  });

  it('recurring: undo deletes the latest completion and recomputes nextDue', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Stretch', intervalHours: 12 });
    const r1 = await complete(u.cookie, t.id);
    const firstCompletionAt = Date.now();
    await complete(u.cookie, t.id);
    expect(await xpOf(u.id)).toBe(10);

    // undo the second completion → nextDue recomputed from the FIRST one
    const res = await undo(u.cookie, t.id);
    expect(res.body).toMatchObject({ ok: true, xpLost: 5, xpTotal: 5 });
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    const expected1 = firstCompletionAt + 12 * HOUR_MS;
    expect(Math.abs(row!.nextDue!.getTime() - expected1)).toBeLessThan(10_000);
    expect(r1.body.nextDue).toBeTruthy();

    // undo the first completion too → nextDue falls back to createdAt + interval
    const res2 = await undo(u.cookie, t.id);
    expect(res2.body).toMatchObject({ ok: true, xpLost: 5, xpTotal: 0 });
    const [row2] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row2!.nextDue!.getTime()).toBe(row2!.createdAt.getTime() + 12 * HOUR_MS);
    const completions = await db
      .select()
      .from(taskCompletions)
      .where(eq(taskCompletions.taskId, t.id));
    expect(completions).toHaveLength(0);

    // nothing left to undo
    const res3 = await undo(u.cookie, t.id);
    expect(res3.status).toBe(404);
  });

  it("another user's task → 404", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const t = await createTask(owner.cookie, { name: 'Private' });
    await complete(owner.cookie, t.id);
    const res = await undo(intruder.cookie, t.id);
    expect(res.status).toBe(404);
    expect(await xpOf(owner.id)).toBe(5);
  });
});

describe('PATCH /api/tasks/:id and DELETE /api/tasks/:id', () => {
  it('renames and edits notes', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Old name' });
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', u.cookie)
      .send({ name: 'New name', notes: 'now with notes' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'New name', notes: 'now with notes' });
  });

  it('switches one-off → recurring (nextDue = now + interval, dueDate cleared)', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Was once', dueDate: todayLocal() });
    const before = Date.now();
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', u.cookie)
      .send({ intervalHours: 24, dueDate: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'recurring', intervalHours: 24, dueDate: null });
    const nextDue = Date.parse(res.body.nextDue);
    expect(nextDue).toBeGreaterThanOrEqual(before + 24 * HOUR_MS - 5000);
    expect(nextDue).toBeLessThanOrEqual(Date.now() + 24 * HOUR_MS + 5000);
  });

  it('switches recurring → one-off (interval and nextDue cleared)', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Was recurring', intervalHours: 48 });
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', u.cookie)
      .send({ intervalHours: null, dueDate: todayLocal() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'oneoff',
      intervalHours: null,
      nextDue: null,
      dueDate: todayLocal(),
      group: 'today',
    });
  });

  it('rejects a merged state with both dueDate and intervalHours', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Dated', dueDate: todayLocal() });
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', u.cookie)
      .send({ intervalHours: 24 }); // dueDate still set on the task
    expect(res.status).toBe(400);
  });

  it('completed one-offs are terminal: PATCH → 404', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Finished' });
    await complete(u.cookie, t.id);
    const res = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', u.cookie)
      .send({ name: 'Zombie' });
    expect(res.status).toBe(404);
  });

  it('DELETE hard-deletes the task and cascades its completions', async () => {
    const u = await makeUser();
    const t = await createTask(u.cookie, { name: 'Goner', intervalHours: 12 });
    await complete(u.cookie, t.id);

    const res = await request(app).delete(`/api/tasks/${t.id}`).set('Cookie', u.cookie);
    expect(res.status).toBe(200);
    expect(await db.select().from(tasks).where(eq(tasks.id, t.id))).toHaveLength(0);
    expect(
      await db.select().from(taskCompletions).where(eq(taskCompletions.taskId, t.id)),
    ).toHaveLength(0);
  });

  it("foreign PATCH/DELETE → 404", async () => {
    const owner = await makeUser();
    const intruder = await makeUser();
    const t = await createTask(owner.cookie, { name: 'Private' });
    const patched = await request(app)
      .patch(`/api/tasks/${t.id}`)
      .set('Cookie', intruder.cookie)
      .send({ name: 'Stolen' });
    expect(patched.status).toBe(404);
    const deleted = await request(app).delete(`/api/tasks/${t.id}`).set('Cookie', intruder.cookie);
    expect(deleted.status).toBe(404);
  });
});

describe('auth', () => {
  it('all task routes require a session', async () => {
    expect((await request(app).get('/api/tasks')).status).toBe(401);
    expect((await request(app).post('/api/tasks').send({ name: 'x' })).status).toBe(401);
  });
});
