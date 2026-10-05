// Sign-up validation (audit S3-S5, F21). Every case is rejected before the DB is touched.
const request = require('supertest');
const app = require('../src/app');

const valid = {
  full_name: 'Sara Ali',
  email: 'sara@example.com',
  password: 'correct-horse',
  phone: '01012345678',
  birthday: '1995-05-20',
};
const register = (overrides) => request(app).post('/api/auth/register').send({ ...valid, ...overrides });

describe('POST /api/auth/register validation', () => {
  it('rejects a one-character password', async () => expect((await register({ password: 'x' })).status).toBe(400));
  it('rejects an invalid email', async () => expect((await register({ email: 'not-an-email' })).status).toBe(400));
  it('rejects a future birthday', async () => expect((await register({ birthday: '2999-01-01' })).status).toBe(400));
  it('rejects an impossible date (1995-02-30)', async () => expect((await register({ birthday: '1995-02-30' })).status).toBe(400));
  it('rejects a whitespace-only password', async () => expect((await register({ password: '        ' })).status).toBe(400));
  it('rejects non-string fields', async () => expect((await register({ full_name: { $ne: 1 } })).status).toBe(400));
  it('rejects over-long names', async () => expect((await register({ full_name: 'a'.repeat(300) })).status).toBe(400));
  it('rejects an invalid phone', async () => expect((await register({ phone: '12345' })).status).toBe(400));
});

describe('field-specific error messages', () => {
  it('names the phone field', async () => {
    const res = await register({ phone: '12345' });
    expect(res.body.field).toBe('phone');
    expect(res.body.error).toMatch(/phone/i);
  });
  it('names the email field', async () => {
    const res = await register({ email: 'sara@' });
    expect(res.body.field).toBe('email');
  });
  it('names the password field', async () => {
    const res = await register({ password: 'short' });
    expect(res.body.field).toBe('password');
    expect(res.body.error).toMatch(/8 characters/);
  });
  it('names the first missing field', async () => {
    const res = await register({ phone: '' });
    expect(res.body.field).toBe('phone');
  });
});

describe('POST /api/auth/login input handling', () => {
  it('requires email and password', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(400);
  });
});
