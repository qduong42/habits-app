import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://habits:habits@localhost:5433/habits';

// Heroku Postgres requires TLS but presents a self-signed chain — opt in via
// DATABASE_SSL=no-verify there. Explicit env (not host sniffing): the Docker
// deploy talks plaintext to a non-localhost host ("postgres") and must NOT
// get SSL turned on by accident.
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'no-verify' ? { rejectUnauthorized: false } : undefined,
});
pool.on('error', (err) => console.error('pg pool idle error', err));
export const db = drizzle(pool, { schema });
export { pool };
