import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    globalSetup: ['./test/setup.ts'],
    env: {
      DATABASE_URL: 'postgres://habits:habits@localhost:5433/habits_test',
      JWT_SECRET: 'test-secret',
    },
  },
});
