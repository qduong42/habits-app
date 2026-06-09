import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';

const TEST_NAME = 'db-smoke-test-user';

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
