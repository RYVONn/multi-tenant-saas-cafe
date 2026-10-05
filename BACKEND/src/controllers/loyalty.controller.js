const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── PassKit sync helper (fire & forget) ──────────────────────────────────────
// AZT: the wallet card's visible balance is NOT the same thing as
// customers.points in our DB — n8n owns the card and only updates it when
// it receives a 'points.award' / 'points.redeem' webhook. Any code path that
// changes customers.points directly (welcome bonus, admin adjust, etc.)
// without also firing this webhook will make the DB and the physical/wallet
// card disagree, which is exactly the "points move in the account but not
// on the card" symptom.
async function syncPassKitAward(customer, pointsToAward, note) {
  const webhookUrl = process.env.N8N_AWARD_POINTS_WEBHOOK;
  if (!webhookUrl || !pointsToAward || !customer?.phone) return;
  try {
    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:           'points.award',
        user_id:         customer.id,
        user_phone:      customer.phone,
        order_id:        null,
        order_total_egp: 0,
        points_to_award: pointsToAward,
        note:            note || 'Card sync',
      }),
    }).catch(err => console.error('[n8n] cardCreated points sync error:', err.message));
  } catch (err) {
    console.error('[Loyalty] syncPassKitAward error:', err.message);
  }
}

// ─── Internal Secret Middleware Helper ────────────────────────────────────────
function verifyInternalSecret(req, res) {
  const secret = process.env.N8N_INTERNAL_SECRET;
  // Fail closed: if the secret is not configured, nobody gets in.
  if (!secret) {
    res.status(503).json({ error: 'Internal endpoint not configured' });
    return false;
  }
  const provided = String(req.headers['x-internal-secret'] ?? '');
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─── POST /api/internal/loyalty/card-created ──────────────────────────────────
exports.cardCreated = async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  try {
    const { user_id, passkit_card_id, distribution_url } = req.body;

    if (!user_id || !passkit_card_id) {
      return res.status(400).json({ error: 'user_id and passkit_card_id are required' });
    }

    const customer = await prisma.customers.findUnique({ where: { id: user_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    if (customer.pass_kit_card_id === passkit_card_id) {
      return res.json({ success: true, already_processed: true });
    }

    await prisma.customers.update({
      where: { id: user_id },
      data: {
        pass_kit_card_id: passkit_card_id,
        distribution_url: distribution_url || null,
      }
    });

    // The card only just came into existence in n8n/PassKit, so it starts at
    // whatever balance n8n's create-card flow set (usually 0). If the
    // customer already has points in our DB (e.g. the 1000-point welcome
    // bonus, or points earned before the card was ready), push those onto
    // the card now so it doesn't show 0 while the DB shows the real number.
    if (customer.points > 0) {
      syncPassKitAward(customer, customer.points, 'Initial balance sync on card creation');
    }

    console.log(`[Loyalty] Card saved for customer ${user_id} → ${passkit_card_id}`);
    res.json({ success: true });

  } catch (error) {
    console.error('[Loyalty] cardCreated error:', error);
    res.status(500).json({ error: 'Failed to save card data' });
  }
};

// ─── POST /api/internal/loyalty/points-update ─────────────────────────────────
exports.pointsUpdate = async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  try {
    const { user_id, amount, transaction_type, order_id, note } = req.body;

    if (!user_id || amount === undefined || !transaction_type) {
      return res.status(400).json({ error: 'user_id, amount, transaction_type are required' });
    }

    const validTypes = ['earn', 'redeem', 'admin_add', 'admin_deduct'];
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({
        error: `Invalid transaction_type. Must be: ${validTypes.join(' | ')}`
      });
    }

    if (order_id && (transaction_type === 'earn' || transaction_type === 'redeem')) {
      const existing = await prisma.points_transactions.findFirst({
        where: { order_id, transaction_type }
      });
      if (existing) {
        return res.status(409).json({
          error: 'Duplicate order_id — transaction already processed'
        });
      }
    }

    const customer = await prisma.customers.findUnique({ where: { id: user_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const isDeduct   = transaction_type === 'redeem' || transaction_type === 'admin_deduct';
    const delta      = isDeduct ? -Math.abs(amount) : Math.abs(amount);
    const newBalance = customer.points + delta;

    if (newBalance < 0) {
      return res.status(422).json({ error: 'Insufficient points' });
    }

    const [updatedCustomer] = await prisma.$transaction([
      prisma.customers.update({
        where: { id: user_id },
        data:  { points: newBalance }
      }),
      prisma.points_transactions.create({
        data: {
          customer_id:      user_id,
          amount:           Math.abs(amount),
          transaction_type,
          order_id:         order_id || null,
          note:             note     || null
        }
      })
    ]);

    console.log(`[Loyalty] Points ${transaction_type} for ${user_id}: ${customer.points} → ${newBalance}`);
    res.json({ success: true, new_balance: updatedCustomer.points });

  } catch (error) {
    if (error.message?.includes('points_check') || error.code === 'P2004') {
      return res.status(422).json({ error: 'Insufficient points' });
    }
    console.error('[Loyalty] pointsUpdate error:', error);
    res.status(500).json({ error: 'Failed to update points' });
  }
};

// ─── POST /api/internal/loyalty/passkit-clear ─────────────────────────────────
exports.passkitClear = async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const customer = await prisma.customers.findUnique({ where: { id: user_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    await prisma.customers.update({
      where: { id: user_id },
      data: {
        pass_kit_card_id: null,
        distribution_url: null,
      }
    });

    console.log(`[Loyalty] Card cleared for customer ${user_id}`);
    res.json({ success: true });

  } catch (error) {
    console.error('[Loyalty] passkitClear error:', error);
    res.status(500).json({ error: 'Failed to clear card data' });
  }
};

// ─── GET /api/internal/loyalty/balance/:user_id ───────────────────────────────
exports.getBalance = async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  try {
    const { user_id } = req.params;

    const customer = await prisma.customers.findUnique({
      where:  { id: user_id },
      select: { id: true, points: true, pass_kit_card_id: true }
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    res.json({
      user_id:         customer.id,
      points:          customer.points,
      passkit_card_id: customer.pass_kit_card_id || null
    });

  } catch (error) {
    console.error('[Loyalty] getBalance error:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
};

// ─── GET /api/loyalty/cards ───────────────────────────────────────────────────
exports.getAllCards = async (req, res) => {
  try {
    const { search = '', sort = 'desc', page = '1' } = req.query;
    const PAGE_SIZE = 25;
    const skip = (parseInt(page) - 1) * PAGE_SIZE;

    const where = {
      pass_kit_card_id: { not: null },
      ...(search && {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { phone:     { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    const [customers, total] = await prisma.$transaction([
      prisma.customers.findMany({
        where,
        orderBy: { points: sort === 'asc' ? 'asc' : 'desc' },
        skip,
        take: PAGE_SIZE,
        select: {
          id:               true,
          full_name:        true,
          phone:            true,
          email:            true,
          points:           true,
          pass_kit_card_id: true,
          distribution_url: true,
          created_at:       true
        }
      }),
      prisma.customers.count({ where })
    ]);

    const stats = await prisma.customers.aggregate({
      where:  { pass_kit_card_id: { not: null } },
      _max:   { points: true },
      _min:   { points: true },
      _avg:   { points: true },
      _count: { id: true }
    });

    res.json({
      customers,
      pagination: {
        total,
        page:       parseInt(page),
        pageSize:   PAGE_SIZE,
        totalPages: Math.ceil(total / PAGE_SIZE)
      },
      stats: {
        highest: stats._max.points  ?? 0,
        lowest:  stats._min.points  ?? 0,
        average: Math.round(stats._avg.points ?? 0),
        total:   stats._count.id
      }
    });

  } catch (error) {
    console.error('[Loyalty] getAllCards error:', error);
    res.status(500).json({ error: 'Failed to fetch loyalty cards' });
  }
};

// ─── POST /api/loyalty/cards/manual ───────────────────────────────────────────
exports.createCardManual = async (req, res) => {
  try {
    const { customer_id } = req.body;

    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required' });
    }

    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    if (customer.pass_kit_card_id) {
      return res.status(409).json({ error: 'Customer already has a loyalty card' });
    }

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
      }).catch(err => console.error('[n8n] manual card.create error:', err.message));
    }

    res.json({ success: true, message: 'Card creation triggered' });

  } catch (error) {
    console.error('[Loyalty] createCardManual error:', error);
    res.status(500).json({ error: 'Failed to trigger card creation' });
  }
};

// ─── DELETE /api/loyalty/cards/:customer_id ───────────────────────────────────
// FIX: بيمسح الـ points وبيعملها 0 عشان لما الكارد يتعمل تاني يبدأ من 0
exports.deleteCard = async (req, res) => {
  try {
    const { customer_id } = req.params;

    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (!customer.pass_kit_card_id) {
      return res.status(404).json({ error: 'Customer has no loyalty card' });
    }

    const webhookUrl = process.env.N8N_DELETE_CARD_WEBHOOK;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:           'card.delete',
          user_id:         customer.id,
          passkit_card_id: customer.pass_kit_card_id
        })
      }).catch(err => console.error('[n8n] card.delete error:', err.message));
    }

    // ✅ FIX: بنمسح الكارد ونعمل الـ points صفر عشان لما يتعمل كارد جديد يبدأ من 0
    await prisma.customers.update({
      where: { id: customer_id },
      data:  {
        pass_kit_card_id: null,
        distribution_url: null,
        points:           0
      }
    });

    res.json({ success: true });

  } catch (error) {
    console.error('[Loyalty] deleteCard error:', error);
    res.status(500).json({ error: 'Failed to delete card' });
  }
};

// ─── PATCH /api/loyalty/cards/:customer_id/points ─────────────────────────────
// FIX: بيبعت الـ webhook لـ n8n بس — n8n هو اللي بيحدث الـ DB عن طريق internal route
// عشان منعملش التحديث مرتين (double update)
exports.adjustPoints = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { amount, type, note } = req.body;

    if (!amount || !type) {
      return res.status(400).json({ error: 'amount and type are required' });
    }
    if (!['admin_add', 'admin_deduct'].includes(type)) {
      return res.status(400).json({ error: 'type must be admin_add or admin_deduct' });
    }

    const customer = await prisma.customers.findUnique({ where: { id: customer_id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // ✅ FIX: مش بنحدث الـ DB هنا — n8n هو اللي هيحدثه عن طريق PATCH /api/internal/customers/:id/points
    // بنبعت الـ webhook بس
    const webhookUrl = process.env.N8N_ADJUST_POINTS_WEBHOOK;
    if (!webhookUrl) {
      return res.status(500).json({ error: 'N8N_ADJUST_POINTS_WEBHOOK not configured' });
    }

    const webhookRes = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:            'points.admin_adjust',
        user_id:          customer_id,
        passkit_card_id:  customer.pass_kit_card_id,
        adjustment:       Math.abs(amount),
        transaction_type: type,
        note:             note || ''
      })
    });

    if (!webhookRes.ok) {
      console.error('[n8n] points.admin_adjust webhook failed:', webhookRes.status);
      return res.status(502).json({ error: 'Failed to trigger n8n webhook' });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('[Loyalty] adjustPoints error:', error);
    res.status(500).json({ error: 'Failed to adjust points' });
  }
};

// ─── GET /api/loyalty/cards/:customer_id/history ──────────────────────────────
exports.getCardHistory = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const history = await prisma.points_transactions.findMany({
      where: { customer_id },
      orderBy: { created_at: 'desc' }
    });
    res.json({ history });
  } catch (error) {
    console.error('[Loyalty] getCardHistory error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
};

// ─── GET /api/internal/loyalty/birthdays-today ────────────────────────────────
// AZT: called once a day (~12:00) by the n8n "birthday points" workflow.
// Returns every customer whose birthday (month + day, year ignored) is today,
// so n8n can loop over them and fire the "add point" workflow (500 pts each).
//
// Dedup for the actual point award happens on the existing
// POST /api/internal/loyalty/points-update endpoint: have n8n call it with
//   transaction_type = 'admin_add'
//   order_id          = `birthday-${customer.id}-${currentYear}`
// The unique index on (order_id, transaction_type) rejects a second call for
// the same customer/year, so even if the daily workflow fires twice (retry,
// manual re-run, etc.) the customer only ever gets the 500 points once.
exports.getBirthdaysToday = async (req, res) => {
  if (!verifyInternalSecret(req, res)) return;

  try {
    const now   = new Date();
    const month = now.getMonth() + 1; // JS months are 0-based
    const day   = now.getDate();

    // birthday is stored as a DATE column — compare month/day only (year ignored)
    const customers = await prisma.$queryRaw`
      SELECT id, full_name, phone, email, points, pass_kit_card_id, birthday
      FROM customers
      WHERE birthday IS NOT NULL
        AND EXTRACT(MONTH FROM birthday) = ${month}
        AND EXTRACT(DAY   FROM birthday) = ${day}
    `;

    res.json({
      date:        now.toISOString().slice(0, 10),
      count:       customers.length,
      customers:   customers.map(c => ({
        id:               c.id,
        full_name:        c.full_name,
        phone:            c.phone,
        email:            c.email,
        points:           c.points,
        pass_kit_card_id: c.pass_kit_card_id,
        // suggested idempotency key for the points-update call — same shape
        // n8n should pass back as order_id when it awards the bonus
        award_order_id:   `birthday-${c.id}-${now.getFullYear()}`,
      })),
    });

  } catch (error) {
    console.error('[Loyalty] getBirthdaysToday error:', error);
    res.status(500).json({ error: 'Failed to fetch birthdays' });
  }
};


