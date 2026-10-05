// ─── Internal Loyalty Routes (n8n → Backend Callbacks) ───────────────────────
// Base: /api/internal
// Auth: x-internal-secret header (internalAuth middleware)
//
// Endpoints:
//   PATCH /customers/:id/passkit        ← W1 callback: save card_id + dist URL
//   PATCH /customers/:id/points         ← W2/W3 callback: earn / redeem points
//   PATCH /customers/:id/passkit/clear  ← W5 callback: clear PassKit data
//   GET   /loyalty/balance/:user_id     ← n8n reads current balance before update

const express      = require('express');
const { PrismaClient } = require('@prisma/client');
const internalAuth = require('../middlewares/internal.middleware');

const router = express.Router();
const prisma = new PrismaClient();

// All routes under this file require internal secret
router.use(internalAuth);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/internal/customers/:id/passkit
// Called by n8n W1 after PassKit card is created.
// Body: { passkit_card_id, distribution_url }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/customers/:id/passkit', async (req, res) => {
  const { id } = req.params;
  const { passkit_card_id, distribution_url } = req.body;

  if (!passkit_card_id || !distribution_url) {
    return res.status(400).json({ error: 'passkit_card_id and distribution_url are required' });
  }

  try {
    const customer = await prisma.customers.update({
      where: { id },
      data:  { pass_kit_card_id: passkit_card_id, distribution_url },
      select: { id: true, phone: true, points: true }
    });

    // AZT: the PassKit card just came into existence and starts at whatever
    // balance W1's create-card flow set (usually 0). If the customer already
    // has points in our DB (welcome bonus, points earned before the card was
    // ready, etc.), push that balance onto the freshly created card now via
    // the same webhook W2 uses — otherwise the card stays stuck at 0 while
    // the app shows the real number.
    if (customer.points > 0 && customer.phone) {
      const webhookUrl = process.env.N8N_AWARD_POINTS_WEBHOOK;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event:           'points.award',
            user_id:         customer.id,
            user_phone:      customer.phone,
            // W2's "Validate Payload" node just checks order_id is truthy —
            // it isn't parsed as a real order UUID anywhere downstream —
            // so a descriptive placeholder satisfies the check without
            // pretending this came from a real order.
            order_id:        `welcome-bonus-${customer.id}`,
            order_total_egp: 0,
            points_to_award: customer.points,
            note:            'Initial balance sync on card creation'
          })
        }).catch(err => console.error('[internal] passkit points sync error:', err.message));
      } else {
        console.warn('[internal] N8N_AWARD_POINTS_WEBHOOK not set — skipping initial card points sync');
      }
    }

    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Customer not found' });
    console.error('[internal] /passkit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/internal/customers/:id/points
// Called by n8n W2 (earn) / W3 (redeem) / W4 (admin adjust).
// Body: { amount, transaction_type, order_id?, note? }
//
// transaction_type: 'earn' | 'redeem' | 'admin_add' | 'admin_deduct'
// amount: always positive integer — sign applied based on transaction_type
//
// Returns 409 if order_id already processed (idempotency)
// Returns 422 if deduction would result in negative balance
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/customers/:id/points', async (req, res) => {
  const { id } = req.params;
  const { amount, transaction_type, order_id = null, note = null } = req.body;

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const DEDUCT_TYPES = ['redeem', 'admin_deduct'];
  const VALID_TYPES  = ['earn', 'redeem', 'admin_add', 'admin_deduct'];

  if (!VALID_TYPES.includes(transaction_type)) {
    return res.status(400).json({ error: `transaction_type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  // Idempotency — don't process the same order twice
 // ── Idempotency check ──
if (order_id) {
  // ✅ validate UUID قبل ما تبعته لـ Prisma
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(String(order_id))) {
    console.warn('[internal] Invalid order_id, skipping idempotency check:', order_id);
    // متوقفش الـ request، بس اعمل log وكمّل
  } else {
    const existing = await prisma.points_transactions.findFirst({
      where: { customer_id: id, order_id, transaction_type }
    });
    if (existing) {
      return res.status(409).json({ error: 'Already processed', transaction_id: existing.id });
    }
  }
}

  // Determine the signed delta
  const isDeduction = DEDUCT_TYPES.includes(transaction_type);
  const delta = isDeduction ? -amount : amount;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock customer row + check balance
      const customer = await tx.customers.findUnique({
        where:  { id },
        select: { points: true }
      });

      if (!customer) throw Object.assign(new Error('Customer not found'), { code: 'NOT_FOUND' });

      const newBalance = customer.points + delta;

      if (newBalance < 0) {
        throw Object.assign(
          new Error(`Insufficient points. Balance: ${customer.points}, requested: ${amount}`),
          { code: 'INSUFFICIENT' }
        );
      }

      // Write ledger entry
      await tx.points_transactions.create({
        data: { customer_id: id, amount: delta, transaction_type, order_id, note }
      });

      // Update denormalized balance
      const updated = await tx.customers.update({
        where: { id },
        data:  { points: newBalance },
        select: { points: true }
      });

      return { newBalance: updated.points };
    });

    return res.json({ success: true, newBalance: result.newBalance });

  } catch (err) {
    if (err.code === 'NOT_FOUND')    return res.status(404).json({ error: 'Customer not found' });
    if (err.code === 'INSUFFICIENT') return res.status(422).json({ error: err.message });
    console.error('[internal] /points error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/internal/customers/:id/passkit/clear
// Called by n8n W5 after PassKit card is deleted.
// Clears pass_kit_card_id + distribution_url on the customer record.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/customers/:id/passkit/clear', async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.customers.update({
      where: { id },
      data:  { pass_kit_card_id: null, distribution_url: null }
    });

    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Customer not found' });
    console.error('[internal] /passkit/clear error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/internal/loyalty/balance/:user_id
// n8n reads current balance before processing a deduction.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/loyalty/balance/:user_id', async (req, res) => {
  const { user_id } = req.params;

  try {
    const customer = await prisma.customers.findUnique({
      where:  { id: user_id },
      select: { points: true, pass_kit_card_id: true }
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    return res.json({
      balance:        customer.points,
      passkitCardId:  customer.pass_kit_card_id
    });
  } catch (err) {
    console.error('[internal] /balance error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

