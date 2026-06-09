import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // Suites share one Postgres database and some assert on global state
    // (categories.test.ts: "exactly 3 builtin categories" while habits/
    // checkins suites temporarily insert their own userId-null fixtures).
    // Run test files sequentially so those assertions are deterministic.
    fileParallelism: false,
    globalSetup: ['./test/setup.ts'],
    setupFiles: ['./test/teardown.ts'],
    env: {
      DATABASE_URL: 'postgres://habits:habits@localhost:5433/habits_test',
      JWT_SECRET: 'test-secret',
    },
  },
});
