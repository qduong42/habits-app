import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://habits:habits@localhost:5433/habits';

const pool = new pg.Pool({ connectionString: DATABASE_URL });
pool.on('error', (err) => console.error('pg pool idle error', err));
export const db = drizzle(pool, { schema });
export { pool };
