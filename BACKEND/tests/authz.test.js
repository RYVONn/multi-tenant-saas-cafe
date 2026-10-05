// Authorization: a customer token must NEVER reach staff/admin endpoints (audit F1/F2).
// These tests need no database: the middleware rejects before any query runs.
const request = require('supertest');
const app = require('../src/app');
const { customerToken } = require('./helpers');

const ID = '11111111-1111-1111-1111-111111111111';

const STAFF_ONLY = [
  ['get',    '/api/loyalty/cards'],
  ['get',    `/api/loyalty/cards/${ID}/history`],
  ['delete', `/api/loyalty/cards/${ID}`],
  ['patch',  `/api/loyalty/cards/${ID}/points`],
  ['post',   '/api/loyalty/cards/manual'],
  ['post',   '/api/products'],
  ['patch',  `/api/products/${ID}/sizes`],
  ['delete', `/api/products/${ID}`],
  ['post',   '/api/extras'],
  ['patch',  `/api/orders/${ID}/status`],
  ['patch',  `/api/orders/${ID}/verify-payment`],
  ['get',    '/api/inventory/shifts/active'],
  ['get',    '/api/inventory/requests'],
  ['get',    '/api/inventory/issuances'],
  ['get',    '/api/inventory/consumption'],
  ['get',    '/api/inventory/movements'],
  ['get',    '/api/inventory/notifications'],
  ['get',    '/api/inventory/inv-categories'],
  ['get',    '/api/inventory/waste'],
  ['post',   '/api/inventory/waste'],
  ['get',    '/api/inventory/suppliers'],
  ['get',    '/api/inventory/stock'],
  ['get',    '/api/inventory/analytics'],
  ['get',    '/api/chat/users'],
];

describe('customer token is rejected on staff endpoints', () => {
  for (const [method, url] of STAFF_ONLY) {
    it(`${method.toUpperCase()} ${url} -> 403`, async () => {
      const res = await request(app)[method](url).set('Authorization', `Bearer ${customerToken()}`);
      expect(res.status).toBe(403);
    });
  }
});

describe('anonymous requests are rejected', () => {
  for (const [method, url] of [['get', '/api/loyalty/cards'], ['patch', `/api/orders/${ID}/status`], ['get', '/api/inventory/stock']]) {
    it(`${method.toUpperCase()} ${url} -> 401`, async () => {
      const res = await request(app)[method](url);
      expect(res.status).toBe(401);
    });
  }
});

describe('internal n8n webhooks fail closed (audit F4)', () => {
  it('returns 503 when N8N_INTERNAL_SECRET is not configured', async () => {
    const res = await request(app).post('/api/loyalty/internal/points-update').send({ user_id: ID, points_awarded: 50000 });
    expect(res.status).toBe(503);
  });

  it('returns 401 on a wrong secret and never grants access', async () => {
    process.env.N8N_INTERNAL_SECRET = 'right-secret';
    try {
      const res = await request(app)
        .post('/api/loyalty/internal/points-update')
        .set('x-internal-secret', 'wrong')
        .send({ user_id: ID, points_awarded: 50000 });
      expect(res.status).toBe(401);
    } finally {
      process.env.N8N_INTERNAL_SECRET = '';
    }
  });

  it('protects /api/internal/* with the same fail-closed rule', async () => {
    const res = await request(app).get(`/api/internal/loyalty/balance/${ID}`);
    expect(res.status).toBe(503);
  });
});

describe('security hardening', () => {
  it('sends security headers and hides X-Powered-By (audit F9)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns 400 (not 500) for malformed JSON (audit F26)', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });
});
