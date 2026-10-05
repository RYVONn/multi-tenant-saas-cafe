const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getShiftHistory = async (req, res) => {
  try {
    console.log('[getShiftHistory] req.user:', req.user);
    console.log('[getShiftHistory] query:', req.query);

    const { from, to, type, status } = req.query;
    const where = {};

    if (type   && type   !== 'all') where.type   = type;
    if (status && status !== 'all') where.status = status;
    if (from || to) {
      where.openedAt = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
      };
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        consumptions:  { include: { items: { include: { item: true } } } },
        issuances:     { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot:      true,
      },
      orderBy: { openedAt: 'desc' },
    });

    const enriched = await Promise.all(
      shifts.map(async shift => {
        const windowEnd = shift.closedAt ?? new Date();

        // ✅ prisma.orders (plural)
        const orders = await prisma.orders.findMany({
          where: {
            created_at: { gte: shift.openedAt, lte: windowEnd },
          },
          include: { order_items: true },
        });

        const completedOrders = orders.filter(o => o.status === 'complete');
        const pendingOrders   = orders.filter(o => ['pending', 'preparing'].includes(o.status));
        const cancelledOrders = orders.filter(o => o.status === 'cancelled');

        const revenue   = completedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
        const itemsSold = completedOrders.reduce(
          (sum, o) => sum + o.order_items.reduce((s, i) => s + i.quantity, 0), 0
        );

        // ✅ null guard: item ممكن يكون null للـ custom items
        const consumptionTotals = {};
        for (const log of shift.consumptions) {
          for (const ci of log.items) {
            const key = ci.itemId ?? `custom_${ci.customName}`;
            if (!consumptionTotals[key]) {
              consumptionTotals[key] = {
                name:  ci.item?.name  ?? ci.customName ?? 'Custom item',
                unit:  ci.item?.unit  ?? '',
                total: 0,
                isCustom: !ci.itemId,
              };
            }
            consumptionTotals[key].total += ci.quantity;
          }
        }

        const duration = shift.closedAt
          ? Math.floor((new Date(shift.closedAt) - new Date(shift.openedAt)) / 60_000)
          : Math.floor((new Date() - new Date(shift.openedAt)) / 60_000);

        return {
          id:           shift.id,
          type:         shift.type,
          status:       shift.status,
          staff:        shift.staff,
          openedAt:     shift.openedAt,
          closedAt:     shift.closedAt,
          handoverNote: shift.handoverNote,
          duration,
          orders: {
            total:     orders.length,
            completed: completedOrders.length,
            pending:   pendingOrders.length,
            cancelled: cancelledOrders.length,
            revenue,
            itemsSold,
            list: orders.map(o => ({
              id:            o.id,
              status:        o.status,
              total_amount:  Number(o.total_amount),
              customer_name: o.customer_name,
              type:          o.type,           // ✅ o.type لا o.order_type
              created_at:    o.created_at,
              items_count:   o.order_items.reduce((s, i) => s + i.quantity, 0),
            })),
          },
          consumptionLogs: shift.consumptions.length,
          consumedItems:   Object.entries(consumptionTotals).map(([key, v]) => ({
            itemId: v.isCustom ? null : key,
            name:   v.name,
            unit:   v.unit,
            total:  v.total,
            isCustom: v.isCustom ?? false,
          })),
          stockRequests: {
            total:    shift.stockRequests.length,
            pending:  shift.stockRequests.filter(r => r.status === 'pending').length,
            approved: shift.stockRequests.filter(r => r.status === 'approved').length,
            rejected: shift.stockRequests.filter(r => r.status === 'rejected').length,
          },
          issuances: shift.issuances.length,
        };
      })
    );

    // ── Today's summary ───────────────────────────────────────────────────
    const cairoOffset = 2 * 60 * 60 * 1000;
    const cairoNow    = new Date(Date.now() + cairoOffset);
    const todayStart  = new Date(
      Date.UTC(
        cairoNow.getUTCFullYear(),
        cairoNow.getUTCMonth(),
        cairoNow.getUTCDate(),
        0, 0, 0, 0
      ) - cairoOffset
    );
    const todayEnd = new Date(
      Date.UTC(
        cairoNow.getUTCFullYear(),
        cairoNow.getUTCMonth(),
        cairoNow.getUTCDate(),
        23, 59, 59, 999
      ) - cairoOffset
    );

    // ✅ prisma.orders (plural)
    const todayOrders = await prisma.orders.findMany({
      where: { created_at: { gte: todayStart, lte: todayEnd } },
      include: { order_items: true },
    });

    const summary = {
      ordersToday:    todayOrders.length,
      revenueToday:   todayOrders
        .filter(o => o.status === 'complete')
        .reduce((sum, o) => sum + Number(o.total_amount), 0),
      completedToday: todayOrders.filter(o => o.status === 'complete').length,
      pendingToday:   todayOrders
        .filter(o => ['pending', 'preparing'].includes(o.status)).length,
    };

    res.json({ shifts: enriched, summary });
  } catch (err) {
    console.error('getShiftHistory error:', err);
    // ✅ أرجع err.message عشان تشوف السبب الحقيقي
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
};

module.exports = { getShiftHistory };