'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendNewOrderPush } = require('./push.controller');

// Granted once, on the customer's first completed order
const WELCOME_BONUS_POINTS = 1000;

// ─── PassKit sync helpers (fire & forget) ─────────────────────────────────────

async function syncPassKitAward(order, pointsAwarded) {
  const webhookUrl = process.env.N8N_AWARD_POINTS_WEBHOOK;
  if (!webhookUrl || !order.customer_id) return;
  try {
    const customer = await prisma.customers.findUnique({
      where:  { id: order.customer_id },
      select: { phone: true },
    });
    if (!customer?.phone) return;
    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:           'points.award',
        user_id:         order.customer_id,
        user_phone:      customer.phone,
        order_id:        order.id,
        order_total_egp: Number(order.total_amount),
        points_to_award: pointsAwarded,
      }),
    }).catch(err => console.error('[n8n] W2 sync error:', err.message));
  } catch (err) {
    console.error('[n8n] syncPassKitAward error:', err.message);
  }
}

async function syncPassKitRedeem(userId, orderId, pointsRedeemed) {
  const webhookUrl = process.env.N8N_DEDUCT_POINTS_WEBHOOK;
  if (!webhookUrl) return;
  try {
    const customer = await prisma.customers.findUnique({
      where:  { id: userId },
      select: { phone: true },
    });
    if (!customer?.phone) return;
    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:            'points.redeem',
        user_id:          userId,
        user_phone:       customer.phone,
        order_id:         orderId,
        points_to_redeem: pointsRedeemed,
      }),
    }).catch(err => console.error('[n8n] W3 sync error:', err.message));
  } catch (err) {
    console.error('[n8n] syncPassKitRedeem error:', err.message);
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  try {
    const userId = req.user.id;

    const accountCustomer = await prisma.customers.findUnique({
      where:  { id: userId },
      select: { phone: true, full_name: true, points: true },
    });
    if (!accountCustomer) return res.status(404).json({ error: 'Customer not found' });

    const customer_name  = accountCustomer.full_name;
    const customer_phone = accountCustomer.phone;

    const { order_type, address, notes, payment_method, transaction_number } = req.body;
    const clientPointsRedeemed = Math.max(0, parseInt(req.body.points_redeemed) || 0);

    // Parse items
    let items;
    try {
      items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
    } catch {
      return res.status(400).json({ error: 'Invalid items format' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items missing or empty' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Too many items' });
    }
    // Quantity must be an integer between 1 and 50 (no negative / fractional / huge values)
    for (const item of items) {
      const q = Number(item?.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 50) {
        return res.status(400).json({ error: 'Quantity must be an integer between 1 and 50' });
      }
    }

    // Payment validation
    const validPayments = {
      delivery:   ['cash', 'instapay', 'points'],
      pickup:     ['cash', 'visa', 'instapay', 'points'],
      drive_thru: ['cash', 'visa', 'instapay', 'points'],
    };
    if (!validPayments[order_type]?.includes(payment_method || '')) {
      return res.status(400).json({ error: `Invalid payment method for ${order_type}` });
    }

    let payment_location = 'in_store';
    if (payment_method === 'instapay') payment_location = 'online';
    else if (payment_method === 'points') payment_location = 'online';
    else if (order_type === 'delivery')  payment_location = 'on_delivery';

    const payment_screenshot_url = req.file
      ? `/uploads/payments/${req.file.filename}`
      : null;

    // Validate sizes + extras from DB & compute prices
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        if (item.pointsPrice) {
          // Never trust the client's price: look the offer up and use its points_price.
          const offer = await prisma.offers.findFirst({
            where: { id: String(item.product_id), offer_type: 'points_product', is_active: true },
          });
          if (!offer || !offer.points_price || offer.points_price <= 0) {
            throw new Error('Points offer not found or unavailable');
          }
          return {
            product_name:    offer.title,
            image_url:       offer.image_url || null,
            quantity:        Number(item.quantity),
            size_id:         null,
            size_name:       'Points Redemption',
            size_price:      0,
            extras_snapshot: [{ id: 'points', name: 'points_price', price: offer.points_price }],
            unit_price:      0,
            subtotal:        0,
            pointsCost:      offer.points_price * Number(item.quantity),
          };
        }

        if (item.is_bundle) {
          const offer = await prisma.offers.findUnique({ where: { id: item.product_id } });
          if (!offer) throw new Error(`Bundle not found: ${item.product_id}`);
          const unit_price = Number(offer.price ?? 0);
          return {
            product_name:    offer.title,
            image_url:       offer.image_url || null,
            quantity:        Number(item.quantity),
            size_id:         null,
            size_name:       'Bundle',
            size_price:      unit_price,
            extras_snapshot: [],
            unit_price,
            subtotal:        unit_price * Number(item.quantity),
          };
        }

        if (!item.size_id) throw new Error(`Size is required for: ${item.product_name}`);
        const size = await prisma.product_sizes.findUnique({ where: { id: String(item.size_id) }, include: { product: true } });
        if (!size) throw new Error(`Size not found: ${item.size_id}`);

        const extra_ids = Array.isArray(item.extra_ids) ? item.extra_ids : [];
        let extrasData = [];
        if (extra_ids.length > 0) {
          extrasData = await prisma.extras.findMany({
            where: { id: { in: extra_ids }, available: true },
          });
          if (extrasData.length !== extra_ids.length) {
            throw new Error('One or more extras are invalid or unavailable');
          }
        }

        const extrasTotal = extrasData.reduce((sum, e) => sum + Number(e.price), 0);
        const unit_price  = Number(size.price) + extrasTotal;

        return {
          product_name:    size.product?.name ?? item.product_name,
          image_url:       size.product?.image_url ?? null,
          quantity:        Number(item.quantity),
          size_id:         size.id,
          size_name:       size.name,
          size_price:      Number(size.price),
          extras_snapshot: extrasData.map(e => ({ id: e.id, name: e.name, price: Number(e.price) })),
          unit_price,
          subtotal:        unit_price * Number(item.quantity),
        };
      })
    );

    const itemsTotal     = enrichedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const pointsItemsCost = enrichedItems.reduce((sum, i) => sum + (i.pointsCost ?? 0), 0);
    // Points-priced items: server value is authoritative. Otherwise cap the client's value.
    const pointsRedeemed = pointsItemsCost > 0
      ? pointsItemsCost
      : Math.min(clientPointsRedeemed, accountCustomer.points ?? 0);
    const pointsDiscount = 0; // Removed automatic point conversion as requested
    const total_amount = Math.max(0, itemsTotal - pointsDiscount);

    // ── Validate points balance but DO NOT deduct yet ─────────────────────
    // Points are deducted only when the order reaches 'complete' status.
    // Here we only verify the customer has enough balance to reserve.
    const order = await prisma.$transaction(async (tx) => {
      if (pointsRedeemed > 0) {
        const customer = await tx.customers.findUnique({
          where:  { id: userId },
          select: { points: true },
        });
        if (!customer || customer.points < pointsRedeemed) {
          throw Object.assign(new Error('Insufficient points'), { code: 'INSUFFICIENT_POINTS' });
        }
        // ✅ NO deduction here — deduction happens on complete
      }

      const newOrder = await tx.orders.create({
        data: {
          customer_name,
          customer_phone,
          type:                  order_type,
          address:               address || null,
          notes:                 notes   || null,
          total_amount,
          customer_id:           userId,
          status:                'pending',
          payment_method:        payment_method || 'cash',
          payment_location,
          transaction_number:    transaction_number?.trim() || null,
          payment_screenshot_url,
          payment_status: (payment_method === 'points' && itemsTotal === 0) ? 'verified' : 'pending',
          points_redeemed:       pointsRedeemed,
          order_items: {
            create: enrichedItems.map(({ pointsCost, ...item }) => ({
              product_name:    item.product_name,
              image_url:       item.image_url,
              quantity:        item.quantity,
              unit_price:      item.unit_price,
              subtotal:        item.subtotal,
              size_id:         item.size_id,
              size_name:       item.size_name,
              size_price:      item.size_price,
              extras_snapshot: item.extras_snapshot,
            })),
          },
        },
        include: { order_items: true },
      });

      return newOrder;
    });

    const orderRoles = ['owner', 'morning_staff', 'evening_staff'];
    orderRoles.forEach(role => req.app.get('io').to(`role:${role}`).emit('new_order', order));
    await sendNewOrderPush(order);

    res.status(201).json(order);

  } catch (error) {
    if (error.code === 'INSUFFICIENT_POINTS') {
      return res.status(422).json({ error: 'Insufficient points' });
    }
    if (error.message && !error.code) {
      return res.status(400).json({ error: error.message });
    }
    console.error('CREATE ORDER ERROR:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

// ─── GET /api/orders ──────────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;

    const cairoOffsetMs = 2 * 60 * 60 * 1000;
    const cairoNow      = new Date(Date.now() + cairoOffsetMs);
    const startOfDay    = new Date(Date.UTC(cairoNow.getUTCFullYear(), cairoNow.getUTCMonth(), cairoNow.getUTCDate(), 0, 0, 0, 0) - cairoOffsetMs);
    const endOfDay      = new Date(Date.UTC(cairoNow.getUTCFullYear(), cairoNow.getUTCMonth(), cairoNow.getUTCDate(), 23, 59, 59, 999) - cairoOffsetMs);

    const orders = await prisma.orders.findMany({
      where: {
        created_at: { gte: startOfDay, lte: endOfDay },
        ...(role === 'customer' ? { customer_id: userId } : {}),
      },
      include: { order_items: true },
      orderBy: { created_at: 'desc' },
    });

    res.json(orders.map(o => ({ ...o, order_type: o.type })));
  } catch (error) {
    console.error('GET ORDERS ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// ─── PATCH /api/orders/:id/status ─────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { id }     = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'preparing', 'complete', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    const existing = await prisma.orders.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    // Block updates on already-finalized orders
    if (existing.status === 'complete' || existing.status === 'cancelled') {
      return res.status(409).json({ error: 'Order already finalized' });
    }

    const order = await prisma.orders.update({
      where:   { id },
      data:    { status },
      include: { order_items: true },
    });

    // ── Points logic on finalization ──────────────────────────────────────
    if (status === 'complete' && order.customer_id) {

      // 1. Deduct redeemed points (if this was a points order)
      //    This is the ONLY place deduction happens — not in createOrder.
      if (order.points_redeemed > 0) {
        try {
          const alreadyDeducted = await prisma.points_transactions.findFirst({
            where: { order_id: id, transaction_type: 'redeem' },
          });

          if (!alreadyDeducted) {
            await prisma.$transaction(async (tx) => {
              const customer = await tx.customers.findUnique({
                where:  { id: order.customer_id },
                select: { points: true },
              });

              // Re-validate balance at deduction time
              if (!customer || customer.points < order.points_redeemed) {
                throw Object.assign(
                  new Error('Insufficient points at completion time'),
                  { code: 'INSUFFICIENT_POINTS_AT_COMPLETE' }
                );
              }

              await tx.customers.update({
                where: { id: order.customer_id },
                data:  { points: { decrement: order.points_redeemed } },
              });

              await tx.points_transactions.create({
                data: {
                  customer_id:      order.customer_id,
                  amount:           order.points_redeemed,
                  transaction_type: 'redeem',
                  order_id:         id,
                  note:             `Redeemed on order completion — ${id}`,
                },
              });
            });

            // Sync PassKit after deduction
            syncPassKitRedeem(order.customer_id, id, order.points_redeemed);
            console.log(`[points] ✅ Deducted ${order.points_redeemed} pts for order ${id}`);
          }
        } catch (redeemErr) {
          // Log but don't fail the status update
          console.error('[points] ❌ REDEEM DEDUCTION FAILED for order', id, redeemErr.message);
        }
      }

      // 1b. Welcome bonus: granted once, when the customer's FIRST order is completed
      //     (so throw-away sign-ups that never buy anything get nothing).
      try {
        const alreadyHasBonus = await prisma.points_transactions.findFirst({
          where: { customer_id: order.customer_id, note: { startsWith: 'Welcome bonus' } },
        });
        const earlierCompleted = await prisma.orders.count({
          where: { customer_id: order.customer_id, status: 'complete', id: { not: id } },
        });
        if (!alreadyHasBonus && earlierCompleted === 0) {
          const bonus = await prisma.$transaction(async (tx) => {
            await tx.customers.update({ where: { id: order.customer_id }, data: { points: { increment: WELCOME_BONUS_POINTS } } });
            return tx.points_transactions.create({
              data: {
                customer_id:      order.customer_id,
                amount:           WELCOME_BONUS_POINTS,
                transaction_type: 'earn',
                note:             'Welcome bonus — first completed order',
              },
            });
          });
          syncPassKitAward({ ...order, total_amount: 0 }, WELCOME_BONUS_POINTS);
          console.log(`[points] Welcome bonus granted for customer ${order.customer_id} (${bonus.id})`);
        }
      } catch (bonusErr) {
        console.error('[points] welcome bonus failed for order', id, bonusErr.message);
      }

      // 2. Award points for the purchase amount
      const settings = await prisma.store_settings.findUnique({ where: { id: 1 } });

      // AZT: "1 EGP = 1 point every Saturday" toggle — when enabled, orders
      // completed on a Saturday use saturday_points_multiplier instead of the
      // normal points_multiplier. Saturday is determined by the server's
      // local time at the moment the order is marked complete (not the order's
      // creation time), matching how the rest of this function already reads
      // "now" implicitly via order completion.
      const isSaturday = new Date().getDay() === 6; // 0=Sun ... 6=Sat
      const useSaturdayRate = isSaturday && settings?.saturday_points_enabled;
      const multiplier = useSaturdayRate
        ? settings.saturday_points_multiplier
        : (settings ? settings.points_multiplier : 1);
      const pointsToAward = Math.floor(Number(order.total_amount) * multiplier);


      if (pointsToAward > 0) {
        try {
          const alreadyAwarded = await prisma.points_transactions.findFirst({
            where: { order_id: id, transaction_type: 'earn' },
          });

          if (!alreadyAwarded) {
            await prisma.$transaction(async (prismaTx) => {
              await prismaTx.customers.update({
                where: { id: order.customer_id },
                data:  { points: { increment: pointsToAward } },
              });
              await prismaTx.points_transactions.create({
                data: {
                  customer_id:      order.customer_id,
                  amount:           pointsToAward,
                  transaction_type: 'earn',
                  order_id:         id,
                  note:             `Earned from order ${order.id}`,
                },
              });
            });

            syncPassKitAward(order, pointsToAward);
            console.log(`[points] ✅ Awarded ${pointsToAward} pts for order ${id}`);
          }
        } catch (earnErr) {
          console.error('[points] ❌ EARN FAILED for order', id, earnErr.message);
        }
      }
    }

    // ── Cancelled: no points action needed (nothing was deducted) ─────────
    // If order was cancelled, points_redeemed was never touched → no refund needed.
    // Log it for visibility.
    if (status === 'cancelled' && existing.points_redeemed > 0) {
      console.log(`[points] ℹ️ Order ${id} cancelled — ${existing.points_redeemed} reserved points released (were never deducted)`);
    }

    const orderRoles = ['owner', 'morning_staff', 'evening_staff'];
    orderRoles.forEach(role => req.app.get('io').to(`role:${role}`).emit('order_updated', order));
    res.json(order);

  } catch (error) {
    console.error('UPDATE STATUS ERROR:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// ─── PATCH /api/orders/:id/verify-payment ─────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const order  = await prisma.orders.update({
      where:   { id },
      data:    { payment_status: 'verified' },
      include: { order_items: true },
    });
    const orderRoles = ['owner', 'morning_staff', 'evening_staff'];
    orderRoles.forEach(role => req.app.get('io').to(`role:${role}`).emit('order_updated', order));
    res.json(order);
  } catch (error) {
    console.error('VERIFY PAYMENT ERROR:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

// ─── GET /api/orders/history ──────────────────────────────────────────────────
exports.getHistory = async (req, res) => {
  try {
    const { date } = req.query;
    // Customers only ever see their own orders; staff see everything.
    let whereClause = req.user.role === 'customer' ? { customer_id: req.user.id } : {};

    if (date) {
      const cairoOffsetMs = 2 * 60 * 60 * 1000;
      const cairoDate     = new Date(date);
      const startOfDay    = new Date(Date.UTC(cairoDate.getUTCFullYear(), cairoDate.getUTCMonth(), cairoDate.getUTCDate(), 0, 0, 0, 0) - cairoOffsetMs);
      const endOfDay      = new Date(Date.UTC(cairoDate.getUTCFullYear(), cairoDate.getUTCMonth(), cairoDate.getUTCDate(), 23, 59, 59, 999) - cairoOffsetMs);
      whereClause.created_at = { gte: startOfDay, lte: endOfDay };
    }

    const orders = await prisma.orders.findMany({
      where:   whereClause,
      include: { order_items: true },
      orderBy: { created_at: 'desc' },
    });

    res.json(orders.map(o => ({ ...o, order_type: o.type })));
  } catch (error) {
    console.error('GET HISTORY ERROR:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
};