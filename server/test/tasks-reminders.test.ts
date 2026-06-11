import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, tasks, taskCompletions } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

// Task Reminders (v1.2 spec §2): one-off tasks carry nullable remindAt /
// remindedAt; recurring tasks reject remindAt; editing remindAt clears the
// refire guard.

const USER_PREFIX = 'reminderstest-';
const PASSWORD = 'reminders test password';
const REMIND_AT = '2099-06-12T09:00:00.000Z';

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

function createTask(cookie: string, body: Record<string, unknown>) {
  return request(app).post('/api/tasks').set('Cookie', cookie).send(body);
}

function patchTask(cookie: string, taskId: string, body: Record<string, unknown>) {
  return request(app).patch(`/api/tasks/${taskId}`).set('Cookie', cookie).send(body);
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
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup();
  passwordHash = await bcrypt.hash(PASSWORD, 10);
});

afterAll(cleanup);

describe('reminders on create', () => {
  it('one-off task accepts remindAt and returns remindAt + remindedAt:null', async () => {
    const u = await makeUser();
    const res = await createTask(u.cookie, { name: 'Call dentist', remindAt: REMIND_AT });
    expect(res.status).toBe(201);
    expect(res.body.remindAt).toBe(REMIND_AT);
    expect(res.body.remindedAt).toBeNull();
  });

  it('one-off task without remindAt returns both fields as null', async () => {
    const u = await makeUser();
    const res = await createTask(u.cookie, { name: 'No reminder' });
    expect(res.status).toBe(201);
    expect(res.body.remindAt).toBeNull();
    expect(res.body.remindedAt).toBeNull();
  });

  it('recurring create with remindAt → 400 remind_one_off_only', async () => {
    const u = await makeUser();
    const res = await createTask(u.cookie, {
      name: 'Water plants',
      intervalHours: 48,
      remindAt: REMIND_AT,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('remind_one_off_only');
  });

  it('rejects a malformed remindAt', async () => {
    const u = await makeUser();
    const res = await createTask(u.cookie, { name: 'Bad date', remindAt: 'tomorrowish' });
    expect(res.status).toBe(400);
  });
});

describe('reminders on update', () => {
  it('setting remindAt on a one-off returns it; remindAt:null clears it', async () => {
    const u = await makeUser();
    const created = await createTask(u.cookie, { name: 'Renew passport' });
    expect(created.status).toBe(201);

    const set = await patchTask(u.cookie, created.body.id, { remindAt: REMIND_AT });
    expect(set.status).toBe(200);
    expect(set.body.remindAt).toBe(REMIND_AT);
    expect(set.body.remindedAt).toBeNull();

    const cleared = await patchTask(u.cookie, created.body.id, { remindAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.remindAt).toBeNull();
    expect(cleared.body.remindedAt).toBeNull();
  });

  it('changing remindAt clears a set remindedAt (refire guard reset)', async () => {
    const u = await makeUser();
    const created = await createTask(u.cookie, { name: 'Already reminded', remindAt: REMIND_AT });
    expect(created.status).toBe(201);
    // Simulate the scheduler having fired: stamp reminded_at directly.
    await db
      .update(tasks)
      .set({ remindedAt: new Date() })
      .where(eq(tasks.id, created.body.id as string));

    const res = await patchTask(u.cookie, created.body.id, {
      remindAt: '2099-07-01T10:00:00.000Z',
    });
    expect(res.status).toBe(200);
    expect(res.body.remindAt).toBe('2099-07-01T10:00:00.000Z');
    expect(res.body.remindedAt).toBeNull();

    const [row] = await db.select().from(tasks).where(eq(tasks.id, created.body.id as string));
    expect(row!.remindedAt).toBeNull();
  });

  it('an untouched remindAt keeps remindedAt intact', async () => {
    const u = await makeUser();
    const created = await createTask(u.cookie, { name: 'Stamped stays', remindAt: REMIND_AT });
    expect(created.status).toBe(201);
    const stamped = new Date('2099-06-12T09:00:30.000Z');
    await db
      .update(tasks)
      .set({ remindedAt: stamped })
      .where(eq(tasks.id, created.body.id as string));

    const res = await patchTask(u.cookie, created.body.id, { name: 'Renamed, not re-armed' });
    expect(res.status).toBe(200);
    expect(res.body.remindedAt).toBe(stamped.toISOString());
  });

  it('remindAt on a recurring task → 400 remind_one_off_only', async () => {
    const u = await makeUser();
    const created = await createTask(u.cookie, { name: 'Stretch', intervalHours: 24 });
    expect(created.status).toBe(201);

    const res = await patchTask(u.cookie, created.body.id, { remindAt: REMIND_AT });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('remind_one_off_only');
  });

  it('switching a reminded one-off to recurring without clearing remindAt → 400', async () => {
    const u = await makeUser();
    const created = await createTask(u.cookie, { name: 'Becomes chore', remindAt: REMIND_AT });
    expect(created.status).toBe(201);

    const res = await patchTask(u.cookie, created.body.id, { intervalHours: 24 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('remind_one_off_only');

    const ok = await patchTask(u.cookie, created.body.id, { intervalHours: 24, remindAt: null });
    expect(ok.status).toBe(200);
    expect(ok.body.remindAt).toBeNull();
  });
});
