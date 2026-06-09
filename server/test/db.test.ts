import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users, categories, habits, checkins } from '../src/db/schema.js';

const TEST_NAME = 'db-smoke-test-user';
const ROUNDTRIP_NAME = 'db-roundtrip-test-user';

describe('db smoke test', () => {
  afterAll(async () => {
    await db.delete(users).where(eq(users.name, TEST_NAME));
  });

  it('inserts and selects a user roundtrip', async () => {
    // clean slate in case a previous run died mid-test
    await db.delete(users).where(eq(users.name, TEST_NAME));

    const [inserted] = await db
      .insert(users)
      .values({ name: TEST_NAME, passwordHash: 'not-a-real-hash' })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted!.id).toMatch(/^[0-9a-f-]{36}$/);

    const [found] = await db.select().from(users).where(eq(users.name, TEST_NAME));
    expect(found).toBeDefined();
    expect(found!.id).toBe(inserted!.id);
    expect(found!.passwordHash).toBe('not-a-real-hash');
    expect(found!.timezone).toBe('Europe/Berlin');
    expect(found!.xpTotal).toBe(0);
    expect(found!.createdAt).toBeInstanceOf(Date);
  });
});

describe('category → habit → checkin roundtrip', () => {
  afterAll(async () => {
    // checkins cascade-delete with habits; delete in FK order
    const owned = await db.select().from(users).where(eq(users.name, ROUNDTRIP_NAME));
    for (const user of owned) {
      await db.delete(habits).where(eq(habits.userId, user.id));
      await db.delete(categories).where(eq(categories.userId, user.id));
    }
    await db.delete(users).where(eq(users.name, ROUNDTRIP_NAME));
  });

  it('inserts category → habit → checkin and enforces uniq_checkin_per_day', async () => {
    // clean slate in case a previous run died mid-test
    const stale = await db.select().from(users).where(eq(users.name, ROUNDTRIP_NAME));
    for (const user of stale) {
      await db.delete(habits).where(eq(habits.userId, user.id));
      await db.delete(categories).where(eq(categories.userId, user.id));
    }
    await db.delete(users).where(eq(users.name, ROUNDTRIP_NAME));

    const [user] = await db
      .insert(users)
      .values({ name: ROUNDTRIP_NAME, passwordHash: 'not-a-real-hash' })
      .returning();

    const [category] = await db
      .insert(categories)
      .values({ userId: user!.id, name: 'Test Category', emoji: '🧪', color: '#123456' })
      .returning();
    expect(category).toBeDefined();
    expect(category!.userId).toBe(user!.id);

    const [habit] = await db
      .insert(habits)
      .values({
        userId: user!.id,
        categoryId: category!.id,
        name: 'Test Habit',
        frequencyType: 'daily',
      })
      .returning();
    expect(habit).toBeDefined();
    expect(habit!.frequencyType).toBe('daily');
    expect(habit!.archivedAt).toBeNull();

    const [checkin] = await db
      .insert(checkins)
      .values({ habitId: habit!.id, userId: user!.id, localDate: '2026-06-09' })
      .returning();
    expect(checkin).toBeDefined();
    expect(checkin!.localDate).toBe('2026-06-09');

    // duplicate (habit_id, local_date) must violate uniq_checkin_per_day
    // (drizzle wraps the pg error, so code 23505 lives on error.cause)
    await expect(
      db
        .insert(checkins)
        .values({ habitId: habit!.id, userId: user!.id, localDate: '2026-06-09' }),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'uniq_checkin_per_day' },
    });

    // a different date is still allowed
    const [second] = await db
      .insert(checkins)
      .values({ habitId: habit!.id, userId: user!.id, localDate: '2026-06-10' })
      .returning();
    expect(second).toBeDefined();
  });
});
