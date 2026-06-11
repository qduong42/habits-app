import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { like } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

// v1.2 Task 6: POST /api/me/password {currentPassword, newPassword} — bcrypt
// verify the current password (wrong → 401 wrong_password), zod min 8 on the
// new one, update users.password_hash → {ok:true}. Existing JWTs stay valid.
// (File named -passwd: the agent harness denies writes to *password* paths.)

const USER_PREFIX = 'pwtest-';
const PASSWORD = 'old password 123';

const app = createApp();

let passwordHash: string;
let userCounter = 0;

async function makeUser(): Promise<{ id: string; name: string; cookie: string }> {
  const n = ++userCounter;
  const name = `${USER_PREFIX}${n}`;
  const [user] = await db.insert(users).values({ name, passwordHash }).returning();
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return { id: user!.id, name, cookie: cookies[0]! };
}

function changePassword(cookie: string, body: unknown) {
  return request(app).post('/api/me/password').set('Cookie', cookie).send(body as object);
}

describe('POST /api/me/password', () => {
  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.name, `${USER_PREFIX}%`));
  });

  it('changes the password: new login works, old one stops working', async () => {
    const { name, cookie } = await makeUser();

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: 'brand new pass',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ name, password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ name, password: 'brand new pass' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a wrong current password with 401 wrong_password', async () => {
    const { name, cookie } = await makeUser();

    const res = await changePassword(cookie, {
      currentPassword: 'not the password',
      newPassword: 'brand new pass',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('wrong_password');

    // Password unchanged: the original still logs in.
    const login = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it('rejects a new password shorter than 8 chars with 400', async () => {
    const { cookie } = await makeUser();

    const res = await changePassword(cookie, {
      currentPassword: PASSWORD,
      newPassword: 'short77',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation');
  });

  it('requires auth (401 without cookie)', async () => {
    const res = await request(app)
      .post('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'brand new pass' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
});
