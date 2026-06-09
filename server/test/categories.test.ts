import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, isNull, notExists, notInArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, categories, habits } from '../src/db/schema.js';
import { createApp } from '../src/app.js';

const USER_A = 'categoriestest-a';
const USER_B = 'categoriestest-b';
const PASSWORD = 'categories test password';

// Mirrors the production seed (src/db/seed.ts) — the test db is migrated but
// not seeded, so the suite installs the presets idempotently itself.
const PRESETS = [
  { name: 'Fitness', emoji: '💪', color: '#2e7d32' },
  { name: 'Mental Health', emoji: '🧠', color: '#5e35b1' },
  { name: 'Sleep', emoji: '😴', color: '#1565c0' },
] as const;
const PRESET_NAMES = PRESETS.map((p) => p.name);

const app = createApp();

let userAId: string;
let userBId: string;
let cookieA: string;
let cookieB: string;

async function login(name: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ name, password: PASSWORD });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as unknown as string];
  return cookies[0]!;
}

async function cleanup() {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.name, [USER_A, USER_B]));
  const ids = userRows.map((u) => u.id);
  if (ids.length > 0) {
    await db.delete(habits).where(inArray(habits.userId, ids));
    await db.delete(categories).where(inArray(categories.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
}

beforeAll(async () => {
  await cleanup(); // in case a previous run died mid-test

  // A crashed sibling-suite run can leave a stray builtin fixture behind
  // (e.g. 'HabitsTestBuiltin', userId null) which would break the
  // exactly-3-builtins assertions. Remove unreferenced non-preset builtins.
  await db
    .delete(categories)
    .where(
      and(
        isNull(categories.userId),
        notInArray(categories.name, PRESET_NAMES),
        notExists(db.select().from(habits).where(eq(habits.categoryId, categories.id))),
      ),
    );

  // Idempotent preset seed, same rule as src/db/seed.ts.
  for (const preset of PRESETS) {
    const existing = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(isNull(categories.userId), eq(categories.name, preset.name)));
    if (existing.length === 0) {
      await db.insert(categories).values({ ...preset, userId: null });
    }
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [a] = await db.insert(users).values({ name: USER_A, passwordHash }).returning();
  const [b] = await db.insert(users).values({ name: USER_B, passwordHash }).returning();
  userAId = a!.id;
  userBId = b!.id;
  cookieA = await login(USER_A);
  cookieB = await login(USER_B);
});

afterAll(cleanup);
// The 3 presets are left in place — they mirror the production baseline and
// other suites create their own uniquely-named fixtures.

function expectedPresets() {
  return PRESETS.map((p) => ({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    builtin: true,
  }));
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

describe('categories routes', () => {
  describe('authentication', () => {
    it.each([
      ['get', '/api/categories'],
      ['post', '/api/categories'],
    ] as const)('%s %s without cookie → 401 envelope', async (method, path) => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthenticated');
    });
  });

  describe('GET /api/categories', () => {
    it('returns exactly the 3 builtin presets (full contract) for a fresh user', async () => {
      const res = await request(app).get('/api/categories').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect([...res.body].sort(byName)).toEqual(expectedPresets());
    });
  });

  describe('POST /api/categories', () => {
    it('creates a user-owned custom category → 201 full contract, builtin:false', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Cookie', cookieA)
        .send({ name: 'Reading', emoji: '📚', color: '#ef6c00' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Reading',
        emoji: '📚',
        color: '#ef6c00',
        builtin: false,
      });
    });

    it('owner sees builtins + own custom in GET', async () => {
      const res = await request(app).get('/api/categories').set('Cookie', cookieA);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      expect([...res.body].sort(byName)).toEqual(
        [
          ...expectedPresets(),
          { id: expect.any(String), name: 'Reading', emoji: '📚', color: '#ef6c00', builtin: false },
        ].sort(byName),
      );
    });

    it("another user does not see A's custom but still sees the 3 builtins", async () => {
      const res = await request(app).get('/api/categories').set('Cookie', cookieB);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.every((c: { builtin: boolean }) => c.builtin)).toBe(true);
    });

    it("another user CAN reuse A's custom name (only builtins and own customs clash)", async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Cookie', cookieB)
        .send({ name: 'Reading', emoji: '📖', color: '#00897b' });
      expect(res.status).toBe(201);
      expect(res.body.builtin).toBe(false);
    });

    it("duplicate of a builtin, case-insensitive ('fitness' vs 'Fitness') → 409 duplicate", async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Cookie', cookieA)
        .send({ name: 'fitness', emoji: '🏋️', color: '#111111' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('duplicate');
    });

    it('duplicate of an own custom, case-insensitive → 409 duplicate', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Cookie', cookieA)
        .send({ name: 'READING', emoji: '📕', color: '#222222' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('duplicate');
    });

    it('trims the name before storing and comparing', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Cookie', cookieA)
        .send({ name: '  reading  ', emoji: '📗', color: '#333333' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('duplicate');
    });

    it.each([
      ['empty name', { name: '', emoji: '📚', color: '#ef6c00' }],
      ['whitespace-only name', { name: '   ', emoji: '📚', color: '#ef6c00' }],
      ['empty emoji', { name: 'Music', emoji: '', color: '#ef6c00' }],
      ['missing color', { name: 'Music', emoji: '🎵' }],
      ['bad color (no #)', { name: 'Music', emoji: '🎵', color: 'ef6c00' }],
      ['bad color (3-digit)', { name: 'Music', emoji: '🎵', color: '#fff' }],
      ['bad color (not hex)', { name: 'Music', emoji: '🎵', color: '#zzzzzz' }],
    ])('rejects %s → 400 validation', async (_label, body) => {
      const res = await request(app).post('/api/categories').set('Cookie', cookieA).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation');
    });
  });
});
