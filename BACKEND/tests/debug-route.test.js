// /api/debug dumps raw DB rows: it must be unreachable in production (MOA-33).
const path = require('path');
const request = require('supertest');

const srcDir = path.join(__dirname, '..', 'src');

const loadApp = (env) => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  // app.js is CJS and mounts routes at require time, so drop it from the cache.
  for (const k of Object.keys(require.cache)) if (k.startsWith(srcDir)) delete require.cache[k];
  const app = require('../src/app');
  process.env.NODE_ENV = prev;
  return app;
};

describe('/api/debug gating', () => {
  it('returns 404 when NODE_ENV=production', async () => {
    const res = await request(loadApp('production')).get('/api/debug/stock');
    expect(res.status).toBe(404);
  });

  it('is still mounted outside production (auth required)', async () => {
    const res = await request(loadApp('development')).get('/api/debug/stock');
    expect(res.status).toBe(401);
  });
});
