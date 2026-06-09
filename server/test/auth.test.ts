import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

const TEST_NAME = 'authtest';
const TEST_PASSWORD = 'correct horse battery staple';

const app = createApp();

function cookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

describe('auth', () => {
  beforeAll(async () => {
    // clean slate in case a previous run died mid-test (only rows we own)
    await db.delete(users).where(eq(users.name, TEST_NAME));
    await db.insert(users).values({
      name: TEST_NAME,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
    });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.name, TEST_NAME));
  });

  describe('POST /api/auth/login', () => {
    it('rejects wrong password with 401 error envelope', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ name: TEST_NAME, password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBeTypeOf('string');
      expect(res.body.error.message).toBeTypeOf('string');
      expect(cookieHeader(res)).toEqual([]);
    });

    it('rejects unknown user with 401 error envelope', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ name: 'no-such-user-anywhere', password: 'whatever' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBeTypeOf('string');
    });

    it('rejects invalid body with 400 error envelope', async () => {
      const res = await request(app).post('/api/auth/login').send({ name: TEST_NAME });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBeTypeOf('string');
      expect(res.body.error.message).toBeTypeOf('string');
    });

    it('returns {id,name} and a session httpOnly cookie without Max-Age', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ name: TEST_NAME, password: TEST_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(TEST_NAME);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

      const cookies = cookieHeader(res);
      expect(cookies).toHaveLength(1);
      const cookie = cookies[0]!;
      expect(cookie).toMatch(/^token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).not.toMatch(/Max-Age/i); // session cookie when rememberMe absent
    });

    it('sets Max-Age when rememberMe is true', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ name: TEST_NAME, password: TEST_PASSWORD, rememberMe: true });

      expect(res.status).toBe(200);
      const cookie = cookieHeader(res)[0]!;
      expect(cookie).toMatch(/Max-Age=2592000/i); // 30 days
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 envelope without cookie', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBeTypeOf('string');
      expect(res.body.error.message).toBeTypeOf('string');
    });

    it('returns 401 envelope with a garbage token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'token=not-a-jwt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBeTypeOf('string');
    });

    it('returns {id,name} with a valid login cookie', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ name: TEST_NAME, password: TEST_PASSWORD });
      const cookie = cookieHeader(login)[0]!;

      const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.name).toBe(TEST_NAME);
      expect(res.body.id).toBe(login.body.id);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the token cookie', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ name: TEST_NAME, password: TEST_PASSWORD });
      const cookie = cookieHeader(login)[0]!;

      const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

      expect(res.status).toBe(200);
      const cleared = cookieHeader(res)[0]!;
      expect(cleared).toMatch(/^token=;/);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);

      // the cleared cookie no longer authenticates
      const me = await request(app).get('/api/auth/me').set('Cookie', 'token=');
      expect(me.status).toBe(401);
    });
  });

  describe('GET /api/healthz', () => {
    it('responds {ok:true}', async () => {
      const res = await request(app).get('/api/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});
