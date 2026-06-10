import { afterAll } from 'vitest';
import { pool } from '../src/db/client.js';
import { cancelAllNudges } from '../src/push/scheduler.js';

afterAll(async () => {
  // Settings PUTs schedule real node-schedule jobs — cancel them so their
  // timers don't keep the vitest worker alive.
  cancelAllNudges();
  await pool.end();
});
