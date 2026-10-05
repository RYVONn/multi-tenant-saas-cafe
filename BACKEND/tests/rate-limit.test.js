// Brute-force / bot protection (audit F6).
const request = require('supertest');
const app = require('../src/app');

describe('rate limiting', () => {
  beforeAll(() => { process.env.DISABLE_RATE_LIMIT = '0'; });
  afterAll(() => { process.env.DISABLE_RATE_LIMIT = '1'; });

  it('throttles repeated sign-ups from one IP with 429', async () => {
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      // Invalid payload -> 400 before any DB access, but still counts toward the limit.
      const res = await request(app).post('/api/auth/register').send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses).toContain(429);
  });
});
