import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

// Task 19: PUT /api/me/settings — nudge time (HH:MM or null) and timezone
// (validated against Intl.supportedValuesOf('timeZone')). Partial updates:
// either field may be omitted, but the body must contain at least one.
// users.nudge_time is a pg `time` column (Postgres returns 'HH:MM:SS') — the
// API normalizes to 'HH:MM' everywhere, including GET /auth/me.

const USER_PREFIX = 'settingstest-';
const PASSWORD = 'settings test password';

const app = createApp();

let passwordHash: string;
let userCounter = 0;

async function makeUser(): Promise<{ id: string; cookie: string }> {
  const n = ++userCounter;
  const name = `${USER_PREFIX}${n}`;
  const [user] = await db.insert(users).values({ name, passwordHash }).returning();
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return { id: user!.id, cookie: cookies[0]! };
}

function putSettings(cookie: string, body: unknown) {
  return request(app).put('/api/me/settings').set('Cookie', cookie).send(body as object);
}

describe('PUT /api/me/settings', () => {
  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
  });

  it('sets the nudge time and echoes normalized HH:MM', async () => {
    const { cookie } = await makeUser();

    const res = await putSettings(cookie, { nudgeTime: '21:30' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, nudgeTime: '21:30', timezone: 'Europe/Berlin' });
  });

  it('clears the nudge time with null', async () => {
    const { cookie } = await makeUser();
    await putSettings(cookie, { nudgeTime: '07:15' });

    const res = await putSettings(cookie, { nudgeTime: null });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, nudgeTime: null, timezone: 'Europe/Berlin' });
  });

  it('sets the timezone without touching the nudge time', async () => {
    const { cookie } = await makeUser();
    await putSettings(cookie, { nudgeTime: '08:00' });

    const res = await putSettings(cookie, { timezone: 'America/New_York' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, nudgeTime: '08:00', timezone: 'America/New_York' });
  });

  it('rejects a bad time format with 400', async () => {
    const { cookie } = await makeUser();

    for (const bad of ['25:00', '9:30', '21:60', '2130', 'evening']) {
      const res = await putSettings(cookie, { nudgeTime: bad });
      expect(res.status, `nudgeTime=${bad}`).toBe(400);
      expect(res.body.error.code).toBe('validation');
    }
  });

  it('rejects a bogus timezone with 400', async () => {
    const { cookie } = await makeUser();

    const res = await putSettings(cookie, { timezone: 'Mars/Olympus_Mons' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('rejects an empty body with 400', async () => {
    const { cookie } = await makeUser();

    const res = await putSettings(cookie, {});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('requires auth (401 without cookie)', async () => {
    const res = await request(app).put('/api/me/settings').send({ nudgeTime: '21:30' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });

  it('GET /auth/me reflects saved settings (nudgeTime normalized to HH:MM)', async () => {
    const { id, cookie } = await makeUser();
    await putSettings(cookie, { nudgeTime: '21:30', timezone: 'Asia/Tokyo' });

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id,
      name: `${USER_PREFIX}${userCounter}`,
      timezone: 'Asia/Tokyo',
      nudgeTime: '21:30',
    });
  });
});
