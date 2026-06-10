import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';

const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

function appWithStatic() {
  process.env.SERVE_STATIC = '1';
  try {
    return createApp();
  } finally {
    delete process.env.SERVE_STATIC;
  }
}

describe('static serving', () => {
  it('keeps the JSON /api 404 catch-all when the static fallback is enabled', async () => {
    const res = await request(appWithStatic()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('serves index.html for non-/api GETs when web/dist exists', async (ctx) => {
    if (!existsSync(WEB_DIST)) return ctx.skip(); // web not built in this environment
    const res = await request(appWithStatic()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('does not serve static files in test runs by default', async () => {
    const res = await request(createApp()).get('/');
    expect(res.status).toBe(404);
  });
});
