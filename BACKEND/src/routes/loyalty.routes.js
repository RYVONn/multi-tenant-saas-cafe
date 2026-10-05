const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/loyalty.controller');
const verifyToken = require('../middlewares/auth.middleware');
const requireRole  = require('../middlewares/role.middleware');
const MANAGERS = ['owner', 'manager', 'inventory_manager'];
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Internal endpoints (n8n callbacks) ───────────────────────────────────────
router.post('/internal/card-created',     controller.cardCreated);
router.post('/internal/points-update',    controller.pointsUpdate);
router.post('/internal/passkit-clear',    controller.passkitClear);
router.get( '/internal/balance/:user_id', controller.getBalance);
router.get( '/internal/birthdays-today',  controller.getBirthdaysToday);

// ── Dashboard endpoints (JWT protected) ──────────────────────────────────────
router.get(   '/cards',                     verifyToken, requireRole(...MANAGERS), controller.getAllCards);
router.post(  '/cards/manual',              verifyToken, requireRole(...MANAGERS), controller.createCardManual);
router.delete('/cards/:customer_id',        verifyToken, requireRole(...MANAGERS), controller.deleteCard);
router.patch( '/cards/:customer_id/points', verifyToken, requireRole(...MANAGERS), controller.adjustPoints);
router.get(   '/cards/:customer_id/history', verifyToken, requireRole(...MANAGERS), controller.getCardHistory);

// ── Customer: Request a new loyalty card ─────────────────────────────────────
router.post('/request-card', verifyToken.any, requireRole('customer'), async (req, res) => {
  try {
    const customer = await prisma.customers.findUnique({
      where:  { id: req.user.id },
      select: { id: true, full_name: true, phone: true, pass_kit_card_id: true }
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (customer.pass_kit_card_id) return res.status(409).json({ error: 'Card already exists' });

    const webhookUrl = process.env.N8N_CREATE_CARD_WEBHOOK;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:   'card.create',
          user_id: customer.id,
          name:    customer.full_name,
          phone:   customer.phone
        })
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[loyalty] request-card error:', err.message);
    res.status(500).json({ error: 'Failed to request card' });
  }
});

// ── TEMP: Backfill cards for existing users without PassKit card ──────────────
// AZT SECURITY FIX (audit issue #2): this route had zero auth and could
// mutate every customer's phone number + trigger real n8n webhooks for
// anyone who found the URL. Now owner-only.
router.post('/admin/backfill-cards', verifyToken, requireRole('owner'), async (req, res) => {
  try {
    const users = await prisma.customers.findMany({
      where: { pass_kit_card_id: null }
    });

    function normalizePhone(raw) {
      if (!raw) return null;
      const digits = String(raw).replace(/\D/g, '');
      if (/^01[0-9]{9}$/.test(digits))  return '+2' + digits;
      if (/^201[0-9]{9}$/.test(digits)) return '+' + digits;
      return raw;
    }

    for (const user of users) {
      const webhookUrl = process.env.N8N_CREATE_CARD_WEBHOOK;
      if (!webhookUrl) continue;

      const normalizedPhone = normalizePhone(user.phone);

      if (normalizedPhone && normalizedPhone !== user.phone) {
        await prisma.customers.update({
          where: { id: user.id },
          data:  { phone: normalizedPhone }
        });
      }

      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:   'card.create',
          user_id: user.id,
          name:    user.full_name,
          phone:   normalizedPhone
        })
      });

      await new Promise(r => setTimeout(r, 1500));
    }

    res.json({ message: 'done', triggered: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

