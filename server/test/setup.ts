import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const ADMIN_URL = 'postgres://habits:habits@localhost:5433/postgres';
const TEST_URL = 'postgres://habits:habits@localhost:5433/habits_test';

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query('CREATE DATABASE habits_test');
  } catch (err) {
    // 42P04 = duplicate_database
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: TEST_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
