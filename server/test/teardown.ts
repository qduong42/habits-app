import { afterAll } from 'vitest';
import { pool } from '../src/db/client.js';

afterAll(async () => {
  await pool.end();
});
