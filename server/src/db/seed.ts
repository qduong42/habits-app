import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { achievements, categories, users } from './schema.js';
import { ACHIEVEMENT_CATALOG } from '../game/achievements.js';

const password = process.env.SEED_PASSWORD ?? 'changeme123';
const passwordHash = await bcrypt.hash(password, 10);

for (const name of ['huy', 'lea', 'sasi']) {
  await db
    .insert(users)
    .values({ name, passwordHash })
    .onConflictDoNothing({ target: users.name });
}

console.log('seeded users: huy, lea, sasi');

// Builtin preset categories (userId null). The categories table has no unique
// constraint on name, so idempotency is explicit: only insert each builtin if
// no row with userId IS NULL and that name exists yet.
const builtinCategories = [
  { name: 'Fitness', emoji: '💪', color: '#2e7d32' },
  { name: 'Mental Health', emoji: '🧠', color: '#5e35b1' },
  { name: 'Sleep', emoji: '😴', color: '#1565c0' },
];

for (const preset of builtinCategories) {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(isNull(categories.userId), eq(categories.name, preset.name)));
  if (existing.length === 0) {
    await db.insert(categories).values({ ...preset, userId: null });
  }
}

console.log('seeded builtin categories: Fitness, Mental Health, Sleep');

// Achievement catalog (text PK = slug). Upsert name/description/emoji so
// catalog copy edits propagate to existing DBs on re-seed.
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
  .onConflictDoUpdate({
    target: achievements.id,
    set: {
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      emoji: sql`excluded.emoji`,
    },
  });

console.log(`seeded achievements catalog: ${ACHIEVEMENT_CATALOG.length}`);
await pool.end();
