import bcrypt from 'bcryptjs';
import { db, pool } from './client.js';
import { users } from './schema.js';

const password = process.env.SEED_PASSWORD ?? 'changeme123';
const passwordHash = await bcrypt.hash(password, 10);

for (const name of ['huy', 'lea']) {
  await db
    .insert(users)
    .values({ name, passwordHash })
    .onConflictDoNothing({ target: users.name });
}

console.log('seeded users: huy, lea');
await pool.end();
