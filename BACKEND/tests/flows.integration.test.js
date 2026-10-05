// End-to-end flows against a REAL Postgres (the five critical user flows from the audit).
// Skipped unless TEST_DATABASE_URL is set, so a plain `npm test` never needs a database:
//
//   TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/bleu_test \
//     npx prisma db push && npx vitest run
//
// NEVER point TEST_DATABASE_URL at a production database: these tests create and delete rows.
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { token } = require('./helpers');

const enabled = !!process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient();
const suffix = Date.now();

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sample = {
  full_name: 'Test Customer',
  email: `Customer.${suffix}@Example.com`,
  password: 'correct-horse',
  phone: '٠١٠١٢٣٤٥٦٧٨', // Arabic-Indic digits on purpose (audit S3)
  birthday: '1995-05-20',
};

describe.skipIf(!enabled)('critical flows (real DB)', () => {
  let customerToken, customerId, sizeId, ownerToken, pointsOfferId;

  beforeAll(async () => {
    // The real Socket.IO server is attached in server.js; stub it so controllers can emit.
    app.set('io', { to: () => ({ emit: () => {} }) });
    await prisma.store_settings.upsert({ where: { id: 1 }, update: { points_multiplier: 1 }, create: { id: 1, points_multiplier: 1 } });

    const category = await prisma.categories.create({ data: { name: `Cat ${suffix}` } });
    const product = await prisma.products.create({
      data: { name: 'Latte', category_id: category.id, sizes: { create: [{ name: 'M', price: 80 }] } },
      include: { sizes: true },
    });
    sizeId = product.sizes[0].id;

    const offer = await prisma.offers.create({
      data: { title: 'Free cookie', offer_type: 'points_product', points_price: 300, is_active: true },
    });
    pointsOfferId = offer.id;

    const hash = await bcrypt.hash('OwnerPw123', 10);
    const owner = await prisma.shifts.create({
      data: { shift_name: 'Owner', role: 'owner', email: `owner.${suffix}@bleu.test`, password: hash },
    });
    ownerToken = token({ id: owner.id, role: 'owner' });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Flow 1: sign-up and login ───────────────────────────────────────────────
  describe('sign-up and login', () => {
    it('registers, normalising email, phone digits and granting the welcome bonus', async () => {
      const res = await request(app).post('/api/auth/register').send(sample);
      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe(sample.email.toLowerCase());
      expect(res.body.user.phone).toBe('+201012345678');
      expect(res.body.user.points).toBe(0); // bonus now comes with the first completed order
      customerToken = res.body.token;
      customerId = res.body.user.id;
    });

    it('rejects a duplicate that differs only by case or padding (409)', async () => {
      const res = await request(app).post('/api/auth/register').send({ ...sample, email: `  ${sample.email.toUpperCase()} ` });
      expect(res.status).toBe(409);
    });

    it('rejects a second account on the same phone number (409, field=phone)', async () => {
      const res = await request(app).post('/api/auth/register').send({ ...sample, email: `second.${suffix}@example.com`, phone: '01012345678' });
      expect(res.status).toBe(409);
      expect(res.body.field).toBe('phone');
    });

    it('logs in regardless of email case/spacing', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: ` ${sample.email.toUpperCase()}`, password: sample.password });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('gives a plain 401 for a wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: sample.email, password: 'nope-nope-nope' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid credentials');
    });
  });

  // ── Flow 5: staff login ─────────────────────────────────────────────────────
  describe('staff login', () => {
    it('uses bcrypt and returns the same error for unknown email and wrong password', async () => {
      const row = await prisma.shifts.findFirst({ where: { role: 'owner' }, orderBy: { id: 'asc' } });
      const ok = await request(app).post('/api/auth/staff/login').send({ email: row.email, password: 'OwnerPw123' });
      expect(ok.status).toBe(200);
      expect(ok.body.user.password).toBeUndefined();

      const wrong = await request(app).post('/api/auth/staff/login').send({ email: row.email, password: 'bad' });
      const unknown = await request(app).post('/api/auth/staff/login').send({ email: 'nobody@bleu.test', password: 'bad' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('upgrades a legacy plaintext password to bcrypt on first login', async () => {
      const email = `legacy.${suffix}@bleu.test`;
      const row = await prisma.shifts.create({ data: { shift_name: 'Legacy', role: 'morning_staff', email, password: 'plain-pass' } });
      const res = await request(app).post('/api/auth/staff/login').send({ email, password: 'plain-pass' });
      expect(res.status).toBe(200);
      const after = await prisma.shifts.findUnique({ where: { id: row.id } });
      expect(after.password.startsWith('$2')).toBe(true);
    });
  });

  // ── Flow 2: checkout / order placement ──────────────────────────────────────
  describe('order placement', () => {
    const place = (items, extra = {}) =>
      request(app)
        .post('/api/orders')
        .set(auth(customerToken))
        .field('order_type', 'pickup')
        .field('payment_method', 'cash')
        .field('items', JSON.stringify(items))
        .field(...(extra.points_redeemed !== undefined ? ['points_redeemed', String(extra.points_redeemed)] : ['x', '1']));

    it('creates a normal order priced from the DB', async () => {
      const res = await place([{ product_name: 'Hacked name', size_id: sizeId, quantity: 2 }]);
      expect(res.status).toBe(201);
      expect(Number(res.body.total_amount)).toBe(160);
      expect(res.body.order_items[0].product_name).toBe('Latte'); // client-supplied name ignored
    });

    it('rejects negative, zero, fractional and huge quantities', async () => {
      for (const quantity of [-5, 0, 1.5, 51]) {
        const res = await place([{ size_id: sizeId, quantity }]);
        expect(res.status).toBe(400);
      }
    });

    it('does not let the client price a points item at 0 for free', async () => {
      await prisma.customers.update({ where: { id: customerId }, data: { points: 1000 } });
      const res = await place([{ product_id: pointsOfferId, product_name: 'x', quantity: 1, pointsPrice: 1 }]);
      expect(res.status).toBe(201);
      expect(res.body.points_redeemed).toBe(300); // from the offer, not the client
    });

    it('rejects a points item that is not a real points offer', async () => {
      const res = await place([{ product_id: '22222222-2222-2222-2222-222222222222', quantity: 1, pointsPrice: 1 }]);
      expect(res.status).toBe(400);
    });

    it('never accepts a negative points_redeemed to mint points', async () => {
      const res = await place([{ size_id: sizeId, quantity: 1 }], { points_redeemed: -5000 });
      expect(res.status).toBe(201);
      expect(res.body.points_redeemed).toBe(0);
    });

    it('lets a customer see only their own history', async () => {
      const other = await prisma.customers.create({
        data: { full_name: 'Other', email: `other.${suffix}@x.test`, password: 'x', phone: '+201000000000' },
      });
      await prisma.orders.create({
        data: { customer_name: 'Other', type: 'pickup', total_amount: 10, customer_id: other.id, payment_method: 'cash', payment_location: 'in_store', status: 'pending' },
      });
      const res = await request(app).get('/api/orders/history').set(auth(customerToken));
      expect(res.status).toBe(200);
      expect(res.body.every((o) => o.customer_id === customerId)).toBe(true);
    });
  });

  // ── Flow 3: staff completes the order -> points awarded exactly once ────────
  describe('order fulfilment by staff', () => {
    let orderId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/orders')
        .set(auth(customerToken))
        .field('order_type', 'pickup')
        .field('payment_method', 'cash')
        .field('items', JSON.stringify([{ size_id: sizeId, quantity: 5 }])); // 400 EGP
      orderId = res.body.id;
    });

    it('customer cannot complete or verify their own order', async () => {
      const a = await request(app).patch(`/api/orders/${orderId}/status`).set(auth(customerToken)).send({ status: 'complete' });
      const b = await request(app).patch(`/api/orders/${orderId}/verify-payment`).set(auth(customerToken));
      expect(a.status).toBe(403);
      expect(b.status).toBe(403);
    });

    it('staff completes it and the points are awarded once', async () => {
      await prisma.customers.update({ where: { id: customerId }, data: { points: 0 } });
      const before = (await prisma.customers.findUnique({ where: { id: customerId } })).points;
      expect(before).toBe(0);

      const done = await request(app).patch(`/api/orders/${orderId}/status`).set(auth(ownerToken)).send({ status: 'complete' });
      expect(done.status).toBe(200);
      const after = (await prisma.customers.findUnique({ where: { id: customerId } })).points;
      expect(after - before).toBe(1400); // 400 purchase + 1000 welcome bonus (first completed order)

      const again = await request(app).patch(`/api/orders/${orderId}/status`).set(auth(ownerToken)).send({ status: 'complete' });
      expect(again.status).toBe(409);
      const final = (await prisma.customers.findUnique({ where: { id: customerId } })).points;
      expect(final).toBe(after);
    });
  });

  describe('welcome bonus', () => {
    it('is not granted again on the second completed order', async () => {
      const before = (await prisma.customers.findUnique({ where: { id: customerId } })).points;
      const o = await request(app).post('/api/orders').set(auth(customerToken))
        .field('order_type', 'pickup').field('payment_method', 'cash')
        .field('items', JSON.stringify([{ size_id: sizeId, quantity: 1 }])); // 80 EGP
      await request(app).patch(`/api/orders/${o.body.id}/status`).set(auth(ownerToken)).send({ status: 'complete' });
      const after = (await prisma.customers.findUnique({ where: { id: customerId } })).points;
      expect(after - before).toBe(80);
      const bonuses = await prisma.points_transactions.count({ where: { customer_id: customerId, note: { startsWith: 'Welcome bonus' } } });
      expect(bonuses).toBe(1);
    });
  });

  // ── Flow 4: loyalty ─────────────────────────────────────────────────────────
  describe('loyalty', () => {
    it('customer cannot list loyalty cards or delete another customer card', async () => {
      const list = await request(app).get('/api/loyalty/cards').set(auth(customerToken));
      const del = await request(app).delete(`/api/loyalty/cards/${customerId}`).set(auth(customerToken));
      expect(list.status).toBe(403);
      expect(del.status).toBe(403);
    });

    it('staff can list loyalty cards', async () => {
      const res = await request(app).get('/api/loyalty/cards').set(auth(ownerToken));
      expect(res.status).toBe(200);
    });
  });

  // ── Public catalogue ────────────────────────────────────────────────────────
  describe('public catalogue', () => {
    it('GET /api/offers works (was a 500 before the status column existed)', async () => {
      const res = await request(app).get('/api/offers');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('bundles');
      expect(res.body).toHaveProperty('pointProducts');
    });

    it('hides draft products from anonymous callers even with ?admin=true', async () => {
      const cat = await prisma.categories.create({ data: { name: `Draft cat ${suffix}` } });
      const draft = await prisma.products.create({ data: { name: `SECRET-${suffix}`, category_id: cat.id, status: 'draft' } });

      const list = await request(app).get('/api/products?admin=true');
      expect(JSON.stringify(list.body)).not.toContain(`SECRET-${suffix}`);
      const byId = await request(app).get(`/api/products/${draft.id}`);
      expect(byId.status).toBe(404);

      const staffList = await request(app).get('/api/products?admin=true').set(auth(ownerToken));
      expect(JSON.stringify(staffList.body)).toContain(`SECRET-${suffix}`);
    });
  });

  // ── Upload hardening ────────────────────────────────────────────────────────
  describe('uploads', () => {
    it('rejects non-image uploads from staff', async () => {
      const res = await request(app)
        .post('/api/inventory/waste')
        .set(auth(ownerToken))
        .attach('image', Buffer.from('<script>alert(1)</script>'), { filename: 'x.html', contentType: 'text/html' });
      expect(res.status).toBe(400);
    });
  });
});
